import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { PlanKey, Prisma, UserRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateStrongPassword, BCRYPT_COST } from "@/lib/password";
import { createTenantWithOwner } from "@/modules/tenants/provision";
import { deleteFromBunny } from "@/lib/bunny";
import {
  getWhatsAppProviderForInstance,
  WHATSAPP_PROVIDER_SELECT,
  type WhatsappProviderInstance,
} from "@/modules/whatsapp/meta-config";
import { deleteVoice } from "@/modules/voice/fish";
import { PLANS } from "@/modules/billing/plans";

// Funções cross-tenant do painel admin. Autorização (SUPERADMIN) é garantida
// na rota (admin)/ via requireSuperadmin — nunca chamar fora dela.

export type TenantFilters = {
  search?: string;
  /**
   * Listas, não valores únicos: dentro do mesmo campo os valores são OU
   * ("Free OU Starter"), e entre campos, E. Lista vazia = campo não filtra.
   */
  status?: string[];
  plan?: PlanKey[];
  /** "connected" | "pending_qr" | "disconnected" | "none" */
  whatsapp?: string[];
  /** "ativo" (em teste agora) | "expirado" (teste terminou) | "sem" */
  trial?: string[];
  /** "recentes" (padrão) | "antigas" | "nome" | "leads" | "conversas" */
  sort?: string;
  /** Quantas linhas trazer. Fora da lista aceita, cai no padrão. */
  take?: number;
};

/**
 * Tamanhos de página oferecidos no painel.
 *
 * Lista fechada de propósito: o número vem da URL, e um `take` livre deixaria
 * qualquer visitante pedir `?limite=100000` — um SELECT que varre a tabela
 * inteira por conta de um parâmetro digitado à mão.
 */
export const TENANT_PAGE_SIZES = [20, 50, 100, 200] as const;
export const DEFAULT_TENANT_PAGE_SIZE = 100;

/** Devolve um tamanho de página confiável a partir do que veio na URL. */
export function normalizePageSize(raw: string | undefined): number {
  const n = Number(raw);
  return (TENANT_PAGE_SIZES as readonly number[]).includes(n)
    ? n
    : DEFAULT_TENANT_PAGE_SIZE;
}

/**
 * Filtro do painel por estado do WhatsApp. É o estado da conta em uma palavra
 * (`summarizeWhatsappStatus`): conectada se QUALQUER conexão atende, aguardando
 * leitura só se nenhuma atende, e "nunca conectou" é ausência de linha, não um
 * status. A conta pode ter uma linha por provedor, então cada estado exclui os
 * de cima.
 */
function whatsappStateFilter(state: string): Prisma.TenantWhereInput {
  switch (state) {
    case "none":
      return { whatsappInstances: { none: {} } };
    case "connected":
      return { whatsappInstances: { some: { status: "connected" } } };
    case "pending_qr":
      return { whatsappInstances: { some: { status: "pending_qr" }, none: { status: "connected" } } };
    case "disconnected":
      return {
        whatsappInstances: { some: {}, none: { status: { in: ["connected", "pending_qr"] } } },
      };
    default:
      return { whatsappInstances: { some: { status: state } } };
  }
}

const TRIAL_PLAN_KEYS = PLANS.filter((p) => p.trialDays != null).map((p) => p.key);

/**
 * Teste encerrado: plano de teste sem data futura. Sem data conta como encerrado
 * — é a mesma regra do badge da lista e do `usage.ts` (sem `trialEndsAt` a IA cala).
 */
function trialEndedWhere(now: Date): Prisma.TenantWhereInput {
  return {
    planKey: { in: TRIAL_PLAN_KEYS },
    OR: [{ trialEndsAt: null }, { trialEndsAt: { lte: now } }],
  };
}

/** Suspensas e testes encerrados: ficam fora da lista até um filtro pedir. */
function hiddenByDefault(now: Date): Prisma.TenantWhereInput {
  return { OR: [{ status: "suspended" }, trialEndedWhere(now)] };
}

