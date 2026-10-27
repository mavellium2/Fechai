export const RECOVERY_STAT_KEYS = ["scanned", "imported", "existing", "blocked", "test", "survey", "ambiguousPhone", "invalid", "outsideWindow", "unresolvedPhone", "ignored", "unsupported", "mediaWithoutFile"] as const;
export type RecoveryStats = Record<typeof RECOVERY_STAT_KEYS[number], number>;
export function recoveryStats(value?: unknown): RecoveryStats {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.fromEntries(RECOVERY_STAT_KEYS.map((key) => [key, Number.isSafeInteger(source[key]) && Number(source[key]) >= 0 ? Number(source[key]) : 0])) as RecoveryStats;
}
export type HistoryRecoveryView = {
  id: string; status: string; since: string; until: string; total: number | null;
  stats: RecoveryStats; error: string | null; updatedAt: string;
};
