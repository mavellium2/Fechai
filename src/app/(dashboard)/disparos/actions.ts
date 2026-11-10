"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  requireBroadcastActor,
  requireBroadcastAccess,
} from "@/modules/broadcasts/access";
import { getBroadcastConnection } from "@/modules/broadcasts/connection";
import {
  inspectBroadcastFile,
  parseBroadcastFile,
  parseBroadcastRows,
  type ColumnMapping,
  type ImportResult,
} from "@/modules/broadcasts/import";
import {
  listRows,
  namelessValues,
  validateListInput,
  type ListContact,
  type NamelessMode,
  type VariableSource,
} from "@/modules/broadcasts/contacts";
import {
  searchBroadcastContacts,
  type LeadStatusFilter,
} from "@/modules/broadcasts/contact-search";
import {
  getBroadcastSummary,
  listBroadcastPage,
  type BroadcastFilter,
} from "@/modules/broadcasts/queries";
import {
  campaignTemplates,
  templatesStillApproved,
  type BroadcastTemplate,
} from "@/modules/broadcasts/template";
import ExcelJS from "exceljs";
import {
  parseBroadcastSchedule,
  nextBroadcastTime,
  type ScheduleInput,
} from "@/modules/broadcasts/schedule";
import { broadcastPhoneVariants, normalizeBroadcastPhone } from "@/modules/broadcasts/phone";
import { sendBroadcastRecipient } from "@/modules/broadcasts/send";
import { recentlyContacted } from "@/modules/broadcasts/recent";
import { broadcastCsv } from "@/modules/broadcasts/csv";
import {
  isMediaFormat,
  parseCampaignMedia,
  type CampaignMedia,
} from "@/modules/broadcasts/media";
import {
  checkBroadcastMedia,
  storeBroadcastMedia,
} from "@/modules/broadcasts/media-storage";

/**
 * Guarda o arquivo do topo ("o mesmo para todos") assim que é escolhido. A
 * tela devolve o resultado ao preparar o rascunho, e o servidor confere que o
 * link é desta conta (`checkBroadcastMedia`).
 */
export async function uploadBroadcastMedia(form: FormData) {
  const tenantId = await requireBroadcastAccess();
  const file = form.get("file");
  const format = form.get("format");
  if (!(file instanceof File) || !isMediaFormat(format))
    return { ok: false as const, error: "Escolha o arquivo." };
  try {
    return await storeBroadcastMedia(tenantId, format, file);
  } catch {
    return { ok: false as const, error: "Não foi possível guardar o arquivo agora. Tente de novo." };
  }
}

/** O mesmo arquivo copiado em cada contato (modo "o mesmo para todos"). */
function withMedia(parsed: ImportResult, media: CampaignMedia | null): ImportResult {
  if (media?.mode !== "file") return parsed;
  return {
    ...parsed,
    recipients: parsed.recipients.map((r) => ({
      ...r,
      mediaUrl: media.url,
      mediaFilename: media.filename,
    })),
  };
}

export async function loadBroadcastTemplates() {
  const tenantId = await requireBroadcastAccess();
  const connection = await getBroadcastConnection(tenantId);
  if (!connection)
    return {
      ok: false as const,
      error:
        "Conecte a API oficial da Meta em Integrações para preparar disparos.",
    };
  try {
    return {
      ok: true as const,
      templates: await connection.provider.listBroadcastTemplates({ media: true }),
    };
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof Error
          ? error.message
          : "Não foi possível carregar os templates.",
    };
  }
}

