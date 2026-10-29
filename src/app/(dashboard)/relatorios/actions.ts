"use server";

import { revalidatePath } from "next/cache";
import { requireTenant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { payloadTooLarge } from "@/lib/rate-limit";
import { recordAudit } from "@/modules/audit/log";
import { requireProductAccess } from "@/lib/require-product";
import { isSurveyTopic } from "@/modules/satisfaction/categories";
import { getSurveySettings, saveSurveySettings, surveySettingsFormSchema } from "@/modules/satisfaction/settings-store";
import { sendSurveyTest } from "@/modules/satisfaction/test-send";
import { campaignSettingsFormSchema, destinationProblem, getCampaignSettings, saveCampaignSettings } from "@/modules/campaign-reports/settings-store";
import { deliverCampaignReport } from "@/modules/campaign-reports/send";
import { requestHistoryImport } from "@/modules/campaign-reports/history-import";
import type { CampaignSendStatus } from "@/modules/campaign-reports/settings";
import {
  MAX_HOURLY_COST_CENTS,
  MAX_MINUTES_PER_LEAD,
} from "@/modules/agent-engine/disqualify";

type Result = { ok: boolean; error?: string; info?: string };

const MAX_CENTS = 1_000_000_000; // R$ 10 milhões de teto de sanidade

/** "500", "499,90" ou "1.234,56" → centavos (aceita pontos de milhar e vírgula). */
function parseReais(raw: string): number | null {
  const digits = raw.replace(/[^\d.,]/g, "").replace(/\.(?=\d{3}([.,]|$))/g, "").replace(",", ".");
  const value = Number(digits);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

/**
 * Define (ou altera) o valor de um lead fechado na visão Financeira de
 * /relatorios. `new` cria vigência a partir de agora; `correct` corrige a
 * vigência exibida, mantendo a data e recalculando as consultas que a usam.
 * Nenhuma das opções altera snapshots mensais aprovados.
 */
export async function saveLeadValue(_prev: Result | null, formData: FormData): Promise<Result> {
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };

  const { tenantId } = await requireTenant();

  const cents = parseReais(String(formData.get("value") ?? ""));
  if (!cents) {
    return { ok: false, error: "Informe um valor válido, ex.: 500 ou 499,90." };
  }
  if (cents > MAX_CENTS) {
    return { ok: false, error: "Valor muito alto (máx. R$ 10 milhões)." };
  }

  const mode = String(formData.get("mode") ?? "new");
  if (mode !== "new" && mode !== "correct") return { ok: false, error: "Escolha corrigir o valor exibido ou definir um novo valor." };
  if (mode === "correct") {
    const id = String(formData.get("valueId") ?? "");
    const before = Number(formData.get("valueBefore"));
    const startsAt = new Date(String(formData.get("valueStartsAt") ?? ""));
    if (!id || id.length > 100 || !Number.isSafeInteger(before) || before <= 0 || before > MAX_CENTS || !Number.isFinite(startsAt.getTime())) {
      return { ok: false, error: "Atualize a página e abra novamente o valor que deseja corrigir." };
    }
    // Checagem e escrita atômicas: não sobrescrever correção concorrente nem
    // permitir um id de outra conta, mesmo que o formulário seja adulterado.
    const changed = await prisma.tenantLeadValue.updateMany({
      where: { id, tenantId, valueCents: before, startsAt }, data: { valueCents: cents },
    });
    if (!changed.count) return { ok: false, error: "Este valor mudou ou não está disponível nesta conta. Atualize a página e confira antes de salvar." };
    await recordAudit({ event: "report.lead_value_saved", tenantId, target: { type: "TenantLeadValue", id },
      before: { valueCents: before, startsAt }, after: { valueCents: cents, startsAt }, meta: { mode } });
  } else {
    const saved = await prisma.tenantLeadValue.create({ data: { tenantId, valueCents: cents, startsAt: new Date() } });
    await recordAudit({ event: "report.lead_value_saved", tenantId, target: { type: "TenantLeadValue", id: saved.id },
      after: { valueCents: cents, startsAt: saved.startsAt }, meta: { mode } });
  }

  revalidatePath("/relatorios");
  return { ok: true, info: mode === "correct"
    ? "Valor do lead corrigido. O financeiro foi recalculado com esse valor."
    : "Novo valor salvo a partir de agora. O período selecionado pode continuar usando a vigência anterior." };
}

/**
 * Define (ou altera) o custo de um atendimento manual — a base da métrica de
 * triagem ("quanto o agente economizou filtrando quem não era cliente").
 *
 * Mesma vigência de `saveLeadValue`, pelo mesmo motivo: mudar o custo hoje não
 * reescreve o que já foi relatado. São dois campos num salvamento só porque
 * minutos e valor da hora só significam alguma coisa juntos — guardar um sem o
 * outro deixaria uma linha que não converte em dinheiro.
 */
export async function saveAttendanceCost(
  _prev: Result | null,
  formData: FormData,
): Promise<Result> {
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };

  const { tenantId } = await requireTenant();

  const minutes = Number(String(formData.get("minutes") ?? "").replace(/[^\d]/g, ""));
  const hourly = parseReais(String(formData.get("hourly") ?? ""));

  if (!Number.isInteger(minutes) || minutes <= 0) {
    return { ok: false, error: "Informe os minutos por atendimento, ex.: 8." };
  }
  if (minutes > MAX_MINUTES_PER_LEAD) {
    return { ok: false, error: `No máximo ${MAX_MINUTES_PER_LEAD} minutos por atendimento.` };
  }
  if (!hourly) {
    return { ok: false, error: "Informe o custo da hora, ex.: 30 ou 29,90." };
  }
  if (hourly > MAX_HOURLY_COST_CENTS) {
    return { ok: false, error: "Custo da hora muito alto (máx. R$ 100 mil)." };
  }

  await prisma.tenantAttendanceCost.create({
    data: { tenantId, minutesPerLead: minutes, hourlyCostCents: hourly, startsAt: new Date() },
  });

  revalidatePath("/relatorios");
  return { ok: true, info: "Custo salvo — períodos já iniciados mantêm o custo anterior." };
}

