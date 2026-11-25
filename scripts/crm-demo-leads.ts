import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { DEFAULT_PIPELINE_KEY } from "../src/modules/crm/pipeline";

/**
 * Cards de demonstração para testar o quadro do CRM (rolagem por coluna,
 * arraste, adicionar e excluir).
 *
 *   npx tsx scripts/crm-demo-leads.ts --tenant crm@teste.local
 *   npx tsx scripts/crm-demo-leads.ts --tenant crm@teste.local --apply
 *   npx tsx scripts/crm-demo-leads.ts --tenant crm@teste.local --remove --apply
 *
 * Sem `--apply` só mostra o plano. Cria no máximo 8 cards por etapa (o padrão),
 * sem passar do que já existe. Todos os telefones usam o bloco reservado
 * `551190000`, então dá para removê-los depois sem tocar em lead de verdade.
 * Nome, telefone e histórico nunca aparecem na saída — só contagens.
 *
 * Os cards nascem como **lead real** (`isTest: false`): o quadro só lista lead
 * real, então a conta de destino é uma conta de teste. Como entram nos
 * relatórios da conta, rode sempre com `--remove --apply` depois da validação.
 */
const args = process.argv.slice(2);
const one = (name: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};
const has = (name: string) => args.includes(`--${name}`);

const PER_STAGE = 8;
const PHONE_PREFIX = "551190000";

const DEMO_NAMES = [
  "Ana Souza", "Bruno Lima", "Carla Almeida", "Diego Ferreira", "Elisa Costa", "Fábio Martins", "Gabriela Rocha", "Henrique Ribeiro",
  "Isabela Carvalho", "João Gomes", "Karina Araújo", "Lucas Barbosa", "Mariana Nascimento", "Nicolas Moreira", "Olívia Cardoso", "Pedro Teixeira",
  "Rafaela Oliveira", "Sérgio Pereira", "Tatiane Santos", "Vinícius Melo", "Yasmin Freitas", "Beatriz Pinto", "Caio Batista", "Débora Cavalcanti",
  "Eduardo Monteiro", "Fernanda Mendes", "Gustavo Barros", "Helena Fonseca", "Igor Rezende", "Juliana Dias", "Leandro Camargo", "Michele Siqueira",
  "Natália Duarte", "Otávio Lopes", "Paula Machado", "Rodrigo Nunes", "Sofia Ramos", "Thiago Correia", "Úrsula Borges", "Vitor Azevedo",
  "Wagner Pires", "Xênia Farias", "Zélia Braga", "Amanda Vasconcelos", "Bernardo Peixoto", "Camila Andrade", "Daniel Bezerra", "Esther Queiroz",
  "Felipe Brandão", "Giovana Furtado", "Hugo Salgado", "Ingrid Paiva", "Júlia Medeiros", "Kaique Tavares", "Larissa Fontes", "Murilo Aguiar",
  "Noemi Bastos", "Paulo Holanda", "Queila Sampaio", "Renato Vilela", "Sara Bittencourt", "Tomás Portela", "Valéria Gusmão", "William Neves",
] as const;

/** Minutos desde a entrada na etapa: dá selo verde, amarelo, vermelho e tempo sem registro. */
const MINUTES_IN_STAGE = [18, 42, 95, 200, 420, 1_560, 2_880, 5_760] as const;
const ORIGINS = ["manual", "whatsapp_qr", "whatsapp_meta", "widget", "broadcast", "ad", null, null] as const;

function phoneFor(sequence: number) {
  return `${PHONE_PREFIX}${String(sequence).padStart(4, "0")}`;
}