export async function prepareBroadcast(form: FormData) {
  const tenantId = await requireBroadcastAccess();
  const name = String(form.get("name") ?? "").trim();
  const templateId = String(form.get("templateId") ?? "");
  const file = form.get("file");
  const draftId = String(form.get("draftId") ?? "") || undefined;
  if (!name || name.length > 100)
    return {
      ok: false as const,
      error: "Dê um nome ao disparo (até 100 caracteres).",
    };
  if (!(file instanceof File))
    return { ok: false as const, error: "Selecione um arquivo Excel ou JSON." };
  const connection = await getBroadcastConnection(tenantId);
  if (!connection)
    return {
      ok: false as const,
      error: "Conecte a API oficial da Meta em Integrações.",
    };
  let template: BroadcastTemplate | undefined;
  let parsed: Awaited<ReturnType<typeof parseBroadcastFile>>;
  let media: CampaignMedia | null = null;
  try {
    template = (await connection.provider.listBroadcastTemplates({ media: true })).find(
      (t) => t.id === templateId,
    );
    if (!template)
      return {
        ok: false as const,
        error: "Selecione um template aprovado e compatível. Atualize a lista.",
      };
    const rawMapping = form.get("mapping");
    const mapping = rawMapping ? (JSON.parse(String(rawMapping)) as ColumnMapping) : undefined;
    if (template.mediaFormat) {
      const rawMedia = form.get("media");
      const checked = checkBroadcastMedia(
        tenantId,
        template.mediaFormat,
        rawMedia ? JSON.parse(String(rawMedia)) : null,
        { column: typeof mapping?.media === "string" ? mapping.media.trim() : undefined },
      );
      if (!checked.ok) return { ok: false as const, error: checked.error };
      media = checked.media;
    }
    // A coluna do link só vale no modo "link por contato".
    if (mapping && media?.mode !== "column") delete mapping.media;
    parsed = withMedia(await parseBroadcastFile(file, template, mapping), media);
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof Error
          ? error.message
          : "Não foi possível ler o arquivo.",
    };
  }
  return saveDraft(tenantId, name, connection.phoneNumberId, template, parsed, draftId, null, 0, media);
}

/**
 * Rascunho a partir do resultado validado — o mesmo para arquivo e lista.
 * Com `draftId`, atualiza o mesmo rascunho (voltar e ajustar não cria outro);
 * os testes já enviados ficam, porque são mensagens reais.
 */
async function saveDraft(
  tenantId: string,
  name: string,
  phoneNumberId: string,
  template: BroadcastTemplate,
  parsed: ImportResult,
  draftId?: string,
  namelessTemplate: BroadcastTemplate | null = null,
  skippedNameless = 0,
  media: CampaignMedia | null = null,
) {
  // Nunca descarta erros silenciosamente nem envia só parte de uma lista inválida.
  if (parsed.issues.length)
    return {
      ok: false as const,
      error: `Corrija ${parsed.issues.length === 1 ? "o contato inválido" : `os ${parsed.issues.length} contatos inválidos`} antes de continuar.`,
      issues: parsed.issues,
    };
  if (!parsed.recipients.length)
    return {
      ok: false as const,
      error: "Nenhum destinatário válido encontrado.",
    };
  const campaign = await prisma.$transaction(async (tx) => {
    if (draftId) {
      const updated = await tx.broadcastCampaign.updateMany({
        where: { id: draftId, tenantId, status: "draft" },
        data: {
          name,
          phoneNumberId,
          template,
          namelessTemplate: namelessTemplate ?? Prisma.DbNull,
          media: media ?? Prisma.DbNull,
        },
      });
      if (updated.count) {
        await tx.broadcastRecipient.deleteMany({
          where: { campaignId: draftId, isTest: false },
        });
        await tx.broadcastRecipient.createMany({
          data: parsed.recipients.map((r) => ({ ...r, campaignId: draftId })),
        });
        return { id: draftId };
      }
    }
    return tx.broadcastCampaign.create({
      data: {
        tenantId,
        name,
        phoneNumberId,
        template,
        namelessTemplate: namelessTemplate ?? Prisma.DbNull,
        media: media ?? Prisma.DbNull,
        recipients: { createMany: { data: parsed.recipients } },
      },
      select: { id: true },
    });
  });
  revalidatePath("/disparos");
  return {
    ok: true as const,
    id: campaign.id,
    name,
    template,
    namelessTemplate,
    skippedNameless,
    media,
    ...parsed,
    recentPhones: await recentlyContacted(
      tenantId,
      parsed.recipients.map((r) => r.phone),
      campaign.id,
    ),
  };
}