/**
 * Pesquisa de satisfação: ligar, esperar e os textos. O texto "aprovado" é
 * combinado com a Mavellium fora do sistema — aqui só se edita; a pesquisa sai
 * quando está ligada.
 */
export async function saveSurveySettingsAction(_prev: Result | null, formData: FormData): Promise<Result> {
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };
  const { session } = await requireProductAccess();
  const tenantId = session.user.tenantId;

  const parsed = surveySettingsFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };

  const before = await getSurveySettings(tenantId);
  const after = await saveSurveySettings(tenantId, parsed.data);
  await recordAudit({
    event: "survey.settings_updated",
    target: { type: "SatisfactionSurveySettings", id: tenantId, label: "Pesquisa de satisfação" },
    before,
    after,
  });
  revalidatePath("/relatorios");
  return { ok: true, info: "Pesquisa de satisfação salva." };
}

/** Envia a pergunta da nota para um número, agora (teste). */
export async function sendSurveyTestAction(_prev: Result | null, formData: FormData): Promise<Result> {
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };
  const { session } = await requireProductAccess();
  const tenantId = session.user.tenantId;
  const result = await sendSurveyTest(tenantId, String(formData.get("phone") ?? "").slice(0, 40));
  if (!result.ok) return { ok: false, error: result.error };
  await recordAudit({ event: "survey.test_sent", target: { type: "SatisfactionSurveySettings", id: tenantId, label: "Pesquisa de satisfação" } });
  return { ok: true, info: result.info };
}

/** Destino (grupo ou número), dia, hora e fuso do envio semanal do relatório de campanhas. */
export async function saveCampaignSettingsAction(_prev: Result | null, formData: FormData): Promise<Result> {
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };
  const { session } = await requireProductAccess();
  const tenantId = session.user.tenantId;

  const parsed = campaignSettingsFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };

  const questions = await prisma.knowledgeGapSettings.findUnique({ where: { tenantId }, select: { groupId: true } });
  const problem = destinationProblem(parsed.data, questions?.groupId ?? null);
  if (problem) return { ok: false, error: problem };

  const before = await getCampaignSettings(tenantId);
  const after = await saveCampaignSettings(tenantId, parsed.data);
  // O número não vai ao log de auditoria inteiro: só que existe e para onde o envio aponta.
  const audit = (s: typeof after) => ({
    enabled: s.enabled, weekday: s.weekday, hour: s.hour, timezone: s.timezone,
    destination: s.destination, hasGroup: Boolean(s.groupId), hasPhone: Boolean(s.phone),
  });
  await recordAudit({
    event: "campaign_report.settings_updated",
    target: { type: "CampaignReportSettings", id: tenantId, label: "Relatório semanal de campanhas" },
    before: audit(before),
    after: audit(after),
  });
  revalidatePath("/relatorios");
  return { ok: true, info: after.enabled ? "Envio semanal salvo." : "Envio semanal salvo, desligado." };
}

