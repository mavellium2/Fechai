import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { LOSS_CATEGORIES } from "@/modules/lead-insights/categories";
import { lockCrmAdmission } from "./admission";

const MAX_REASONS = 20;
const MAX_LABEL = 80;

const normalizedKey = (label: string) => label.normalize("NFKC").toLocaleLowerCase("pt-BR");

export function crmLossOptions(labels: readonly string[]) {
  if (!labels.length) return LOSS_CATEGORIES.map(({ key, label }) => ({ key, label }));
  return labels.map((label) => ({
    label,
    key: LOSS_CATEGORIES.find((item) => normalizedKey(item.label) === normalizedKey(label))?.key
      ?? `motivo_${createHash("sha256").update(normalizedKey(label)).digest("hex")}`,
  }));
}

export function parseCrmLossCatalog(raw: unknown): string[] | null {
  if (typeof raw !== "string" || raw.length > (MAX_LABEL + 2) * MAX_REASONS) return null;
  const labels = raw.split(/\r?\n/).map((line) => line.trim().replace(/\s+/g, " ")).filter(Boolean);
  if (!labels.length || labels.length > MAX_REASONS || labels.some((label) => label.length > MAX_LABEL || /\p{Cc}/u.test(label))) return null;
  return new Set(labels.map(normalizedKey)).size === labels.length ? labels : null;
}

const catalogRevision = (labels: readonly string[]) => createHash("sha256").update(JSON.stringify(labels)).digest("hex");

export async function readCrmLossCatalog(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId, status: "active", crmEnabled: true },
    select: { crmLossReasons: true },
  });
  if (!tenant) return null;
  return { options: crmLossOptions(tenant.crmLossReasons), revision: catalogRevision(tenant.crmLossReasons) };
}

export function updateCrmLossCatalog(tenantId: string, labels: string[], previous: string) {
  return prisma.$transaction(async (db) => {
    await lockCrmAdmission(db, tenantId, "exclusive");
    const where = { id: tenantId, status: "active", crmEnabled: true };
    const tenant = await db.tenant.findUnique({ where, select: { crmLossReasons: true } });
    if (!tenant) return "unavailable";
    const current = catalogRevision(tenant.crmLossReasons);
    if (catalogRevision(labels) === current) return "ok";
    if (current !== previous) return "stale";
    const updated = await db.tenant.updateMany({ where, data: { crmLossReasons: labels } });
    return updated.count ? "ok" : "unavailable";
  });
}