/**
 * Rascunho com contatos escolhidos na conta ou digitados. Passa pela mesma
 * validação do arquivo (`parseBroadcastRows`); o template é relido na Meta.
 */
export async function prepareBroadcastFromList(input: {
  name: string;
  templateId: string;
  draftId?: string;
  contacts: ListContact[];
  variables: VariableSource[];
  /** Quem não tem nome: outra mensagem aprovada, texto no lugar ou fica de fora. */
  nameless?: { mode: NamelessMode; templateId?: string };
  /** Arquivo do topo, quando a mensagem tem mídia (`uploadBroadcastMedia`). */
  media?: unknown;
}) {
  const tenantId = await requireBroadcastAccess();
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 100)
    return {
      ok: false as const,
      error: "Dê um nome ao disparo (até 100 caracteres).",
    };
  const connection = await getBroadcastConnection(tenantId);
  if (!connection)
    return {
      ok: false as const,
      error: "Conecte a API oficial da Meta em Integrações.",
    };
  let template: BroadcastTemplate | undefined;
  let namelessTemplate: BroadcastTemplate | null = null;
  let skipped = 0;
  let parsed: ImportResult;
  let media: CampaignMedia | null = null;
  try {
    const approved = await connection.provider.listBroadcastTemplates({ media: true });
    template = approved.find((t) => t.id === input.templateId);
    if (!template)
      return {
        ok: false as const,
        error: "Selecione um template aprovado e compatível. Atualize a lista.",
      };
    if (template.mediaFormat) {
      // Sem planilha não há coluna: só o mesmo arquivo para todos.
      const checked = checkBroadcastMedia(tenantId, template.mediaFormat, input.media);
      if (!checked.ok) return { ok: false as const, error: checked.error };
      media = checked.media;
    }
    const { contacts, variables, nameless } = validateListInput(
      input.contacts,
      input.variables,
      template.parameterCount,
      input.nameless,
    );
    const { main, nameless: namelessRows, skipped: left, issues } = listRows(
      contacts,
      variables,
      nameless.mode,
    );
    skipped = left;
    if (namelessRows.length) {
      namelessTemplate = approved.find((t) => t.id === nameless.templateId) ?? null;
      const expected = namelessValues(variables).length;
      if (!namelessTemplate)
        return {
          ok: false as const,
          error: "A mensagem para quem não tem nome não está mais aprovada. Escolha outra.",
        };
      if ((namelessTemplate.mediaFormat ?? null) !== (template.mediaFormat ?? null))
        return {
          ok: false as const,
          error: template.mediaFormat
            ? "A mensagem para quem não tem nome precisa ter o mesmo tipo de arquivo no topo."
            : "A mensagem para quem não tem nome não pode ter arquivo no topo.",
        };
      if (namelessTemplate.parameterCount !== expected)
        return {
          ok: false as const,
          error: `A mensagem para quem não tem nome precisa ter ${expected === 0 ? "nenhum espaço" : expected === 1 ? "1 espaço" : `${expected} espaços`} (os que não são o nome).`,
        };
    }
    const empty: ImportResult = { recipients: [], issues: [], duplicates: 0, total: 0 };
    const withName = main.length ? parseBroadcastRows(main, template) : empty;
    const withoutName =
      namelessRows.length && namelessTemplate
        ? parseBroadcastRows(namelessRows, namelessTemplate)
        : empty;
    // O mesmo número colado com e sem nome recebe uma vez só: vale a versão com nome.
    const taken = new Set(withName.recipients.flatMap((r) => broadcastPhoneVariants(r.phone)));
    const extra = withoutName.recipients.filter((r) => !taken.has(r.phone));
    parsed = withMedia({
      recipients: [
        ...withName.recipients,
        ...extra.map((r) => ({ ...r, variant: "nameless" as const })),
      ].sort((a, b) => a.row - b.row),
      issues: [...issues, ...withName.issues, ...withoutName.issues].sort((a, b) => a.row - b.row),
      duplicates:
        withName.duplicates + withoutName.duplicates + (withoutName.recipients.length - extra.length),
      total: contacts.length,
    }, media);
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof Error
          ? error.message
          : "Não foi possível preparar os contatos.",
    };
  }
  return saveDraft(
    tenantId,
    name,
    connection.phoneNumberId,
    template,
    parsed,
    typeof input.draftId === "string" ? input.draftId : undefined,
    namelessTemplate,
    skipped,
    media,
  );
}