/**
 * Quem escolheu um filtro de situação ou de teste vê a lista como ele pede, com
 * as suspensas e encerradas incluídas. Sem isso, o padrão as esconde.
 */
export function revealsClosedAccounts(filters: Pick<TenantFilters, "status" | "trial">): boolean {
  return Boolean(filters.status?.length || filters.trial?.length);
}

/** Quantas contas o padrão está escondendo — para a lista vazia dizer por quê. */
export async function countHiddenTenants(): Promise<number> {
  return prisma.tenant.count({ where: hiddenByDefault(new Date()) });
}

/**
 * Contas da plataforma, com os filtros do painel.
 *
 * Filtrar no banco, e não no cliente: a lista é cortada por `take` e um filtro
 * aplicado depois do corte mentiria — mostraria "nenhuma suspensa" quando há
 * uma na posição 300.
 */
export async function listTenants(filters: TenantFilters = {}) {
  const { search, status, plan, whatsapp, trial, sort, take } = filters;
  const now = new Date();

  const where: Prisma.TenantWhereInput = {};
  if (search) where.name = { contains: search, mode: "insensitive" };
  if (status?.length) where.status = { in: status };
  if (!revealsClosedAccounts(filters)) where.NOT = hiddenByDefault(now);
  if (plan?.length) where.planKey = { in: plan };

  if (whatsapp?.length) {
    // Várias escolhas viram um OR: cada uma descreve um estado da conta.
    const clauses = whatsapp.map(whatsappStateFilter);
    if (clauses.length === 1) Object.assign(where, clauses[0]);
    else where.OR = clauses;
  }

  // "em teste" é ter data futura; "expirado" é teste encerrado (ver
  // `trialEndedWhere`). Conta sem data nunca esteve em teste — são três estados,
  // não dois, e como eles se sobrepõem no mesmo campo, várias escolhas viram um OR.
  if (trial?.length) {
    const clauses: Prisma.TenantWhereInput[] = [];
    if (trial.includes("ativo")) clauses.push({ trialEndsAt: { gt: now } });
    if (trial.includes("expirado")) clauses.push(trialEndedWhere(now));
    if (trial.includes("sem")) clauses.push({ trialEndsAt: null });
    // Sempre `AND`, mesmo com uma cláusula só: `trialEndedWhere` traz `planKey` e
    // `OR`, e espalhar no objeto sobrescreveria o filtro de plano e o `OR` do WhatsApp.
    if (clauses.length) where.AND = [{ OR: clauses }];
  }

  const orderBy: Prisma.TenantOrderByWithRelationInput =
    sort === "antigas"
      ? { createdAt: "asc" }
      : sort === "nome"
        ? { name: "asc" }
        : sort === "leads"
          ? { leads: { _count: "desc" } }
          : sort === "conversas"
            ? { conversations: { _count: "desc" } }
            : { createdAt: "desc" };

  return prisma.tenant.findMany({
    where,
    orderBy,
    take: (TENANT_PAGE_SIZES as readonly number[]).includes(take ?? NaN)
      ? take
      : DEFAULT_TENANT_PAGE_SIZE,
    include: {
      whatsappInstances: { select: { status: true } },
      users: { select: { id: true, email: true, role: true } },
      // `isTest: false` aqui pelo mesmo motivo do resto do produto: o sandbox
      // não é negócio. Sem o filtro, o admin mostrava um total de leads maior
      // que o de /relatorios para a mesma conta e não havia como saber qual
      // dos dois estava certo.
      _count: {
        select: {
          users: true,
          leads: { where: { isTest: false } },
          conversations: { where: { isTest: false } },
        },
      },
    },
  });
}

export async function getTenantDetail(tenantId: string) {
  return prisma.tenant.findUnique({
    where: { id: tenantId },
    include: {
      users: { select: { email: true, role: true, createdAt: true } },
      whatsappInstances: { select: { status: true } },
      _count: {
        select: {
          leads: { where: { isTest: false } },
          conversations: { where: { isTest: false } },
          knowledgeDocs: true,
        },
      },
    },
  });
}

