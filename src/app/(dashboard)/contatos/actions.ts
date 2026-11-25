"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { payloadTooLarge } from "@/lib/rate-limit";
import { getOrCreateConversation, sendManualReply } from "@/modules/agent-engine/conversation";
import { recordAudit } from "@/modules/audit/log";
import { editContactProfile, readContactProfileForm } from "@/modules/crm/contact-profile";

type Result = { ok: boolean; error?: string; info?: string };

const MESSAGE_LIMIT = 4096;

const messageSchema = z
  .string()
  .trim()
  .min(1, "Escreva a mensagem antes de enviar")
  .max(MESSAGE_LIMIT, `Mensagem muito longa (máx. ${MESSAGE_LIMIT} caracteres)`);

const phoneSchema = z
  .string()
  .trim()
  .min(1, "Informe o telefone do contato");

const nameSchema = z.string().trim().max(80, "Nome muito longo").optional();

/** Normaliza para E.164 (55 + DDD + número). Aceita formato livre do Brasil. */
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 13) return null;
  if (!/^[1-9]/.test(digits)) return null;
  return digits.length <= 11 ? `55${digits}` : digits;
}

function revalidateContatos() {
  revalidatePath("/contatos");
  revalidatePath("/conversas");
  revalidatePath("/inicio");
}

/**
 * Envia uma mensagem para o WhatsApp de um contato da conta. Usa o mesmo
 * núcleo de `/conversas` (`sendManualReply`): grava com `sentBy: "human"` e
 * pausa o agente nesta conversa, para ele não responder por cima depois.
 */
export async function sendMessageToContact(leadId: string, text: string): Promise<Result> {
  const { tenantId, session } = await requireTenant();
  const parsed = messageSchema.safeParse(text);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };

  const lead = await prisma.lead.findFirst({ where: { id: leadId, tenantId } });
  if (!lead) return { ok: false, error: "Contato não encontrado." };
  // `isTest` em vez do telefone literal: o sandbox agora tem um por agente.
  // Aqui (diferente de /conversas) recusa de propósito: quem manda mensagem
  // pela tela de Contatos espera que ela chegue a um WhatsApp de verdade.
  if (lead.isTest) {
    return { ok: false, error: "Este contato é do chat de teste — envie para um WhatsApp real." };
  }

  const { conversation } = await getOrCreateConversation(tenantId, lead.phone, lead.name ?? undefined);
  const res = await sendManualReply(tenantId, conversation.id, parsed.data, undefined, undefined, session?.user.id);
  if (!res.ok) return res;

  revalidateContatos();
  return { ok: true, info: "Mensagem enviada." };
}

/**
 * Cadastra um contato novo (nome + telefone). Se o número já existir na conta,
 * devolve o contato existente em vez de duplicar (mesma regra do webhook).
 */
export async function addContact(_prev: Result | null, formData: FormData): Promise<Result> {
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };

  const { tenantId } = await requireTenant();

  const rawPhone = phoneSchema.safeParse(formData.get("phone"));
  if (!rawPhone.success) return { ok: false, error: rawPhone.error.issues[0]?.message };

  const phone = normalizePhone(rawPhone.data);
  if (!phone) {
    return { ok: false, error: "Telefone inválido. Use DDD + número (ex.: 11 99999-9999)." };
  }

  const name = nameSchema.safeParse(String(formData.get("name") ?? "").trim());
  if (!name.success) return { ok: false, error: name.error.issues[0]?.message };

  const existed = await prisma.lead.findFirst({ where: { tenantId, phone } });
  const { lead } = await getOrCreateConversation(tenantId, phone, name.data || undefined, { originChannel: "manual" });

  // Só o cadastro novo vira evento: reabrir a conversa de um contato que já
  // existia não é uma alteração, e registrá-la encheria a trilha de linhas
  // que não dizem nada.
  if (!existed) {
    await recordAudit({
      event: "lead.created",
      target: { type: "Lead", id: lead.id, label: lead.name ?? phone },
      after: { name: lead.name, phone, status: lead.status },
    });
  }

  revalidateContatos();
  return { ok: true, info: existed ? "Este número já está na sua lista." : `Contato ${lead.name ?? ""} adicionado.` };
}

/**
 * Edita os dados que valem para o contato (nome e variáveis do agente). O
 * original do WhatsApp (nome do perfil e telefone) não muda; ver
 * `modules/crm/contact-profile.ts`.
 */
export async function saveContactProfile(_prev: Result | null, formData: FormData): Promise<Result> {
  const tooLarge = payloadTooLarge(formData);
  if (tooLarge) return { ok: false, error: tooLarge };
  const { tenantId, session } = await requireTenant();
  const leadId = formData.get("leadId");
  if (typeof leadId !== "string" || !leadId) return { ok: false, error: "Contato não encontrado." };
  const profile = readContactProfileForm(formData);
  if ("error" in profile) return { ok: false, error: profile.error };
  const result = await editContactProfile({ tenantId, leadId, profile, via: "contatos", actorUserId: session?.user.id });
  if (result.status === "unavailable") return { ok: false, error: "Contato não encontrado." };
  revalidateContatos();
  revalidatePath("/crm");
  return { ok: true, info: result.fields.length ? "Dados do contato salvos." : "Nada mudou nos dados do contato." };
}