export async function listBroadcastContacts(
  q: string,
  status: LeadStatusFilter,
  page = 1,
) {
  const tenantId = await requireBroadcastAccess();
  return searchBroadcastContacts(
    tenantId,
    typeof q === "string" ? q : "",
    status,
    page,
  );
}


export async function startBroadcast(
  id: string,
  consent: boolean,
  input: ScheduleInput = {},
  acknowledgeRecent = false,
  /** Nome editado na última etapa; vazio mantém o do rascunho. */
  rename?: string,
) {
  const { tenantId, userId, label } = await requireBroadcastActor();
  if (consent !== true)
    return {
      ok: false,
      error:
        "Confirme que os contatos autorizaram o recebimento das mensagens.",
    };
  const campaign = await prisma.broadcastCampaign.findFirst({
    where: { id, tenantId },
  });
  if (!campaign) return { ok: false, error: "Disparo não encontrado." };
  if (campaign.status === "cancelled")
    return {
      ok: false,
      error: "Este disparo foi cancelado. Prepare um novo disparo.",
    };
  if (campaign.status !== "draft") return { ok: true }; // confirmação repetida nunca reabre a fila
  const connection = await getBroadcastConnection(tenantId);
  if (!connection || connection.phoneNumberId !== campaign.phoneNumberId)
    return {
      ok: false,
      error: "A conexão Meta mudou. Prepare um novo disparo.",
    };
  try {
    const approved = await connection.provider.listBroadcastTemplates({ media: true });
    if (!templatesStillApproved(campaignTemplates(campaign), approved))
      return {
        ok: false,
        error:
          "O template mudou ou não está mais aprovado. Prepare um novo disparo.",
      };
  } catch {
    return {
      ok: false,
      error: "Não foi possível validar o template na Meta. Tente novamente.",
    };
  }
  let schedule;
  try {
    schedule = parseBroadcastSchedule(input);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Agenda inválida.",
    };
  }
  const recipients = await prisma.broadcastRecipient.findMany({
    where: { campaignId: id, isTest: false },
    select: { phone: true },
  });
  const recentPhones = await recentlyContacted(
    tenantId,
    recipients.map((r) => r.phone),
    id,
  );
  if (recentPhones.length && acknowledgeRecent !== true)
    return {
      ok: false,
      error: `${recentPhones.length} contatos têm envios nos últimos 7 dias. Confirme o aviso antes de continuar.`,
      recentPhones,
    };
  const started = await prisma.broadcastCampaign.updateMany({
    where: { id, tenantId, status: "draft" },
    data: {
      ...(typeof rename === "string" && rename.trim() && rename.trim().length <= 100
        ? { name: rename.trim() }
        : {}),
      status: "queued",
      confirmedAt: new Date(),
      confirmedBy: userId,
      confirmedByLabel: label,
      consentVersion: "whatsapp-opt-in-v1",
      ...schedule,
      nextAttemptAt: nextBroadcastTime(schedule),
    },
  });
  if (!started.count) {
    const current = await prisma.broadcastCampaign.findFirst({
      where: { id, tenantId, status: { in: ["queued", "completed"] } },
      select: { id: true },
    });
    if (!current)
      return {
        ok: false,
        error: "O disparo foi cancelado durante a confirmação.",
      };
  }
  revalidatePath("/disparos");
  return {
    ok: true,
    info: "Disparo confirmado. Os envios seguem em segundo plano, dentro do horário escolhido.",
  };
}

export async function cancelBroadcast(id: string) {
  const tenantId = await requireBroadcastAccess();
  await prisma.$transaction(async (tx) => {
    await tx.broadcastCampaign.updateMany({
      where: { id, tenantId, status: { in: ["draft", "queued", "paused"] } },
      data: { status: "cancelled", finishedAt: new Date() },
    });
    await tx.broadcastRecipient.updateMany({
      where: {
        campaignId: id,
        campaign: { tenantId, status: "cancelled" },
        status: "pending",
      },
      data: { status: "cancelled" },
    });
  });
  revalidatePath("/disparos");
  return {
    ok: true,
    info: "Disparo cancelado. Quem ainda não tinha recebido não vai receber.",
  };
}

