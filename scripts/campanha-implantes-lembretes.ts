import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { clearCampaignReminders } from "../src/modules/campaign-override/clear-reminders";

/**
 * Desliga os lembretes das consultas JÁ MARCADAS de leads da campanha de implantes (URG-03).
 *
 *   npx tsx scripts/campanha-implantes-lembretes.ts --tenant <id>                      (simula)
 *   npx tsx scripts/campanha-implantes-lembretes.ts --tenant <id> --apply --actor <userId>
 *
 * Grava `reminderOverride = []` nas consultas futuras e passa os disparos `queued` delas para
 * `skipped` ("campanha implantes"). Sem `--apply` só simula. Gravar exige `--actor` (superadmin ou
 * usuário da conta) e registra auditoria com SÓ as contagens. O terminal mostra só contagens.
 */
const args = process.argv.slice(2);
const one = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

async function main() {
  const tenantId = one("tenant");
  if (!tenantId) throw new Error("Uso: npx tsx scripts/campanha-implantes-lembretes.ts --tenant <id> [--apply --actor <userId>]");
  const apply = args.includes("--apply");

  const result = await clearCampaignReminders({ tenantId, apply, actorId: one("actor") });
  console.log(`${apply ? "GRAVADO" : "SIMULAÇÃO (nada foi gravado)"} · conta ${tenantId}`);
  console.log(`  consultas futuras de leads da campanha: ${result.matched}`);
  console.log(`  consultas ${apply ? "que passaram" : "que passariam"} a não receber lembrete: ${result.appointments}`);
  console.log(`  disparos pendentes ${apply ? "dispensados" : "que seriam dispensados"}: ${result.dispatches}`);
  if (!apply) console.log("\nRode de novo com --apply --actor <userId> para gravar.");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : "Falha inesperada.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    // O módulo de auditoria abre conexão com o Redis; sem isto o processo não encerra.
    process.exit(process.exitCode ?? 0);
  });
