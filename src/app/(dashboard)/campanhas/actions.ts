"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { payloadTooLarge } from "@/lib/rate-limit";
import { diffFields, hasChanges } from "@/modules/audit/diff";
import type { AuditEvent } from "@/modules/audit/events";
import { recordAudit, recordChange } from "@/modules/audit/log";
import { requireCampaignActor } from "@/modules/campaigns/access";
import { DEFAULT_CAMPAIGN_TIMEZONE, periodToUtc, zoneOrDefault } from "@/modules/campaigns/period";
import type { CampaignActionResult } from "@/modules/campaigns/result";
import { parseCampaignForm, type CampaignFieldErrors } from "@/modules/campaigns/schema";
import {
  allowedActions,
  campaignStatus,
  type CampaignAllowed,
  type CampaignStatus,
} from "@/modules/campaigns/status";

/**
 * Actions de campanha. Regras que valem para todas:
 *
 * - O `tenantId` vem da SESSÃO (`requireCampaignActor`), nunca do formulário:
 *   um `tenantId` no corpo da requisição é ignorado.
 * - Toda escrita é `updateMany` por `{ id, tenantId }` MAIS a condição de estado
 *   em que a leitura viu a campanha (ex.: pausar só casa quem não está pausada
 *   nem arquivada). Assim, duas abas ou duas pessoas agindo ao mesmo tempo não
 *   se atropelam: quem chega depois não escreve nada.
 * - Id de outra conta e id que não existe são a MESMA resposta ("não
 *   encontrada"): a leitura já filtra pelo `tenantId` da sessão. Só quando a
 *   leitura achou a campanha e o `updateMany` não casou ninguém (o estado mudou
 *   no meio) a resposta é "o status mudou" — sem escrever e sem auditar.
 * - O guarda repete em cada action: layout e menu não autorizam uma mutação.
 * - Terminada e arquivada ficam só para leitura (a tabela é `allowedActions`,
 *   a mesma que a tela usa para mostrar ou esconder o botão).
 * - Auditar nunca derruba a ação (`recordAudit`/`recordChange` não lançam).
 */

type Result = CampaignActionResult;

const AUDIT_TYPE = "Campaign";

const forbidden = (): Result => ({
  ok: false,
  code: "forbidden",
  error: "Só o dono ou um administrador da conta pode alterar campanhas.",
});
const notFound = (): Result => ({ ok: false, error: "Campanha não encontrada." });
const refused = (error: string): Result => ({ ok: false, error });
/** A leitura achou a campanha, mas o estado mudou antes da escrita (outra aba, outra pessoa). */
const statusChanged = (): Result => ({
  ok: false,
  error: "O status da campanha mudou. Atualize a página e tente de novo.",
});
const serverError = (): Result => ({
  ok: false,
  code: "server",
  error: "Não foi possível salvar agora. Tente de novo em instantes.",
});
const invalid = (fieldErrors: CampaignFieldErrors): Result => ({
  ok: false,
  code: "validation",
  // A primeira frase vai para o toast; o formulário marca cada campo.
  error: Object.values(fieldErrors)[0] ?? "Confira os campos e tente de novo.",
  fieldErrors,
});

/** A escrita falhou (banco fora, valor recusado): registra no servidor e devolve texto de gente. */
async function attempt<T>(task: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await task() };
  } catch (error) {
    console.error("[campanhas] falha ao gravar", error);
    return { ok: false };
  }
}

/** A campanha, só se for DESTA conta. Id que não é texto nunca chega ao banco. */
async function loadOwned(tenantId: string, id: unknown) {
  if (typeof id !== "string" || id.length === 0 || id.length > 64) return null;
  return prisma.campaign.findFirst({ where: { id, tenantId } });
}

function revalidateCampaign(id: string) {
  revalidatePath("/campanhas");
  revalidatePath(`/campanhas/${id}`);
}

/** Só os quatro campos do formulário são lidos. */
function readForm(formData: FormData) {
  return {
    name: formData.get("name"),
    objective: formData.get("objective"),
    startsOn: formData.get("startsOn"),
    endsOn: formData.get("endsOn"),
  };
}

/**
 * Cria uma campanha. Sem datas ela nasce como rascunho; "ativa" só quando o
 * início chega. O fuso é gravado na linha (hoje fixo em Brasília).
 */