const SEND_NOW_ERRORS: Record<Exclude<CampaignSendStatus, "sent">, string> = {
  no_group: "Escolha o grupo do WhatsApp que recebe o relatório.",
  no_phone: "Informe o número que recebe o relatório e salve antes de enviar.",
  no_channel: "O WhatsApp por QR code não está conectado, e só ele envia relatório. Reconecte em Integrações.",
  no_data: "Ainda não há anúncio registrado nesta conta, então não há o que enviar.",
  refused: "Esse número é de um contato que a clínica não pode procurar por aqui (bloqueado, pediu para parar ou fala pela API oficial). Use outro número ou um grupo.",
  failed: "Não foi possível confirmar o envio. Confira o WhatsApp antes de tentar de novo, para não duplicar.",
};

/** Envia agora o relatório da última semana fechada, sem esperar o horário (também serve de teste). */
export async function sendCampaignReportNowAction(): Promise<Result> {
  const { session } = await requireProductAccess();
  const tenantId = session.user.tenantId;
  const status = await deliverCampaignReport(tenantId);
  await recordAudit({
    event: "campaign_report.sent_now",
    target: { type: "CampaignReportSettings", id: tenantId, label: "Relatório semanal de campanhas" },
    meta: { status },
  });
  revalidatePath("/relatorios");
  if (status !== "sent") return { ok: false, error: SEND_NOW_ERRORS[status] };
  const { destination } = await getCampaignSettings(tenantId);
  return { ok: true, info: destination === "phone" ? "Relatório enviado ao seu WhatsApp." : "Relatório enviado ao grupo." };
}

/**
 * Pede a leitura do histórico da Evolution para ligar os leads que já existem ao
 * anúncio de onde vieram. Só registra o pedido: o worker lê (leva minutos).
 */
export async function requestCampaignHistoryImportAction(): Promise<Result> {
  const { session } = await requireProductAccess();
  const tenantId = session.user.tenantId;
  const result = await requestHistoryImport(tenantId);
  if (!result.ok) return { ok: false, error: result.error };
  await recordAudit({
    event: "campaign_report.history_import_requested",
    target: { type: "CampaignReportSettings", id: tenantId, label: "Histórico de anúncios" },
  });
  revalidatePath("/relatorios");
  return { ok: true, info: "Importação pedida. Leva alguns minutos; a página se atualiza sozinha." };
}

/** Correção humana do motivo: vale mais que a classificação da IA e nunca é sobrescrita por ela. */
export async function setSurveyTopicAction(surveyId: string, topic: string): Promise<Result> {
  const { session } = await requireProductAccess();
  if (topic !== "" && !isSurveyTopic(topic)) return { ok: false, error: "Motivo inválido." };
  const res = await prisma.satisfactionSurvey.updateMany({
    where: { id: surveyId, tenantId: session.user.tenantId, rating: { not: null } },
    data: { topics: topic ? [topic] : [], classifiedBy: "human", classifiedAt: new Date() },
  });
  if (!res.count) return { ok: false, error: "Avaliação não encontrada." };
  revalidatePath("/relatorios");
  return { ok: true, info: "Motivo atualizado." };
}

/** Marca a avaliação baixa como revisada: sai do alerta do início. */
export async function markSurveyReviewedAction(surveyId: string): Promise<Result> {
  const { session } = await requireProductAccess();
  const res = await prisma.satisfactionSurvey.updateMany({
    where: { id: surveyId, tenantId: session.user.tenantId, reviewedAt: null },
    data: { reviewedAt: new Date(), reviewedById: session.user.id },
  });
  if (!res.count) return { ok: false, error: "Avaliação não encontrada ou já revisada." };
  revalidatePath("/relatorios");
  revalidatePath("/inicio");
  return { ok: true, info: "Avaliação marcada como revisada." };
}
