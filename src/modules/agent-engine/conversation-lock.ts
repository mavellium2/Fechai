import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canonicalPhone } from "@/modules/whatsapp/blocklist";

/** O webhook e a recuperação compartilham a criação por conta/telefone. */
export function withConversationContactLock<T>(
  tenantId: string,
  phone: string,
  task: (db: Prisma.TransactionClient) => Promise<T>,
) {
  return prisma.$transaction(async (db) => {
    const contactKey = canonicalPhone(phone) || phone;
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${contactKey}))`;
    return task(db);
  }, { timeout: 15_000 });
}
