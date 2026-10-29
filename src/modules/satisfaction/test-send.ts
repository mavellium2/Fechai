import { prisma } from "@/lib/prisma";
import { normalizeBrazilianPhone } from "@/modules/whatsapp/contact-phone";
import { OPEN_STATUSES, SURVEY_WINDOW_HOURS } from "./eligibility";
import { sendSurvey } from "./send";
import { getSurveySettings } from "./settings-store";

/**
 * Envio de teste da pesquisa para um número: manda a pergunta agora, ignorando
 * espera, faixa de horas e a regra de quem recebe — é para a clínica ver como
 * chega no próprio celular. A pesquisa grava `isTest` (fica fora do painel, do
 * alerta e do relatório); a conversa do número continua sendo a real, nunca
 * vira sandbox. Funciona com a pesquisa desligada, para testar antes de ligar.
 *
 * **Só para quem já escreveu para a clínica nas últimas 24h**, pelo número em
 * que escreveu (`Conversation.whatsappProvider` gravado): é o mesmo limite da
 * pesquisa de verdade. Sem isso o envio cairia no QR para um número que nunca
 * falou com a clínica — primeiro contato, que leva ao bloqueio do número — ou
 * seria recusado pela Meta fora da janela. Nunca cria Lead nem Conversa.
 * Bloqueio e "pare" continuam valendo (`sendSurvey`).
 */

/** "(11) 98765-4321" → "5511987654321"; null quando não parece um número. */
export const normalizeTestPhone = normalizeBrazilianPhone;

/** As formas do mesmo celular com e sem o nono dígito: o lead pode ter sido gravado por qualquer uma. */
function phoneForms(phone: string): string[] {
  const forms = [phone];
  if (phone.startsWith("55") && phone.length === 13 && phone[4] === "9") forms.push(phone.slice(0, 4) + phone.slice(5));
  if (phone.startsWith("55") && phone.length === 12) forms.push(phone.slice(0, 4) + "9" + phone.slice(4));
  return forms;
}

export type SurveyTestResult = { ok: true; info: string } | { ok: false; error: string };

export const TEST_NEEDS_MESSAGE =
  "Mande uma mensagem para o número da clínica a partir desse celular e tente de novo em até 24h.";

export async function sendSurveyTest(tenantId: string, rawPhone: string, now: Date = new Date()): Promise<SurveyTestResult> {
  const phone = normalizeTestPhone(rawPhone);
  if (!phone) return { ok: false, error: "Informe o número com DDD, ex.: (11) 98765-4321." };

  const conversation = await prisma.conversation.findFirst({
    where: { tenantId, lead: { phone: { in: phoneForms(phone) } } },
    orderBy: { lastInboundAt: { sort: "desc", nulls: "last" } },
    select: { id: true, isTest: true, whatsappProvider: true, lastInboundAt: true, lead: { select: { isTest: true } } },
  });
  if (conversation && (conversation.isTest || conversation.lead.isTest)) {
    return { ok: false, error: "Esse número é do chat de teste do painel. Use o seu WhatsApp." };
  }
  const windowMs = SURVEY_WINDOW_HOURS * 3_600_000;
  if (
    !conversation ||
    !conversation.whatsappProvider ||
    !conversation.lastInboundAt ||
    now.getTime() - conversation.lastInboundAt.getTime() > windowMs
  ) {
    return { ok: false, error: TEST_NEEDS_MESSAGE };
  }

  const open = await prisma.satisfactionSurvey.findFirst({
    where: { conversationId: conversation.id, status: { in: [...OPEN_STATUSES] } },
    select: { id: true },
  });
  if (open) return { ok: false, error: "Já há uma pesquisa em andamento para esse número. Responda a ela ou aguarde 24 horas." };

  const settings = await getSurveySettings(tenantId);
  const res = await sendSurvey({ tenantId, conversationId: conversation.id, settings, isTest: true });
  if (res.status === "sent") return { ok: true, info: "Teste enviado. Responda no WhatsApp desse número para ver o fluxo completo." };
  if (res.status === "unknown") {
    return { ok: false, error: "O WhatsApp não confirmou o envio. Confira o celular antes de tentar de novo." };
  }
  return { ok: false, error: "reason" in res ? res.reason : "Não foi possível enviar o teste." };
}
