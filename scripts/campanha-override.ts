import "dotenv/config";
import type { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { DEFAULT_OVERRIDE_RULES, IMPLANTES_ENDS_AT, IMPLANTES_KEY } from "../src/modules/campaign-override/config";
import { auditView, buildOverrideUpdate, currentUpdate, type OverrideChanges } from "../src/modules/campaign-override/update";

/**
 * Regra provisória da campanha de implantes (URG-01): quais leads valem como "da campanha".
 *
 *   npx tsx scripts/campanha-override.ts --tenant <id> --show
 *   npx tsx scripts/campanha-override.ts --tenant <id> --create --actor <userId> --apply
 *   npx tsx scripts/campanha-override.ts --tenant <id> --set-codes AD27,AD31 --set-capacity 12 --actor <userId> --apply
 *
 * Opções: --set-codes, --set-source-ids, --set-broadcasts (listas separadas por vírgula, trocam a lista
 * inteira), --set-capacity N, --set-offer "texto", --add-lead ID, --remove-lead ID (repetíveis), --create.
 *
 * Sem `--apply` só simula: nada é gravado. Gravar exige `--actor <userId>` e registra auditoria
 * (só ids e quantidades). A saída nunca mostra nome, telefone ou conversa de lead.
 */
const args = process.argv.slice(2);

function values(name: string): string[] {
  const out: string[] = [];
  args.forEach((arg, i) => {
    if (arg === `--${name}` && args[i + 1] !== undefined) out.push(args[i + 1]);
  });
  return out;
}
const one = (name: string) => values(name)[0];
const list = (name: string) => values(name).flatMap((value) => value.split(",").map((item) => item.trim()));
const has = (name: string) => args.includes(`--${name}`);

const USAGE =
  "Uso: npx tsx scripts/campanha-override.ts --tenant <id> [--show] [--create] [--set-codes AD27,AD31] [--set-source-ids ...] " +
  "[--set-broadcasts ...] [--set-capacity N] [--set-offer \"texto\"] [--add-lead ID] [--remove-lead ID] [--actor <userId>] [--apply]";

async function main() {
  const tenantId = one("tenant");
  if (!tenantId) throw new Error(USAGE);
  const apply = has("apply");
  const actorId = one("actor");
  if (apply && !actorId) throw new Error("--actor <userId> é obrigatório para gravar.");

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
  if (!tenant) throw new Error("Conta não encontrada.");
  const row = await prisma.campaignOverride.findUnique({ where: { tenantId_key: { tenantId, key: IMPLANTES_KEY } } });

  if (has("show")) {
    if (!row) return console.log(`Conta ${tenantId}: sem regra "${IMPLANTES_KEY}". Use --create.`);
    const view = currentUpdate(row);
    console.log(`Regra ${row.key} · conta ${tenantId}`);
    console.log(`  vale de ${row.startsAt.toISOString()} até ${row.endsAt.toISOString()}`);
    console.log(`  códigos de anúncio:  ${view.adCodes.join(", ") || "(nenhum)"}`);
    console.log(`  ids de anúncio:      ${view.adSourceIds.join(", ") || "(nenhum)"}`);
    console.log(`  disparos:            ${view.broadcastCampaignIds.length}`);
    console.log(`  leads marcados:      ${view.leadIds.length}`);
    console.log(`  dias / hora:         ${view.rules.dates.join(", ")} · ${view.rules.time}`);
    console.log(`  vagas por dia:       ${view.rules.capacityPerDay ?? "(não definidas)"}`);
    console.log(`  oferta:              ${view.rules.offerText ?? "(não definida)"}`);
    return;
  }

  const changes: OverrideChanges = {};
  if (has("set-codes")) changes.codes = list("set-codes");
  if (has("set-source-ids")) changes.sourceIds = list("set-source-ids");
  if (has("set-broadcasts")) changes.broadcasts = list("set-broadcasts");
  if (has("set-capacity")) changes.capacityPerDay = Number(one("set-capacity"));
  if (has("set-offer")) changes.offerText = one("set-offer") ?? "";
  if (has("add-lead")) changes.addLeads = list("add-lead");
  if (has("remove-lead")) changes.removeLeads = list("remove-lead");

  const creating = !row && has("create");
  if (row && has("create") && !Object.keys(changes).length) return console.log(`A regra "${IMPLANTES_KEY}" já existe nesta conta; nada a criar.`);
  if (!row && !creating) throw new Error(`A conta não tem a regra "${IMPLANTES_KEY}". Rode com --create.`);
  if (!creating && !Object.keys(changes).length) throw new Error(`Nada para alterar. ${USAGE}`);

  // O lead precisa ser desta conta (e só se confirma aqui, no banco).
  const addLeads = (changes.addLeads ?? []).filter(Boolean);
  const owned = addLeads.length
    ? await prisma.lead.findMany({ where: { tenantId, id: { in: addLeads } }, select: { id: true } })
    : [];
  const state = row ?? { adCodes: [], adSourceIds: [], broadcastCampaignIds: [], leadIds: [], rules: DEFAULT_OVERRIDE_RULES };
  const built = buildOverrideUpdate(state, changes, new Set(owned.map((lead) => lead.id)));
  if (!built.ok) throw new Error(`Nada foi gravado:\n  - ${built.errors.join("\n  - ")}`);

  const before = auditView(currentUpdate(state));
  const after = auditView(built.next);
  console.log(`${apply ? "GRAVANDO" : "SIMULAÇÃO (nada será gravado)"} · conta ${tenantId} · ${creating ? "criar" : "alterar"} ${IMPLANTES_KEY}`);
  for (const key of Object.keys(after) as (keyof typeof after)[]) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key]) || creating) {
      console.log(`  ${key}: ${JSON.stringify(before[key])} -> ${JSON.stringify(after[key])}`);
    }
  }
  if (!apply) return console.log("\nRode de novo com --apply --actor <userId> para gravar.");

  const actor = await prisma.user.findUnique({ where: { id: actorId! }, select: { id: true, email: true, role: true } });
  if (!actor) throw new Error("--actor: usuário não encontrado.");
  const data = {
    adCodes: built.next.adCodes,
    adSourceIds: built.next.adSourceIds,
    broadcastCampaignIds: built.next.broadcastCampaignIds,
    leadIds: built.next.leadIds,
    rules: built.next.rules as unknown as Prisma.InputJsonValue,
    updatedById: actor.id,
  };
  const saved = row
    ? await prisma.campaignOverride.update({ where: { id: row.id }, data })
    : await prisma.campaignOverride.create({
        data: { ...data, tenantId, key: IMPLANTES_KEY, startsAt: new Date(), endsAt: IMPLANTES_ENDS_AT, createdById: actor.id },
      });

  // Auditoria só depois de gravar e só com ids e quantidades. Carregada aqui para
  // que --show e a simulação não puxem sessão nem Redis.
  const { recordAudit, recordChange } = await import("../src/modules/audit/log");
  const who = { id: actor.id, email: actor.email, role: actor.role };
  const target = { type: "CampaignOverride", id: saved.id, label: saved.key };
  if (row) await recordChange({ event: "campaign_override.updated", target, before, after, tenantId, actor: who });
  else await recordAudit({ event: "campaign_override.created", target, after, tenantId, actor: who });
  console.log(row ? "\nRegra atualizada." : "\nRegra criada.");
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
