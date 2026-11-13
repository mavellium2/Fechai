import { Archive, CalendarClock, CircleCheck, CircleDot, CirclePause, FilePenLine, type LucideIcon } from "lucide-react";
import type { BadgeProps } from "@/components/ui/badge";
import { dayOf, formatDay, zoneOrDefault } from "@/modules/campaigns/period";
import type { CampaignStatus, CampaignStatusFilter } from "@/modules/campaigns/status";

/**
 * Textos e ícones das telas de campanha, num lugar só: a lista, o detalhe e as
 * abas dizem "Pausada" do mesmo jeito. As regras (o que cada status permite)
 * moram em `modules/campaigns/status.ts`, não aqui.
 */

export const STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: "Rascunho",
  scheduled: "Agendada",
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
  scheduled: "signal",
  active: "iris",
  paused: "warn",
  finished: "success",
  archived: "neutral",
};

/** Estado nunca é só cor: cada um tem o próprio ícone além do texto. */
export const STATUS_ICON: Record<CampaignStatus, LucideIcon> = {
  draft: FilePenLine,
  scheduled: CalendarClock,
  active: CircleDot,
  paused: CirclePause,
  finished: CircleCheck,
  archived: Archive,
};

/** Ordem e nome das abas da lista. */
export const FILTER_ORDER: readonly CampaignStatusFilter[] = ["all", "active", "scheduled", "draft", "paused", "finished", "archived"];

export const FILTER_LABEL: Record<CampaignStatusFilter, string> = {
  all: "Todas",
  active: "Ativas",
  scheduled: "Agendadas",
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
    description: "Campanha que ainda não foi ativada fica aqui, sem valer para os leads.",
  },
  scheduled: {
    title: "Nenhuma campanha agendada",
    description: "Campanha ativada com início no futuro fica aqui até a data chegar.",
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

/** Abas da página da campanha. Rascunho abre em Configuração. */
export const SECTIONS = [
  { id: "resultados", label: "Resultados" },
  { id: "leads", label: "Leads" },
  { id: "configuracao", label: "Configuração" },
  { id: "historico", label: "Histórico" },
] as const;

export type SectionId = (typeof SECTIONS)[number]["id"];

/** Endereços antigos (`?aba=regras`…) caem na aba nova certa. */
const LEGACY_SECTION: Record<string, { section: SectionId; step?: StepId }> = {
  "visao-geral": { section: "resultados" },
  dados: { section: "configuracao", step: "basico" },
  anuncios: { section: "configuracao", step: "origem" },
  disparos: { section: "configuracao", step: "origem" },
  regras: { section: "configuracao", step: "agenda" },
  revisao: { section: "configuracao", step: "revisao" },
};

export function parseSection(value: unknown): { section: SectionId; step?: StepId } | null {
  const first = Array.isArray(value) ? value[0] : value;
  if (SECTIONS.some((s) => s.id === first)) return { section: first as SectionId };
  return typeof first === "string" && LEGACY_SECTION[first] ? LEGACY_SECTION[first] : null;
}

/**
 * Os passos da configuração, na ordem em que se monta uma campanha. Cada um
 * diz para que serve numa frase — é o "tutorial" embutido na própria tela.
 */
export const STEPS = [
  { id: "basico", title: "O básico", purpose: "Nome, objetivo, período e meta da campanha." },
  { id: "agente", title: "Quem atende", purpose: "Qual agente conversa com os leads da campanha e o que ele fala sobre ela." },
  { id: "agenda", title: "Agenda da campanha", purpose: "Em que dias e horários o agente pode marcar, e se manda lembrete." },
  { id: "origem", title: "De onde vêm os leads", purpose: "Anúncios, palavras-chave e disparos que colocam o contato na campanha." },
  { id: "arquivos", title: "Arquivos", purpose: "Imagens, vídeos e PDFs que o agente pode mandar na conversa." },
  { id: "revisao", title: "Revisar e ativar", purpose: "Confira tudo e ative. Antes disso nada muda no atendimento." },
] as const;

export type StepId = (typeof STEPS)[number]["id"];

export function parseStep(value: unknown): StepId | null {
  const first = Array.isArray(value) ? value[0] : value;
  return STEPS.some((s) => s.id === first) ? (first as StepId) : null;
}

type DatedCampaign = {
  activatedAt: Date | null;
  startsAt: Date | null;
  endsAt: Date | null;
  pausedAt: Date | null;
  archivedAt: Date | null;
  timezone: string;
};

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