/**
 * Descarta um rascunho. Sem teste enviado, apaga; com teste, cancela — o teste
 * foi uma mensagem real e continua no histórico (atribuição de resposta).
 */
export async function discardBroadcastDraft(id: string) {
  const tenantId = await requireBroadcastAccess();
  const tests = await prisma.broadcastRecipient.count({
    where: { campaignId: id, isTest: true, campaign: { tenantId } },
  });
  if (tests)
    await prisma.broadcastCampaign.updateMany({
      where: { id, tenantId, status: "draft" },
      data: { status: "cancelled", finishedAt: new Date() },
    });
  else
    await prisma.broadcastCampaign.deleteMany({
      where: { id, tenantId, status: "draft" },
    });
  revalidatePath("/disparos");
  return { ok: true, info: "Rascunho descartado." };
}

export async function getBroadcastCampaign(id: string) {
  const tenantId = await requireBroadcastAccess();
  const [summary, rows] = await Promise.all([
    getBroadcastSummary(tenantId, id),
    getBroadcastDetails(id),
  ]);
  return summary ? { summary, rows } : null;
}

export async function refreshBroadcasts(filter: BroadcastFilter = {}) {
  return listBroadcastPage(await requireBroadcastAccess(), filter);
}

export async function getBroadcastDetails(id: string) {
  const tenantId = await requireBroadcastAccess();
  return prisma.broadcastRecipient.findMany({
    where: { campaignId: id, campaign: { tenantId } },
    orderBy: { row: "asc" },
    take: 1010,
    select: {
      id: true,
      row: true,
      phone: true,
      name: true,
      content: true,
      status: true,
      error: true,
      isTest: true,
      variant: true,
      deliveryStatus: true,
      deliveryError: true,
      sentAt: true,
      deliveredAt: true,
      readAt: true,
      repliedAt: true,
      qualifiedAt: true,
      appointmentId: true,
    },
  });
}

export async function getBroadcastReview(id: string) {
  const tenantId = await requireBroadcastAccess();
  const campaign = await prisma.broadcastCampaign.findFirst({
    where: { id, tenantId, status: "draft" },
    include: {
      recipients: { where: { isTest: false }, orderBy: { row: "asc" } },
    },
  });
  if (!campaign) return null;
  return {
    id: campaign.id,
    name: campaign.name,
    template: campaign.template as BroadcastTemplate,
    namelessTemplate: (campaign.namelessTemplate as BroadcastTemplate | null) ?? null,
    media: parseCampaignMedia(campaign.media),
    skippedNameless: 0,
    duplicates: 0,
    recentPhones: await recentlyContacted(
      tenantId,
      campaign.recipients.map((r) => r.phone),
      id,
    ),
    recipients: campaign.recipients.map((r) => ({
      row: r.row,
      phone: r.phone,
      name: r.name,
      parameters: r.parameters as string[],
      content: r.content,
      variant: r.variant === "nameless" ? ("nameless" as const) : ("main" as const),
      mediaUrl: r.mediaUrl,
      mediaFilename: r.mediaFilename,
    })),
  };
}

export async function downloadBroadcastExample(
  format: "xlsx" | "json",
  parameterCount: number,
  /** Mensagem com mídia: inclui a coluna com o link de cada contato. */
  withMediaColumn = false,
) {
  await requireBroadcastAccess();
  if (
    !Number.isInteger(parameterCount) ||
    parameterCount < 0 ||
    parameterCount > 20
  )
    throw new Error("Quantidade de variáveis inválida.");
  const row = {
    telefone: "5511987654321",
    nome: "Ana",
    ...Object.fromEntries(
      Array.from({ length: parameterCount }, (_, i) => [
        `var_${i + 1}`,
        i === 0 ? "Ana" : "Exemplo",
      ]),
    ),
    ...(withMediaColumn === true
      ? { link_arquivo: "https://seusite.com.br/arquivos/folheto.jpg" }
      : {}),
  };
  if (format === "json")
    return Buffer.from(JSON.stringify([row], null, 2)).toString("base64");
  if (format !== "xlsx") throw new Error("Formato inválido.");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Contatos");
  sheet.addRow(Object.keys(row));
  sheet.addRow(Object.values(row));
  sheet.columns.forEach((column) => {
    column.width = 24;
    column.numFmt = "@";
  });
  sheet.getRow(1).font = { bold: true };
  return Buffer.from(await workbook.xlsx.writeBuffer()).toString("base64");
}

