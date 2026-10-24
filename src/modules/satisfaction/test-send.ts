import { prisma } from "@/lib/prisma";
import { getOrCreateConversation } from "@/modules/agent-engine/conversation";
import { OPEN_STATUSES } from "./eligibility";
import { sendSurvey } from "./send";
import { getSurveySettings } from "./settings-store";

/**
 * Envio de teste da pesquisa para um número: manda a pergunta agora, ignorando
 * espera, faixa de horas e a regra de quem recebe — é para a clínica ver como
 * chega no próprio celular. A pesquisa grava `isTest` (fica fora do painel, do
 * alerta e do relatório); a conversa do número continua sendo a real, nunca
 * vira sandbox. Funciona com a pesquisa desligada, para testar antes de ligar.
 */

/** "(11) 98765-4321" → "5511987654321"; null quando não parece um número. */
export function normalizeTestPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) return digits;
  return null;
}

/** As formas do mesmo celular com e sem o nono dígito: o lead pode ter sido gravado por qualquer uma. */
function phoneForms(phone: string): string[] {
  const forms = [phone];
  if (phone.startsWith("55") && phone.length === 13 && phone[4] === "9") forms.push(phone.slice(0, 4) + phone.slice(5));
  if (phone.startsWith("55") && phone.length === 12) forms.push(phone.slice(0, 4) + "9" + phone.slice(4));
  return forms;
}

export type SurveyTestResult = { ok: true; info: string } | { ok: false; error: string };

export async function sendSurveyTest(tenantId: string, rawPhone: string): Promise<SurveyTestResult> {
  const phone = normalizeTestPhone(rawPhone);
  if (!phone) return { ok: false, error: "Informe o número com DDD, ex.: (11) 98765-4321." };

  const existing = await prisma.lead.findFirst({
    where: { tenantId, phone: { in: phoneForms(phone) } },
    select: { phone: true, isTest: true },
  });
  if (existing?.isTest) return { ok: false, error: "Esse número é do chat de teste do painel. Use o seu WhatsApp." };

  const { conversation } = await getOrCreateConversation(tenantId, existing?.phone ?? phone);

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
  return { ok: false, error: res.status === "waiting" || res.status === "skipped" ? res.reason : "Não foi possível enviar o teste." };
}
