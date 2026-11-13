import { Archive, CircleCheck, CircleDot, CirclePause, FilePenLine, type LucideIcon } from "lucide-react";
import type { BadgeProps } from "@/components/ui/badge";
import { dayOf, formatDateTime, formatDay, zoneOrDefault } from "@/modules/campaigns/period";
import type { CampaignStatus, CampaignStatusFilter } from "@/modules/campaigns/status";

/**
 * Textos e ícones das telas de campanha, num lugar só: a lista, o detalhe e as
 * abas dizem "Pausada" do mesmo jeito. As regras (o que cada status permite)
 * moram em `modules/campaigns/status.ts`, não aqui.
 */

export const STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: "Rascunho",
  active: "Ativa",
  paused: "Pausada",
  finished: "Terminada",
  archived: "Arquivada",
};

/**
 * O tom segue o que cada cor significa no produto (e o que o /disparos já faz
 * com os status dele): `iris` é o que está em andamento, `warn` é o que pede
 * atenção (pausada), `success` é o concluído, e `neutral` o que está parado
 * (rascunho, arquivada). `success` é "só sucesso/confirmação" — por isso não é
 * a "Ativa", que está rodando, e sim a "Terminada".
 */
export const STATUS_TONE: Record<CampaignStatus, NonNullable<BadgeProps["tone"]>> = {
  draft: "neutral",
  active: "iris",
  paused: "warn",
  finished: "success",
  archived: "neutral",
};

/** Estado nunca é só cor: cada um tem o próprio ícone além do texto. */
export const STATUS_ICON: Record<CampaignStatus, LucideIcon> = {
  draft: FilePenLine,
  active: CircleDot,
  paused: CirclePause,
  finished: CircleCheck,
  archived: Archive,
};

/** Ordem e nome das abas da lista. */
export const FILTER_ORDER: readonly CampaignStatusFilter[] = ["all", "active", "draft", "paused", "finished", "archived"];

export const FILTER_LABEL: Record<CampaignStatusFilter, string> = {
  all: "Todas",
  active: "Ativas",
  draft: "Rascunho",
  paused: "Pausadas",
  finished: "Terminadas",
  archived: "Arquivadas",
};

/** O que a lista diz quando a aba está vazia (e a conta já tem campanhas em outras). */
export const EMPTY_FILTER: Record<CampaignStatusFilter, { title: string; description: string }> = {
  all: {
    title: "Nenhuma campanha fora do arquivo",
    description: "As campanhas arquivadas ficam na aba Arquivadas.",
  },
  active: {
    title: "Nenhuma campanha ativa",
    description: "Uma campanha fica ativa a partir da data de início e vai até a data de fim.",
  },
  draft: {
    title: "Nenhum rascunho",
    description: "Campanha sem data de início, ou que ainda não começou, fica aqui.",
  },
  paused: {
    title: "Nenhuma campanha pausada",
    description: "Quando você pausar uma campanha ativa, ela aparece aqui até ser retomada.",
  },
  finished: {
    title: "Nenhuma campanha terminada",
    description: "A campanha termina sozinha depois da data de fim e continua nos relatórios.",
  },
  archived: {
    title: "Nenhuma campanha arquivada",
    description: "Campanhas arquivadas saem da lista principal e ficam aqui, só para consulta.",
  },
};

/** Seções da página da campanha, na ordem em que aparecem (e na navegação). */
export const SECTIONS = [
  { id: "resumo", label: "Resumo" },
  { id: "anuncios", label: "Anúncios" },
  { id: "regras", label: "Regras do agente" },
  { id: "midias", label: "Mídias" },
  { id: "disparos", label: "Disparos" },
  { id: "leads", label: "Leads" },
  { id: "resultados", label: "Resultados" },
] as const;

type DatedCampaign = {
  startsAt: Date | null;
  endsAt: Date | null;
  pausedAt: Date | null;
  archivedAt: Date | null;
  timezone: string;
};

/**
 * Uma frase sobre a situação atual, para o Resumo. Existe porque o status é
 * calculado das datas e, sozinho, "Rascunho" confunde quem pôs uma data de
 * início que ainda não chegou.
 */
export function statusNote(status: CampaignStatus, campaign: DatedCampaign): string {
  const zone = zoneOrDefault(campaign.timezone);
  switch (status) {
    case "draft":
      return campaign.startsAt
        ? `Começa em ${formatDay(dayOf(campaign.startsAt, zone))}. Até lá ela fica como rascunho.`
        : "Sem data de início, a campanha fica como rascunho.";
    case "active":
      return campaign.endsAt
        ? `Termina em ${formatDay(dayOf(campaign.endsAt, zone))}.`
        : "Sem data de fim: continua ativa até você definir uma ou arquivá-la.";
    case "paused":
      return campaign.pausedAt
        ? `Pausada em ${formatDateTime(campaign.pausedAt, zone)}. Retome quando quiser.`
        : "Pausada. Retome quando quiser.";
    case "finished":
      return campaign.endsAt ? `Terminou em ${formatDay(dayOf(campaign.endsAt, zone))}.` : "Terminada.";
    case "archived":
      return campaign.archivedAt
        ? `Arquivada em ${formatDateTime(campaign.archivedAt, zone)}.`
        : "Arquivada.";
  }
}

/**
 * Aviso do topo da página quando a campanha é só para consulta. Terminada e
 * arquivada não têm botão de edição; o texto diz por quê e que ela continua
 * nos relatórios (nenhuma consulta de resultado filtra por status).
 */
export function readOnlyNotice(status: CampaignStatus, campaign: DatedCampaign): string | null {
  const zone = zoneOrDefault(campaign.timezone);
  if (status === "finished") {
    const end = campaign.endsAt ? ` em ${formatDay(dayOf(campaign.endsAt, zone))}` : "";
    return `Campanha terminada${end}. Fica só para consulta e segue nos relatórios.`;
  }
  if (status === "archived") {
    return "Campanha arquivada. Fica só para consulta e segue nos relatórios.";
  }
  return null;
}