export async function setTenantStatus(tenantId: string, status: "active" | "suspended") {
  await prisma.tenant.update({ where: { id: tenantId }, data: { status } });
}

export async function adminSetPlan(tenantId: string, planKey: PlanKey) {
  await prisma.tenant.update({ where: { id: tenantId }, data: { planKey } });
}

/**
 * Fixa a cota de mensagens/mês fora do padrão do plano (override), ou restaura
 * o padrão com `null`. É o "alterar o limite da conta" — agora uma cota só, em
 * mensagens (a cota de conversas e o teto por conversa deixaram de existir).
 */
export async function adminSetUsageLimit(tenantId: string, limit: number | null) {
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { messageLimitOverride: limit },
  });
}

/**
 * Fixa (ou remove, com `null`) o preço realmente cobrado desta conta.
 *
 * Existe porque o preço de tabela nem sempre é o preço da fatura: desconto
 * negociado, cortesia, contrato antigo mantido. Sem isto, a visão Financeira
 * de /relatorios mostrava um "Investido" que o cliente sabia estar errado, e
 * a saída seria trocar o plano — o que mexeria na cota junto.
 *
 * Mesmo desenho de `messageLimitOverride`: é override do VALOR, não do plano.
 * Cota, limite de agentes e ações continuam vindo de `planKey`.
 */
export async function adminSetPriceOverride(tenantId: string, priceCents: number | null) {
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { priceCentsOverride: priceCents },
  });
}

/**
 * Fixa (ou encerra, com `null`) o fim do período de teste da conta. Passada a
 * data, `runAgentTurn` cala a IA até a pessoa assinar — o painel segue
 * acessível. É como o admin dá mais alguns dias a quem pediu, ou corta o teste
 * na hora.
 */
export async function adminSetTrialEndsAt(tenantId: string, endsAt: Date | null) {
  await prisma.tenant.update({ where: { id: tenantId }, data: { trialEndsAt: endsAt } });
}

/**
 * Cria uma conta pelo painel admin — qualquer papel, qualquer plano.
 *
 * Diferente do cadastro público (`/api/register`, que só faz OWNER + FREE):
 * aqui o superadmin escolhe papel e plano, e pode deixar a senha em branco
 * para o sistema gerar uma provisória (devolvida UMA vez para ser repassada).
 */
export async function adminCreateAccount(input: {
  tenantName: string;
  email: string;
  password?: string;
  role: UserRole;
  planKey: PlanKey;
}): Promise<{ ok: true; tempPassword?: string } | { ok: false; error: string }> {
  const email = input.email.trim().toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return { ok: false, error: "Já existe um usuário com esse e-mail." };

  // Sem senha informada: gera uma provisória e devolve para o admin repassar.
  const generated = input.password?.trim() ? undefined : generatePassword();
  const password = input.password?.trim() || (generated as string);

  await createTenantWithOwner({
    tenantName: input.tenantName.trim() || email.split("@")[0],
    email,
    passwordHash: await bcrypt.hash(password, BCRYPT_COST),
    role: input.role,
    planKey: input.planKey,
  });

  return { ok: true, tempPassword: generated };
}

/**
 * Senha provisória do admin. Delega para `generateStrongPassword` porque a
 * gerada antes (só letras e dígitos) não passaria na política que agora vale
 * para todo mundo — o admin criaria contas com senha que o próprio produto
 * recusa na troca.
 */
function generatePassword(): string {
  return generateStrongPassword((n) => new Uint8Array(randomBytes(n)));
}

