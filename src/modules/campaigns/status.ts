import type { Prisma } from "@prisma/client";

/**
 * Status de uma campanha — **calculado na leitura, nunca gravado**.
 *
 * Não existe coluna `status`: ele sai de quatro datas (`startsAt`, `endsAt`,
 * `pausedAt`, `archivedAt`) e do "agora" que o servidor passa. É o que faz a
 * campanha virar `finished` sozinha ao passar de `endsAt`, sem cron, sem
 * gravar nada e sem ninguém lembrar de fechá-la. E é o que garante que
 * nenhuma consulta de resultados precise (ou possa) filtrar por status:
 * campanha terminada continua nos relatórios.
 *
 * Este arquivo é puro: sem acesso a banco, sem `Date.now()` escondido. O
 * `Prisma` importado é só o TIPO do filtro (apagado na compilação).
 */

export type CampaignStatus = "draft" | "active" | "paused" | "finished" | "archived";

export const CAMPAIGN_STATUSES = ["draft", "active", "paused", "finished", "archived"] as const satisfies readonly CampaignStatus[];

/** Filtro da lista: um status, ou `all` = tudo que não está arquivado. */
export type CampaignStatusFilter = "all" | CampaignStatus;

export const CAMPAIGN_STATUS_FILTERS = ["all", ...CAMPAIGN_STATUSES] as const satisfies readonly CampaignStatusFilter[];

/** O que `?status=` aceita; qualquer outro valor cai em `all`, nunca num erro. */
export function parseStatusFilter(value: unknown): CampaignStatusFilter {
  const first = Array.isArray(value) ? value[0] : value;
  return (CAMPAIGN_STATUS_FILTERS as readonly unknown[]).includes(first) ? (first as CampaignStatusFilter) : "all";
}

/** As quatro datas de que o status depende. */
export type CampaignTimeline = {
  startsAt: Date | null;
  endsAt: Date | null;
  pausedAt: Date | null;
  archivedAt: Date | null;
};

/**
 * Precedência (a ordem É a regra):
 *
 * 1. `archivedAt` → arquivada, vença o que vencer.
 * 2. Sem `startsAt`, ou ainda antes dele → rascunho.
 * 3. Passou de `endsAt` → terminada. Vem **antes** da pausa: a pausa só vale
 *    dentro do período, então campanha pausada que chegou ao fim está terminada.
 * 4. `pausedAt` → pausada.
 * 5. Senão, ativa.
 *
 * `endsAt` é inclusivo: no instante exato dele a campanha ainda está ativa, e
 * só vira terminada no instante seguinte (`now > endsAt`).
 */
export function campaignStatus(campaign: CampaignTimeline, now: Date): CampaignStatus {
  const at = now.getTime();
  if (campaign.archivedAt) return "archived";
  if (!campaign.startsAt || at < campaign.startsAt.getTime()) return "draft";
  if (campaign.endsAt && at > campaign.endsAt.getTime()) return "finished";
  if (campaign.pausedAt) return "paused";
  return "active";
}

/** Terminada e arquivada ficam só para consulta (arquivada só volta por desarquivar). */
export function isReadOnly(campaign: CampaignTimeline, now: Date): boolean {
  const status = campaignStatus(campaign, now);
  return status === "finished" || status === "archived";
}

/**
 * O que se pode fazer com uma campanha em cada status. É a fonte única das
 * duas pontas: a tela só mostra o botão se for verdade aqui, e a action recusa
 * pela mesma tabela (esconder botão não autoriza nada).
 */
export type CampaignAllowed = {
  edit: boolean;
  pause: boolean;
  resume: boolean;
  archive: boolean;
  unarchive: boolean;
};

export function allowedActions(status: CampaignStatus): CampaignAllowed {
  return {
    // Terminada não prorroga e arquivada não edita: ficam como foram.
    edit: status === "draft" || status === "active" || status === "paused",
    // Pausar só tem sentido no meio do período.
    pause: status === "active",
    resume: status === "paused",
    // Arquivar vale até para a terminada (é como se tira da lista), e
    // desarquivar só para a arquivada.
    archive: status !== "archived",
    unarchive: status === "archived",
  };
}

/**
 * O mesmo status, como `where` de datas — para filtrar (e contar) no banco em
 * vez de carregar tudo e filtrar em memória. `now` vem do servidor e deve ser o
 * MESMO usado em `campaignStatus` na mesma resposta, senão a lista e as
 * abas discordam por um instante.
 *
 * As fronteiras espelham `campaignStatus` ao milissegundo: começa em
 * `startsAt <= now`, termina em `endsAt < now`. (`NULL <= x` nunca é
 * verdadeiro em SQL, então `startsAt: { lte: now }` já exclui o rascunho sem
 * data.) A equivalência com a função acima é testada contra um avaliador do
 * `where` em `tests/campanha-entidade-status.test.ts`.
 */
export function statusWhere(filter: CampaignStatusFilter, now: Date): Prisma.CampaignWhereInput {
  const running: Prisma.CampaignWhereInput = {
    archivedAt: null,
    startsAt: { lte: now },
    OR: [{ endsAt: null }, { endsAt: { gte: now } }],
  };

  switch (filter) {
    case "archived":
      return { archivedAt: { not: null } };
    case "draft":
      return { archivedAt: null, OR: [{ startsAt: null }, { startsAt: { gt: now } }] };
    case "finished":
      return { archivedAt: null, startsAt: { lte: now }, endsAt: { lt: now } };
    case "paused":
      return { ...running, pausedAt: { not: null } };
    case "active":
      return { ...running, pausedAt: null };
    case "all":
    default:
      return { archivedAt: null };
  }
}
