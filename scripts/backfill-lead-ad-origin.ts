import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { backfillAdOrigins } from "../src/modules/campaign-reports/backfill";

/**
 * Preenche de qual anúncio cada lead antigo veio, lendo o histórico da Evolution.
 *
 *   npx tsx scripts/backfill-lead-ad-origin.ts --tenant <id> [--desde 2026-09-01] [--apply]
 *
 * Sem `--apply` só simula e conta: nada é gravado. Com `--apply` grava apenas
 * `LeadAdOrigin`, só em leads que já existem, e pode rodar de novo sem duplicar.
 * A saída tem só contagens (nenhum telefone, nome ou texto).
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const tenantId = arg("tenant");
  const since = new Date(`${arg("desde") ?? "2026-09-01"}T00:00:00-03:00`);
  const apply = process.argv.includes("--apply");
  if (!tenantId || Number.isNaN(since.getTime())) {
    console.error("Uso: npx tsx scripts/backfill-lead-ad-origin.ts --tenant <id> [--desde AAAA-MM-DD] [--apply]");
    process.exit(1);
  }

  console.log(`${apply ? "GRAVANDO" : "SIMULAÇÃO (nada será gravado)"} · conta ${tenantId} · desde ${since.toISOString().slice(0, 10)}`);
  const stats = await backfillAdOrigins({ tenantId, since, apply, log: (line) => console.log(`  ${line}`) });

  console.log("\nResumo");
  console.log(`  semanas lidas:               ${stats.slices}`);
  console.log(`  mensagens lidas:             ${stats.scanned}`);
  console.log(`  mensagens com anúncio:       ${stats.withAd}`);
  console.log(`  sem telefone identificado:   ${stats.unresolvedPhone}`);
  console.log(`  contatos distintos:          ${stats.contacts}`);
  console.log(`  sem lead no Fechai:          ${stats.noLeadInFechai}`);
  console.log(`  leads encontrados:           ${stats.matched}`);
  if (apply) {
    console.log(`  origens gravadas agora:      ${stats.created}`);
    console.log(`  já tinham origem (mantidas): ${stats.alreadyHad}`);
  } else {
    console.log("\nRode de novo com --apply para gravar.");
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