async function main() {
  const reference = one("tenant");
  if (!reference) {
    throw new Error("Uso: --tenant <id-ou-email-do-dono> [--per-stage 8] [--remove] [--apply]");
  }
  const apply = has("apply");
  const remove = has("remove");
  const perStage = Math.min(Math.max(Number(one("per-stage")) || PER_STAGE, 1), PER_STAGE);

  const tenant = await prisma.tenant.findFirst({
    where: {
      OR: [{ id: reference }, { users: { some: { email: reference } } }],
      crmEnabled: true, status: "active",
    },
    select: { id: true, name: true },
  });
  if (!tenant) throw new Error("Conta ativa com CRM liberado não encontrada para este id/e-mail.");

  const pipeline = await prisma.pipeline.findUnique({
    where: { tenantId_key: { tenantId: tenant.id, key: DEFAULT_PIPELINE_KEY } },
    select: { stages: {
      where: { archivedAt: null }, orderBy: [{ position: "asc" }, { id: "asc" }],
      select: { id: true, name: true, kind: true },
    } },
  });
  if (!pipeline?.stages.length) throw new Error("Esta conta não tem pipeline ativo do CRM.");

  const demo = await prisma.lead.findMany({
    where: { tenantId: tenant.id, phone: { startsWith: PHONE_PREFIX } },
    select: { id: true, phone: true, stageId: true, conversation: { select: {
      _count: { select: { messages: true } },
    } }, _count: { select: { appointments: true } } },
  });

  if (remove) {
    const removable = demo.filter((lead) => (lead.conversation?._count.messages ?? 0) === 0 && lead._count.appointments === 0);
    console.log(`Conta "${tenant.name}" · cards de demonstração: ${demo.length}`);
    console.log(`  remover: ${removable.length} (os que já ganharam conversa ou agendamento ficam)`);
    if (!apply) return console.log("Simulação. Use --apply para excluir.");
    const { count } = await prisma.lead.deleteMany({ where: { tenantId: tenant.id, phone: { startsWith: PHONE_PREFIX }, id: { in: removable.map((lead) => lead.id) } } });
    return console.log(`Excluídos ${count} cards de demonstração.`);
  }

  const totals = await prisma.lead.groupBy({
    by: ["stageId"], where: { tenantId: tenant.id, isTest: false, stageId: { in: pipeline.stages.map((stage) => stage.id) } },
    _count: { _all: true },
  });
  const totalByStage = new Map(totals.map((row) => [row.stageId, row._count._all]));
  const usedPhones = new Set(demo.map((lead) => lead.phone));
  const owners = await prisma.user.findMany({
    where: { tenantId: tenant.id, role: "OWNER", usesProduct: true },
    orderBy: [{ name: "asc" }, { email: "asc" }], select: { id: true },
  });

  // A meta é o total da coluna, contando os leads que já existem: assim a
  // coluna fica completa, mas nunca passa de `perStage` cards de demonstração.
  const plan = pipeline.stages.map((stage) => {
    const existing = totalByStage.get(stage.id) ?? 0;
    return { stage, existing, missing: Math.max(0, perStage - existing) };
  });
  const total = plan.reduce((sum, item) => sum + item.missing, 0);

  console.log(`Conta "${tenant.name}" · ${pipeline.stages.length} etapas · meta: até ${perStage} por etapa`);
  for (const item of plan) console.log(`  ${item.stage.name.padEnd(22)} ${item.existing} existente(s), ${item.missing} a criar`);
  console.log(`  total a criar: ${total}`);
  if (!total) return console.log("Nada a fazer: as colunas já estão no limite.");
  if (!apply) return console.log("Simulação. Use --apply para criar.");

  let sequence = 1;
  const nextPhone = () => {
    while (usedPhones.has(phoneFor(sequence))) sequence += 1;
    const phone = phoneFor(sequence);
    usedPhones.add(phone);
    sequence += 1;
    return phone;
  };
  const newStage = pipeline.stages.find((stage) => stage.kind === "new");
  const now = Date.now();
  let created = 0;

  for (const [stageIndex, item] of plan.entries()) {
    for (let slot = 0; slot < item.missing; slot += 1) {
      const order = stageIndex * perStage + slot;
      const name = DEMO_NAMES[order % DEMO_NAMES.length];
      const minutes = MINUTES_IN_STAGE[slot % MINUTES_IN_STAGE.length] + stageIndex * 7;
      const stageSince = new Date(now - minutes * 60_000);
      const origin = ORIGINS[order % ORIGINS.length];
      // Um card em cada oito nasce sem histórico: é o "Tempo na etapa indisponível".
      const withTransition = slot % 8 !== 7;
      const withConversation = order % 3 !== 0;
      const assignedUserId = withConversation && order % 5 === 0 ? owners[order % owners.length]?.id : null;

      await prisma.lead.create({
        data: {
          tenantId: tenant.id, phone: nextPhone(), name, isTest: false,
          ...(origin ? { originChannel: origin } : {}),
          stageId: item.stage.id,
          createdAt: new Date(stageSince.getTime() - 2 * 24 * 60 * 60_000),
          ...(withConversation ? { conversation: { create: {
            tenantId: tenant.id, agentPaused: true,
            ...(assignedUserId ? { assignedUserId, assignedAt: stageSince } : {}),
          } } } : {}),
          ...(withTransition ? { transitions: { create: {
            dimension: "stage" as const, source: "user" as const, userId: owners[0]?.id,
            fromStageId: item.stage.kind === "new" ? null : newStage?.id ?? null,
            toStageId: item.stage.id, reason: "lead_created_manual", createdAt: stageSince,
          } } } : {}),
        },
        select: { id: true },
      });
      created += 1;
    }
  }
  console.log(`Criados ${created} cards de demonstração.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
