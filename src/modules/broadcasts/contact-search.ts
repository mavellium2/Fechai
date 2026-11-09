import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canonicalPhone, listBlockedNumbers } from "@/modules/whatsapp/blocklist";

export const LEAD_STATUSES = ["new", "warm", "hot", "scheduled", "lost"] as const;
export type LeadStatusFilter = (typeof LEAD_STATUSES)[number] | "";

export type BroadcastContactRow = {
  id: string;
  phone: string;
  name: string | null;
  status: string;
  /** Motivo para não poder entrar no disparo; `null` = pode. */
  unavailable: "blocked" | "stopped" | null;
};

const PAGE = 50;

function where(
  tenantId: string,
  q: string,
  status: LeadStatusFilter,
): Prisma.LeadWhereInput {
  const search = q.trim().slice(0, 80);
  const digits = search.replace(/\D/g, "");
  return {
    tenantId,
    isTest: false,
    ...(LEAD_STATUSES.includes(status as never) ? { status } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
          ],
        }
      : {}),
  };
}

async function classify(
  tenantId: string,
  leads: {
    id: string;
    phone: string;
    name: string | null;
    status: string;
    conversation: { followUpReason: string | null } | null;
  }[],
): Promise<BroadcastContactRow[]> {
  const blocked = new Set(
    (await listBlockedNumbers(tenantId)).map((b) => b.phone),
  );
  return leads.map((l) => ({
    id: l.id,
    phone: l.phone,
    name: l.name,
    status: l.status,
    unavailable: blocked.has(canonicalPhone(l.phone))
      ? "blocked"
      : l.conversation?.followUpReason === "stop"
        ? "stopped"
        : null,
  }));
}

const select = {
  id: true,
  phone: true,
  name: true,
  status: true,
  conversation: { select: { followUpReason: true } },
} as const;

/** Página de contatos da conta para escolher no disparo. Sempre com `tenantId`. */
export async function searchBroadcastContacts(
  tenantId: string,
  q: string,
  status: LeadStatusFilter,
  page = 1,
) {
  const filter = where(tenantId, q, status);
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;
  const [total, leads] = await Promise.all([
    prisma.lead.count({ where: filter }),
    prisma.lead.findMany({
      where: filter,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      skip: (safePage - 1) * PAGE,
      take: PAGE,
      select,
    }),
  ]);
  return {
    total,
    page: safePage,
    pages: Math.max(1, Math.ceil(total / PAGE)),
    items: await classify(tenantId, leads),
  };
}