/**
 * Apaga uma conta e tudo que pende dela, definitivamente.
 *
 * Só existe como último passo depois de suspender: `deleteTenant` recusa conta
 * ativa (ver a action). Suspender é reversível e cobre 99% dos casos — este
 * caminho é para pedido de exclusão de dados (LGPD art. 18, VI) e para limpar
 * conta de teste. Não há desfazer.
 *
 * O `onDelete: Cascade` do schema derruba users, agentes, leads, conversas,
 * mensagens, agendamentos, documentos e credenciais numa linha só. Duas coisas
 * NÃO são cobertas por ele, e é por isso que esta função é maior que um
 * `prisma.tenant.delete`:
 *
 *   1. O que vive fora do Postgres — a instância na Evolution (o número segue
 *      conectado, recebendo e queimando sessão) e os arquivos na BunnyCDN
 *      (widget.js, anexos da base de conhecimento, ícone, áudios). Apagar a
 *      linha e deixar isso de pé é o pior dos dois mundos: some do painel e
 *      continua existindo.
 *   2. `Referral.tenantId` é `SetNull` de propósito — a comissão já paga ao
 *      afiliado não é reescrita porque o cliente saiu. O histórico financeiro
 *      sobrevive à conta.
 *
 * A limpeza externa vem ANTES do delete e **nunca lança**: se a Evolution ou a
 * Bunny estiverem fora do ar, a exclusão continua. O contrário — abortar a
 * exclusão porque um terceiro caiu — deixaria o admin sem conseguir cumprir um
 * pedido de exclusão de dados por causa de um serviço de arquivo estático.
 */
export async function deleteTenant(tenantId: string): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      whatsappInstances: { select: WHATSAPP_PROVIDER_SELECT },
      agents: { select: { voiceId: true, voiceSource: true } },
      knowledgeDocs: { select: { fileUrl: true } },
    },
  });
  if (!tenant) return;

  await releaseExternalResources(tenant);

  await prisma.tenant.delete({ where: { id: tenantId } });
}

/**
 * Solta o que a conta ocupa fora do nosso banco. Cada passo é isolado: a falha
 * de um não impede os outros nem a exclusão em si — só vira log.
 */
async function releaseExternalResources(tenant: {
  id: string;
  whatsappInstances: WhatsappProviderInstance[];
  agents: { voiceId: string | null; voiceSource: string | null }[];
  knowledgeDocs: { fileUrl: string | null }[];
}): Promise<void> {
  // Uma conexão por provedor: a conta pode ter o QR e a API oficial de pé, e
  // deixar uma delas para trás seria um número atendendo uma conta que sumiu.
  for (const instance of tenant.whatsappInstances) {
    if (!instance.externalId) continue;
    try {
      // Logout, não delete: derruba a sessão do WhatsApp para o número não
      // seguir conectado a uma conta que não existe mais.
      await getWhatsAppProviderForInstance(instance).disconnect(instance.externalId);
    } catch (err) {
      console.error("[admin] falha ao desconectar WhatsApp da conta excluída", tenant.id, err);
    }
  }

  for (const agent of tenant.agents) {
    // Voz do catálogo é um modelo COMPARTILHADO entre contas: apagá-lo derruba
    // a voz de todo mundo que a escolheu. Só a gravada é nossa para apagar.
    if (agent.voiceId && agent.voiceSource !== "catalog") {
      try {
        await deleteVoice(agent.voiceId);
      } catch (err) {
        console.error("[admin] falha ao apagar voz da conta excluída", tenant.id, err);
      }
    }
  }

  // Arquivos da CDN. `deleteFromBunny` já é silencioso por dentro.
  await deleteFromBunny(`widget/${tenant.id}/widget.js`);
  for (const doc of tenant.knowledgeDocs) {
    const path = bunnyPathFromUrl(doc.fileUrl);
    if (path) await deleteFromBunny(path);
  }
}

/**
 * Converte a URL pública guardada no banco de volta no caminho da storage zone.
 * Guardamos a URL da pull zone (`https://<pull>/knowledge/...`), mas a API de
 * storage endereça pelo caminho — sem essa conversão o DELETE bate em 404 e o
 * arquivo fica órfão.
 */
function bunnyPathFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).pathname.replace(/^\/+/, "") || null;
  } catch {
    return null;
  }
}