export async function createCampaign(_prev: Result | null, formData: FormData): Promise<Result> {
  const actor = await requireCampaignActor();
  if (!actor.canEdit) return forbidden();

  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };

  const parsed = parseCampaignForm(readForm(formData));
  if (!parsed.ok) return invalid(parsed.errors);

  const timezone = DEFAULT_CAMPAIGN_TIMEZONE;
  const { startsAt, endsAt } = periodToUtc(parsed.data.startsOn, parsed.data.endsOn, timezone);

  const created = await attempt(() =>
    prisma.campaign.create({
      data: {
        tenantId: actor.tenantId,
        name: parsed.data.name,
        objective: parsed.data.objective,
        startsAt,
        endsAt,
        timezone,
        createdById: actor.userId,
      },
    }),
  );
  if (!created.ok) return serverError();
  const campaign = created.value;

  await recordAudit({
    event: "campaign.created",
    target: { type: AUDIT_TYPE, id: campaign.id, label: campaign.name },
    after: { name: campaign.name, objective: campaign.objective, startsAt, endsAt, timezone },
  });

  revalidatePath("/campanhas");
  return { ok: true, id: campaign.id };
}

/**
 * Edita nome, objetivo e datas. Terminada e arquivada não aceitam edição (nem
 * para prorrogar o fim). O fuso da campanha não muda: as datas novas são
 * lidas no fuso em que ela foi criada.
 */
export async function updateCampaign(_prev: Result | null, formData: FormData): Promise<Result> {
  const actor = await requireCampaignActor();
  if (!actor.canEdit) return forbidden();

  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };

  const campaign = await loadOwned(actor.tenantId, formData.get("id"));
  if (!campaign) return notFound();

  const now = new Date();
  const status = campaignStatus(campaign, now);
  if (!allowedActions(status).edit) {
    return refused(
      status === "archived"
        ? "Campanha arquivada fica só para consulta. Desarquive para editar."
        : "Campanha terminada fica só para consulta e não pode ser editada.",
    );
  }

  const parsed = parseCampaignForm(readForm(formData));
  if (!parsed.ok) return invalid(parsed.errors);

  const { startsAt, endsAt } = periodToUtc(parsed.data.startsOn, parsed.data.endsOn, zoneOrDefault(campaign.timezone));
  const before = { name: campaign.name, objective: campaign.objective, startsAt: campaign.startsAt, endsAt: campaign.endsAt };
  const after = { name: parsed.data.name, objective: parsed.data.objective, startsAt, endsAt };

  // Nada mudou: não grava (não mexe em `updatedAt`) e não enche a trilha.
  if (!hasChanges(diffFields(before, after))) {
    return { ok: true, id: campaign.id, info: "Nenhuma alteração para salvar." };
  }

  // A pausa só vale dentro do período. Se a edição faz a campanha deixar de ter
  // começado (sem início, ou início no futuro), uma pausa antiga ficaria
  // gravada e voltaria a valer quando a data chegasse: a campanha reapareceria
  // "Pausada" sem ninguém ter pausado. Então ela sai junto. Com o início ainda
  // no passado a pausa fica — a campanha segue pausada. (O limite é o mesmo do
  // status: só é "futuro" o início depois de agora.)
  const clearsPause = campaign.pausedAt !== null && (startsAt === null || startsAt.getTime() > now.getTime());

  const written = await attempt(() =>
    prisma.campaign.updateMany({
      // `archivedAt: null`: arquivada em outra aba no meio da edição não é editada.
      where: { id: campaign.id, tenantId: actor.tenantId, archivedAt: null },
      data: clearsPause ? { ...after, pausedAt: null } : after,
    }),
  );
  if (!written.ok) return serverError();
  if (written.value.count === 0) return statusChanged();

  await recordChange({
    event: "campaign.updated",
    target: { type: AUDIT_TYPE, id: campaign.id, label: after.name },
    before,
    after,
    // A pausa não entra no antes/depois (desfazer a edição não a restaura, de
    // propósito); o registro fica no contexto do evento.
    ...(clearsPause ? { meta: { pauseCleared: true } } : {}),
  });

  revalidateCampaign(campaign.id);
  return { ok: true, id: campaign.id };
}

/**
 * As quatro mudanças de status. Cada uma diz o que pede (`allowed`), o que
 * grava, a evidência no log e o que responde quando o status atual não deixa.
 */
