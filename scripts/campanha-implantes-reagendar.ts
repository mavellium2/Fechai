import "dotenv/config";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../src/lib/prisma";
import { resolveScriptActor, type ScriptActor } from "../src/modules/campaign-override/actor";
import { buildRescheduleWorkbook, listRescheduleCandidates, rescheduleFileName } from "../src/modules/campaign-override/reschedule-list";

/**
 * Lista para a recepção da campanha de implantes (URG-04): consultas futuras de leads da campanha
 * fora dos dias 18 e 19/11 às 9h, que precisam ser reagendadas. SÓ LEITURA.
 *
 *   npx tsx scripts/campanha-implantes-reagendar.ts --tenant <id> [--out caminho] [--actor <userId>] [--no-audit]
 *
 * Grava a planilha (por padrão em out/, que o git ignora) e mostra no terminal SÓ a quantidade e o
 * caminho. A planilha tem nome e telefone e é só para a clínica. Nenhuma tabela é alterada; a única
 * escrita é o evento de auditoria com a quantidade e o ator (exige --actor; --no-audit desliga).
 */
const args = process.argv.slice(2);
const one = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

async function main() {
  const tenantId = one("tenant");
  if (!tenantId) throw new Error("Uso: npx tsx scripts/campanha-implantes-reagendar.ts --tenant <id> [--out caminho] [--actor <userId>] [--no-audit]");

  // Ator inválido recusa antes de gerar qualquer arquivo.
  const audit = !args.includes("--no-audit");
  const actorId = one("actor");
  let actor: ScriptActor | null = null;
  if (audit && actorId) {
    const resolved = await resolveScriptActor(actorId, tenantId);
    if (!resolved.ok) throw new Error(resolved.message);
    actor = resolved.actor;
  }

  const now = new Date();
  const rows = await listRescheduleCandidates(tenantId, now);

  const out = one("out");
  const file = out?.toLowerCase().endsWith(".xlsx") ? path.resolve(out) : path.resolve(out ?? "out", rescheduleFileName(now));
  await mkdir(path.dirname(file), { recursive: true });
  await buildRescheduleWorkbook(rows).xlsx.writeFile(file);
  console.log(`${rows.length} consulta(s) para reagendar.`);
  console.log(`Arquivo: ${file}`);

  if (!audit) return;
  if (!actor) return console.log("Sem --actor: a geração não foi registrada na auditoria.");
  // Carregada aqui para a geração sem auditoria não puxar sessão nem Redis.
  const { recordAudit } = await import("../src/modules/audit/log");
  await recordAudit({
    event: "campaign_override.reschedule_list_generated",
    target: { type: "CampaignOverride", id: tenantId },
    meta: { count: rows.length },
    tenantId,
    actor,
  });
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
