import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canonicalPhone } from "@/modules/whatsapp/blocklist";
import { normalizeBrazilianPhone } from "@/modules/whatsapp/contact-phone";

/**
 * WhatsApp pessoal de quem é da equipe (CRM-05).
 *
 * Serve para o Fechai saber quem é a pessoa que escreve "assumo" ou reage no
 * grupo de transbordo. Por isso só vale o número **confirmado**, e a
 * confirmação é a própria pessoa mandando `#vincular CÓDIGO` do celular dela
 * para o número da clínica (QR), no privado ou no grupo. Como quem escreve
 * primeiro é ela, o Fechai nunca dá o primeiro contato pelo QR — a regra que
 * protege o número da clínica de bloqueio.
 *
 * O número fica na forma canônica (`canonicalPhone`, sem o 55 e sem o nono
 * dígito) para que o mesmo celular nas duas grafias que o WhatsApp entrega
 * conte como um só: é essa chave que é única na conta.
 */

export const TEAM_LINK_CODE_MINUTES = 15;
const COMMAND = /^\s*#vincular\s+(\d{6})\s*$/i;

/** O código de `#vincular 123456`, ou null quando a mensagem é outra coisa. */
export function parseTeamLinkCommand(text: string): string | null {
  return COMMAND.exec(text)?.[1] ?? null;
}

function hashCode(tenantId: string, userId: string, code: string) {
  return createHash("sha256").update(`${tenantId}:${userId}:${code}`).digest("hex");
}

function sameHash(stored: string | null, expected: string) {
  if (!stored || stored.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(stored), Buffer.from(expected));
}

function memberName(user: { name: string | null; email: string }) {
  return user.name?.trim() || user.email.split("@")[0] || "Pessoa da equipe";
}

/** Chave de busca de um telefone; vazia quando não parece um telefone. */
function phoneKeyOf(value: string): string {
  const key = canonicalPhone(value);
  return key.length >= 8 ? key : "";
}

export type TeamWhatsapp = {
  phone: string | null;
  verifiedAt: Date | null;
  pendingPhone: string | null;
  codeExpiresAt: Date | null;
};

export async function getTeamWhatsapp(tenantId: string, userId: string): Promise<TeamWhatsapp> {
  const row = await prisma.teamMemberWhatsapp.findUnique({
    where: { tenantId_userId: { tenantId, userId } },
    select: { phone: true, verifiedAt: true, pendingPhone: true, codeExpiresAt: true },
  });
  return {
    phone: row?.verifiedAt ? row.phone : null,
    verifiedAt: row?.verifiedAt ?? null,
    pendingPhone: row?.pendingPhone ?? null,
    codeExpiresAt: row?.pendingPhone ? row.codeExpiresAt : null,
  };
}

export type StartTeamLinkResult =
  | { status: "started"; code: string; expiresAt: Date; phone: string }
  | { status: "invalid" | "taken" | "already_verified" };

/**
 * Guarda o número digitado como pendente e devolve o código, que só existe
 * nesta resposta (no banco fica o hash). Gerar de novo invalida o anterior.
 * Número já confirmado por outra pessoa da conta é recusado aqui, antes de
 * a pessoa mandar mensagem à toa.
 */
export async function startTeamWhatsappLink(
  tenantId: string, userId: string, rawPhone: string, now = new Date(),
): Promise<StartTeamLinkResult> {
  const phone = normalizeBrazilianPhone(rawPhone);
  const key = phone ? phoneKeyOf(phone) : "";
  if (!phone || !key) return { status: "invalid" };

  const [taken, current] = await Promise.all([
    prisma.teamMemberWhatsapp.findFirst({
      where: { tenantId, phoneKey: key, verifiedAt: { not: null }, NOT: { userId } },
      select: { id: true },
    }),
    prisma.teamMemberWhatsapp.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      select: { phoneKey: true, verifiedAt: true },
    }),
  ]);
  if (taken) return { status: "taken" };
  if (current?.verifiedAt && current.phoneKey === key) return { status: "already_verified" };

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(now.getTime() + TEAM_LINK_CODE_MINUTES * 60_000);
  const pending = { pendingPhone: phone, pendingKey: key, codeHash: hashCode(tenantId, userId, code), codeExpiresAt: expiresAt };
  await prisma.teamMemberWhatsapp.upsert({
    where: { tenantId_userId: { tenantId, userId } },
    create: { tenantId, userId, ...pending },
    update: pending,
  });
  return { status: "started", code, expiresAt, phone };
}

const NO_PENDING = { pendingPhone: null, pendingKey: null, codeHash: null, codeExpiresAt: null };

/** Desiste do número pendente. O número já confirmado, se houver, continua. */
export async function cancelTeamWhatsappLink(tenantId: string, userId: string): Promise<void> {
  await prisma.teamMemberWhatsapp.updateMany({ where: { tenantId, userId }, data: NO_PENDING });
}

/** Desliga o WhatsApp da pessoa: ela deixa de ser reconhecida no grupo. */
export async function removeTeamWhatsapp(tenantId: string, userId: string): Promise<boolean> {
  const removed = await prisma.teamMemberWhatsapp.deleteMany({ where: { tenantId, userId } });
  return removed.count > 0;
}