export async function inspectBroadcastImport(form: FormData) {
  await requireBroadcastAccess();
  const file = form.get("file");
  if (!(file instanceof File))
    return { ok: false as const, error: "Selecione um arquivo." };
  try {
    return { ok: true as const, ...(await inspectBroadcastFile(file)) };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Arquivo inválido.",
    };
  }
}

export async function pauseBroadcast(id: string) {
  const tenantId = await requireBroadcastAccess();
  await prisma.broadcastCampaign.updateMany({
    where: { id, tenantId, status: "queued" },
    data: {
      status: "paused",
      pausedAt: new Date(),
      error: "Pausado pelo responsável da conta.",
    },
  });
  revalidatePath("/disparos");
  return {
    ok: true,
    info: "Disparo pausado. Quem ainda não recebeu fica aguardando você retomar.",
  };
}

export async function resumeBroadcast(id: string) {
  const tenantId = await requireBroadcastAccess();
  const campaign = await prisma.broadcastCampaign.findFirst({
    where: { id, tenantId, status: "paused" },
  });
  if (!campaign) return { ok: false, error: "Disparo pausado não encontrado." };
  const connection = await getBroadcastConnection(tenantId);
  if (!connection || connection.phoneNumberId !== campaign.phoneNumberId)
    return {
      ok: false,
      error: "Reconecte o mesmo número da Meta usado neste disparo.",
    };
  try {
    const approved = await connection.provider.listBroadcastTemplates({ media: true });
    if (!templatesStillApproved(campaignTemplates(campaign), approved))
      return {
        ok: false,
        error: "O template original precisa estar aprovado e sem alterações.",
      };
  } catch {
    return {
      ok: false,
      error: "Não foi possível consultar a Meta. Tente novamente.",
    };
  }
  await prisma.broadcastCampaign.updateMany({
    where: { id, tenantId, status: "paused" },
    data: {
      status: "queued",
      pausedAt: null,
      error: null,
      retryCount: 0,
      nextAttemptAt: nextBroadcastTime(campaign),
    },
  });
  revalidatePath("/disparos");
  return { ok: true, info: "Disparo retomado." };
}