type TransitionKind = "pause" | "resume" | "archive" | "unarchive";

/** O que uma mudança de status escreve: só as duas datas de estado, nunca o período. */
type StateDates = { pausedAt?: Date | null; archivedAt?: Date | null };

const TRANSITIONS: Record<
  TransitionKind,
  {
    event: AuditEvent;
    needs: keyof CampaignAllowed;
    info: string;
    /** O estado em que a escrita ainda vale — vai no `where` do `updateMany`. */
    onlyIf: Prisma.CampaignWhereInput;
    data: (now: Date) => StateDates;
    refusal: (status: CampaignStatus) => string;
  }
> = {
  pause: {
    event: "campaign.paused",
    needs: "pause",
    info: "Campanha pausada.",
    onlyIf: { archivedAt: null, pausedAt: null },
    data: (now) => ({ pausedAt: now }),
    refusal: (status) =>
      ({
        draft: "Só uma campanha ativa pode ser pausada, e esta ainda não começou.",
        paused: "Esta campanha já está pausada.",
        finished: "Campanha terminada não pode ser pausada.",
        archived: "Campanha arquivada não pode ser pausada.",
        active: "Só uma campanha ativa pode ser pausada.",
      })[status],
  },
  resume: {
    event: "campaign.resumed",
    needs: "resume",
    info: "Campanha retomada.",
    onlyIf: { archivedAt: null, pausedAt: { not: null } },
    data: () => ({ pausedAt: null }),
    refusal: (status) =>
      ({
        draft: "Esta campanha não está pausada.",
        active: "Esta campanha não está pausada.",
        finished: "Campanha terminada não pode ser retomada.",
        archived: "Campanha arquivada não pode ser retomada. Desarquive primeiro.",
        paused: "Esta campanha não está pausada.",
      })[status],
  },
  archive: {
    event: "campaign.archived",
    needs: "archive",
    info: "Campanha arquivada.",
    onlyIf: { archivedAt: null },
    data: (now) => ({ archivedAt: now }),
    refusal: () => "Esta campanha já está arquivada.",
  },
  unarchive: {
    event: "campaign.unarchived",
    needs: "unarchive",
    info: "Campanha desarquivada.",
    onlyIf: { archivedAt: { not: null } },
    data: () => ({ archivedAt: null }),
    refusal: () => "Esta campanha não está arquivada.",
  },
};

async function transition(kind: TransitionKind, id: string): Promise<Result> {
  const actor = await requireCampaignActor();
  if (!actor.canEdit) return forbidden();

  const campaign = await loadOwned(actor.tenantId, id);
  if (!campaign) return notFound();

  const rule = TRANSITIONS[kind];
  const now = new Date();
  const before = campaignStatus(campaign, now);
  if (!allowedActions(before)[rule.needs]) return refused(rule.refusal(before));

  const data = rule.data(now);
  const written = await attempt(() =>
    prisma.campaign.updateMany({ where: { id: campaign.id, tenantId: actor.tenantId, ...rule.onlyIf }, data }),
  );
  if (!written.ok) return serverError();
  if (written.value.count === 0) return statusChanged();

  // O status depois é o que as datas passam a mandar: desarquivar uma campanha
  // vencida, por exemplo, volta como "terminada", não como "ativa".
  const after = campaignStatus({ ...campaign, ...data }, now);
  await recordAudit({
    event: rule.event,
    target: { type: AUDIT_TYPE, id: campaign.id, label: campaign.name },
    before: { status: before },
    after: { status: after },
  });

  revalidateCampaign(campaign.id);
  return { ok: true, id: campaign.id, info: rule.info };
}

/** Só uma campanha ativa pausa (a pausa vale dentro do período). */
export async function pauseCampaign(id: string): Promise<Result> {
  return transition("pause", id);
}

/** Só uma campanha pausada retoma; a pausa é limpa. */
export async function resumeCampaign(id: string): Promise<Result> {
  return transition("resume", id);
}

/** Qualquer campanha não arquivada pode ser arquivada — inclusive a terminada. */
export async function archiveCampaign(id: string): Promise<Result> {
  return transition("archive", id);
}

/** Desarquivar volta ao status que as datas mandam. */
export async function unarchiveCampaign(id: string): Promise<Result> {
  return transition("unarchive", id);
}