export type ConfirmTeamLinkResult =
  | { status: "verified"; userId: string; name: string }
  | { status: "no_phone" | "invalid" | "taken" };

class CodeAlreadyUsed extends Error {}

/**
 * Confirma o número a partir da mensagem `#vincular CÓDIGO`.
 *
 * O telefone de quem mandou precisa ser o número pendente: é isso que prova a
 * posse. Por isso um evento de grupo que esconde o número (só @lid) não
 * confirma nada (`no_phone`). O código vale uma vez só, por 15 minutos.
 */
export async function confirmTeamWhatsappLink(input: {
  tenantId: string;
  code: string;
  senderPhone?: string | null;
  senderLid?: string | null;
  now?: Date;
}): Promise<ConfirmTeamLinkResult> {
  const { tenantId, code } = input;
  const now = input.now ?? new Date();
  const key = input.senderPhone ? phoneKeyOf(input.senderPhone) : "";
  if (!key) return { status: "no_phone" };

  const candidates = await prisma.teamMemberWhatsapp.findMany({
    where: { tenantId, pendingKey: key, codeExpiresAt: { gt: now }, user: { tenantId, usesProduct: true } },
    select: { id: true, userId: true, pendingPhone: true, codeHash: true, phoneKey: true, lid: true,
      user: { select: { name: true, email: true } } },
  });
  const match = candidates.find((row) => sameHash(row.codeHash, hashCode(tenantId, row.userId, code)));
  if (!match?.pendingPhone || !match.codeHash) return { status: "invalid" };

  const lid = input.senderLid && /^\d{5,20}$/.test(input.senderLid) ? input.senderLid : null;
  // Mesmo número de antes mantém o LID já aprendido; número novo começa sem.
  const keptLid = lid ?? (match.phoneKey === key ? match.lid : null);
  try {
    await prisma.$transaction(async (db) => {
      // Um LID é uma pessoa só: se outra linha da conta o tinha, estava errada.
      if (keptLid) {
        await db.teamMemberWhatsapp.updateMany({ where: { tenantId, lid: keptLid, NOT: { id: match.id } }, data: { lid: null } });
      }
      // Condicional no hash: a mesma mensagem entregue duas vezes não confirma duas vezes.
      const claimed = await db.teamMemberWhatsapp.updateMany({
        where: { id: match.id, tenantId, codeHash: match.codeHash, codeExpiresAt: { gt: now } },
        data: { phone: match.pendingPhone, phoneKey: key, lid: keptLid, verifiedAt: now, ...NO_PENDING },
      });
      if (!claimed.count) throw new CodeAlreadyUsed();
    });
  } catch (error) {
    if (error instanceof CodeAlreadyUsed) return { status: "invalid" };
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { status: "taken" };
    throw error;
  }
  return { status: "verified", userId: match.userId, name: memberName(match.user) };
}

export type GroupMember = { userId: string; name: string };

/**
 * Quem da equipe é este participante do grupo. Aceita o JID (`...@lid` ou
 * `...@s.whatsapp.net`) ou só os dígitos de um telefone; LID precisa vir com
 * o sufixo, porque os dois são números. Só número **confirmado** de quem ainda
 * usa o produto na conta; o resto é `null`. **Nunca lança.**
 */
export async function resolveGroupMember(tenantId: string, phoneOrLid: string): Promise<GroupMember | null> {
  try {
    const value = phoneOrLid.trim();
    const lid = /^(\d{5,20})@lid$/.exec(value)?.[1];
    const key = lid ? "" : phoneKeyOf(value.split("@")[0]);
    if (!lid && !key) return null;
    const row = await prisma.teamMemberWhatsapp.findFirst({
      where: { tenantId, ...(lid ? { lid } : { phoneKey: key }), verifiedAt: { not: null }, user: { tenantId, usesProduct: true } },
      select: { userId: true, user: { select: { name: true, email: true } } },
    });
    return row ? { userId: row.userId, name: memberName(row.user) } : null;
  } catch (error) {
    console.error("[crm] falha ao identificar participante do grupo", error);
    return null;
  }
}

/**
 * Aprende o LID de alguém da equipe quando um evento traz o LID e o número
 * juntos. Só para número já confirmado; o LID que estava em outra linha da
 * conta sai dela. **Nunca lança** (roda no webhook).
 */
export async function learnTeamMemberLid(tenantId: string, phone: string, lid: string): Promise<void> {
  try {
    const key = phoneKeyOf(phone);
    if (!key || !/^\d{5,20}$/.test(lid)) return;
    const row = await prisma.teamMemberWhatsapp.findFirst({
      where: { tenantId, phoneKey: key, verifiedAt: { not: null } },
      select: { id: true, lid: true },
    });
    if (!row || row.lid === lid) return;
    await prisma.$transaction([
      prisma.teamMemberWhatsapp.updateMany({ where: { tenantId, lid, NOT: { id: row.id } }, data: { lid: null } }),
      prisma.teamMemberWhatsapp.updateMany({ where: { id: row.id, tenantId }, data: { lid } }),
    ]);
  } catch (error) {
    console.error("[crm] falha ao aprender o LID de alguém da equipe", error);
  }
}
