import type { Campaign } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CAMPAIGN_STATUS_FILTERS, statusWhere, type CampaignStatusFilter } from "./status";

/**
 * Leitura de campanhas. TODA consulta daqui leva `tenantId` no `where`, e quem
 * chama passa o que veio da sessão (`requireCampaignActor`) — nunca de URL ou
 * formulário. Uma conta não enxerga campanha de outra, nem pelo id.
 *
 * Nenhuma consulta filtra por "ativa": o filtro de status é só a lista da
 * tela. Campanha terminada continua existindo para os resultados.
 */

/**
 * Teto da lista. Uma conta com mais campanhas que isso é improvável, mas a
 * consulta não pode ser ilimitada: a tela avisa quando o teto corta a lista.
 */
export const CAMPAIGN_LIST_LIMIT = 200;

export type CampaignCounts = Record<CampaignStatusFilter, number>;

/**
 * Campanhas da conta, mais recentes primeiro. O filtro de status roda no banco
 * (`statusWhere`) com o `now` do servidor.
 */
export async function listCampaigns(
  tenantId: string,
  options: { status?: CampaignStatusFilter; now?: Date; period?: { from: Date; to: Date } | null } = {},
): Promise<Campaign[]> {
  const { status = "all", now = new Date(), period } = options;
  return prisma.campaign.findMany({
    where: {
      tenantId,
      ...statusWhere(status, now),
      // Período: campanhas cujo período cruza a janela (sem data não cruza nada).
      ...(period
        ? { AND: [{ startsAt: { lte: period.to } }, { OR: [{ endsAt: null }, { endsAt: { gte: period.from } }] }] }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: CAMPAIGN_LIST_LIMIT,
  });
}

/**
 * Quantas campanhas há em cada aba (a de "todas" não conta as arquivadas).
 * Seis contagens em paralelo, cada uma com o mesmo filtro da lista.
 */
export async function countCampaigns(tenantId: string, now: Date = new Date()): Promise<CampaignCounts> {
  const entries = await Promise.all(
    CAMPAIGN_STATUS_FILTERS.map(
      async (filter) =>
        [filter, await prisma.campaign.count({ where: { tenantId, ...statusWhere(filter, now) } })] as const,
    ),
  );
  return Object.fromEntries(entries) as CampaignCounts;
}

export type CampaignWithCreator = Campaign & {
  createdBy: { name: string | null; email: string } | null;
  updatedBy: { name: string | null; email: string } | null;
};

/**
 * Uma campanha da conta, ou `null`: id que não existe e id de OUTRA conta são
 * indistinguíveis (a tela mostra "não encontrada" nos dois). Falha do banco
 * não vira `null` — sobe para o `error.tsx`, porque 404 por pane esconde o problema.
 */
export async function getCampaign(tenantId: string, id: string): Promise<CampaignWithCreator | null> {
  if (!id) return null;
  return prisma.campaign.findFirst({
    where: { id, tenantId },
    include: {
      createdBy: { select: { name: true, email: true } },
      updatedBy: { select: { name: true, email: true } },
    },
  });
}

/** Campanhas em vigor agora (ativas), para o topo da lista e o alerta de regra especial. */
export async function listRunningCampaigns(tenantId: string, now: Date = new Date()) {
  return prisma.campaign.findMany({
    where: { tenantId, ...statusWhere("active", now) },
    select: { id: true, name: true, endsAt: true, timezone: true, rules: true },
    orderBy: [{ endsAt: "asc" }, { id: "asc" }],
    take: 20,
  });
}

/** A conta tem a API oficial da Meta liberada? (Só então Disparos aparece como destino.) */
export async function hasMetaBroadcasts(tenantId: string): Promise<boolean> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { metaWhatsappEnabled: true } });
  return tenant?.metaWhatsappEnabled === true;
}