export async function sendBroadcastTest(id: string, rawPhone: string) {
  const tenantId = await requireBroadcastAccess();
  const phone = normalizeBroadcastPhone(rawPhone);
  if (!phone)
    return { ok: false, error: "Informe o número de teste com DDI e DDD." };
  const campaign = await prisma.broadcastCampaign.findFirst({
    where: { id, tenantId, status: "draft" },
    include: {
      recipients: {
        where: { isTest: false },
        // "main" vem antes de "nameless": o teste usa um contato com nome se houver.
        orderBy: [{ variant: "asc" }, { row: "asc" }],
        take: 1,
      },
    },
  });
  if (!campaign?.recipients[0])
    return { ok: false, error: "Rascunho não encontrado." };
  const existing = await prisma.broadcastRecipient.findUnique({
    where: { campaignId_phone_isTest: { campaignId: id, phone, isTest: true } },
  });
  // "Ignorado" (bloqueado ou pediu para parar) nunca chegou à Meta: o motivo é
  // conferido de novo, senão desbloquear o número não mudaria nada na tela.
  if (existing && existing.status !== "skipped")
    return {
      ok: existing.status === "sent",
      error:
        existing.status === "sent"
          ? undefined
          : (existing.error ??
            "O teste para este número já foi solicitado. Confira o histórico."),
      status: existing.status,
    };
  const connection = await getBroadcastConnection(tenantId);
  if (!connection || connection.phoneNumberId !== campaign.phoneNumberId)
    return {
      ok: false,
      error: "Reconecte o número da Meta usado neste rascunho.",
    };
  try {
    const approved = await connection.provider.listBroadcastTemplates({ media: true });
    if (!templatesStillApproved(campaignTemplates(campaign), approved))
      return { ok: false, error: "O template mudou. Prepare outro rascunho." };
  } catch {
    return { ok: false, error: "Não foi possível validar o template na Meta." };
  }
  const sample = campaign.recipients[0];
  const recipient = await prisma.$transaction(async (tx) => {
    const locked = await tx.broadcastCampaign.updateMany({
      where: {
        id,
        tenantId,
        status: "draft",
        OR: [
          { lastTestAt: null },
          { lastTestAt: { lt: new Date(Date.now() - 30_000) } },
        ],
      },
      data: { lastTestAt: new Date() },
    });
    if (!locked.count) return null;
    if (existing) {
      const reopened = await tx.broadcastRecipient.updateMany({
        where: { id: existing.id, status: "skipped" },
        data: { status: "pending", error: null },
      });
      return reopened.count
        ? tx.broadcastRecipient.findUnique({ where: { id: existing.id } })
        : null;
    }
    if (
      (await tx.broadcastRecipient.count({
        where: { campaignId: id, isTest: true },
      })) >= 5
    )
      return null;
    return tx.broadcastRecipient.upsert({
      where: {
        campaignId_phone_isTest: { campaignId: id, phone, isTest: true },
      },
      update: {},
      create: {
        campaignId: id,
        phone,
        isTest: true,
        row: 0,
        name: "Teste",
        parameters: sample.parameters!,
        content: sample.content,
        variant: sample.variant,
        mediaUrl: sample.mediaUrl,
        mediaFilename: sample.mediaFilename,
      },
    });
  });
  if (!recipient)
    return {
      ok: false,
      error:
        "Aguarde 30 segundos entre testes. Cada rascunho permite até 5 números de teste.",
    };
  const accepted = await sendBroadcastRecipient(
    campaign,
    recipient,
    connection,
  );
  const result = await prisma.broadcastRecipient.findUnique({
    where: { id: recipient.id },
    select: { status: true, error: true },
  });
  revalidatePath("/disparos");
  return {
    ok: accepted || result?.status === "sent",
    status: result?.status,
    error:
      result?.error ??
      (accepted
        ? undefined
        : "Teste não enviado. Confira os contatos do disparo."),
  };
}

export async function exportBroadcast(id: string) {
  // getBroadcastDetails também valida o tenant; guarda explícito para esta action pública.
  const tenantId = await requireBroadcastAccess();
  const campaign = await prisma.broadcastCampaign.findFirst({
    where: { id, tenantId },
    select: { confirmedAt: true, confirmedByLabel: true, consentVersion: true },
  });
  if (!campaign) throw new Error("Disparo não encontrado.");
  const rows = await getBroadcastDetails(id);
  const iso = (date: Date | null) => date?.toISOString() ?? "";
  return Buffer.from(
    broadcastCsv([
      [
        "linha",
        "telefone",
        "nome",
        "teste",
        "envio",
        "entrega",
        "erro",
        "aceito_em",
        "entregue_em",
        "lido_em",
        "respondeu_em",
        "oportunidade_em",
        "agendamento",
        "confirmado_por",
        "confirmado_em",
        "consentimento",
      ],
      ...rows.map((r) => [
        r.row,
        r.phone,
        r.name,
        r.isTest ? "sim" : "não",
        r.status,
        r.deliveryStatus,
        r.deliveryError ?? r.error,
        iso(r.sentAt),
        iso(r.deliveredAt),
        iso(r.readAt),
        iso(r.repliedAt),
        iso(r.qualifiedAt),
        r.appointmentId,
        campaign.confirmedByLabel,
        iso(campaign.confirmedAt),
        campaign.consentVersion,
      ]),
    ]),
  ).toString("base64");
}
