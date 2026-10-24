import { Building2 } from "lucide-react";
import { requireSuperadmin } from "@/lib/session";
import {
  countHiddenTenants,
  listTenants,
  normalizePageSize,
  revealsClosedAccounts,
  DEFAULT_TENANT_PAGE_SIZE,
  TENANT_PAGE_SIZES,
} from "@/modules/admin/service";
import { planOf } from "@/modules/billing/plans";
import { summarizeWhatsappStatus } from "@/modules/whatsapp/instances";
import type { PlanKey } from "@prisma/client";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { TenantRow } from "./TenantRow";
import { AccountsToolbar } from "./AccountsToolbar";

// "Ação" virou uma coluna só, com um botão só: a edição toda mudou para o
// painel lateral do `TenantRow`.
const COLUMNS = [
  { key: "tenant", label: "Tenant" },
  { key: "plano", label: "Plano" },
  { key: "cota", label: "Cota" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "status", label: "Status" },
  { key: "acoes", label: "Ações", hideLabel: true, alignEnd: true },
];

export default async function ContasPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    plan?: string;
    whatsapp?: string;
    trial?: string;
    sort?: string;
    limite?: string;
  }>;
}) {
  await requireSuperadmin();
  const sp = await searchParams;
  const q = sp.q;

  // Cada campo vem como "a,b" na URL — um parâmetro por campo, e não repetido,
  // para o endereço ficar legível e curto o bastante para copiar e mandar.
  const list = (v?: string) => (v ? v.split(",").filter(Boolean) : []);

  const filters = {
    q: q ?? "",
    status: list(sp.status),
    plan: list(sp.plan),
    whatsapp: list(sp.whatsapp),
    trial: list(sp.trial),
    sort: sp.sort ?? "recentes",
    // Fora da lista aceita (inclusive um número inventado na URL) cai no padrão.
    limite: normalizePageSize(sp.limite),
  };
  const filtering =
    filters.status.length + filters.plan.length + filters.whatsapp.length + filters.trial.length >
    0;

  const tenants = await listTenants({
    search: q,
    status: filters.status,
    plan: filters.plan as PlanKey[],
    whatsapp: filters.whatsapp,
    trial: filters.trial,
    sort: filters.sort,
    take: filters.limite,
  });

  // Lista cheia até o teto escolhido: provavelmente há mais contas depois dele.
  const atLimit = tenants.length === filters.limite;

  // Lista vazia sem filtro pode ser só o padrão escondendo suspensas e encerradas.
  // Dizer "nenhuma conta ainda" nesse caso seria mentira.
  const hiddenCount =
    tenants.length === 0 && !revealsClosedAccounts(filters) ? await countHiddenTenants() : 0;

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="admin"
        title="Contas"
        actions={
          <span className="font-mono text-micro uppercase tracking-[0.15em] text-white/60">
            {/* Com filtro ativo o número é do recorte, não do total — dizer
                "10 tenants" filtrando 3 seria mentira. E cheio até o limite
                escolhido, o "+" avisa que pode haver mais além do corte:
                "100 tenants" quando o teto é 100 diria que a lista acabou. */}
            {tenants.length}
            {atLimit ? "+" : ""}{" "}
            {filtering || q ? "no filtro" : `tenant${tenants.length === 1 ? "" : "s"}`}
          </span>
        }
      />

      {/*
        Busca e "Nova conta" na mesma linha: são as duas ações da tela, e o
        botão sozinho acima empurrava a tabela para baixo sem motivo. O card de
        criação continua abaixo, quando aberto — é ele que precisa da largura,
        não o gatilho.

        A busca era um <input> sem <label> e sem botão: só funcionava para quem
        adivinhasse que tinha de apertar Enter.
      */}
      {/* Busca, filtro, ordenação e "Nova conta" na mesma barra — são as ações
          da mesma tela, sobre a mesma lista. */}
      <AccountsToolbar
        filters={filters}
        pageSizes={TENANT_PAGE_SIZES}
        defaultLimit={DEFAULT_TENANT_PAGE_SIZE}
      />

      {tenants.length === 0 ? (
        <div className="rounded-surface border border-white/10 bg-white/5">
          <EmptyState
            icon={Building2}
            title={
              q
                ? `Nenhuma conta com “${q}”`
                : filtering
                  ? "Nenhuma conta com esses filtros"
                  : hiddenCount > 0
                    ? "Nenhuma conta ativa para mostrar"
                    : "Nenhuma conta ainda"
            }
            description={
              hiddenCount > 0
                ? `${q ? "Confira a grafia ou limpe a busca. " : ""}Suspensas e testes encerrados ficam ocultos por padrão — use Filtrar para vê-los.`
                : q
                  ? "Confira a grafia ou limpe a busca para ver todas as contas."
                  : filtering
                    ? "Nenhuma conta combina com o recorte escolhido. Limpe um filtro para ampliar a lista."
                    : "Crie a primeira conta em “Nova conta” — o tenant, o usuário e a configuração base saem prontos."
            }
          />
        </div>
      ) : (
        <div
          // região rolável precisa ser alcançável pelo teclado
          tabIndex={0}
          role="region"
          aria-label="Tabela de contas (rolagem horizontal)"
          className="overflow-x-auto rounded-surface border border-white/10 bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
        >
          <table className="w-full text-left text-sm">
            <caption className="sr-only">
              Contas da plataforma, com plano, status do WhatsApp e situação da conta.
            </caption>
            <thead className="font-mono text-micro uppercase tracking-[0.15em] text-white/55">
              <tr>
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    className={`px-4 py-3 font-medium ${c.alignEnd ? "text-right" : ""}`}
                  >
                    {/* A coluna de ações não tem título visível (o botão se
                        explica), mas precisa de um para o leitor de tela. */}
                    {c.hideLabel ? <span className="sr-only">{c.label}</span> : c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <TenantRow
                  key={t.id}
                  id={t.id}
                  name={t.name}
                  planKey={t.planKey}
                  status={t.status}
                  whatsappStatus={t.whatsappInstances.length ? summarizeWhatsappStatus(t.whatsappInstances) : "—"}
                  metaWhatsappEnabled={t.metaWhatsappEnabled}
                  evolutionWhatsappEnabled={t.evolutionWhatsappEnabled}
                  messageLimitOverride={t.messageLimitOverride}
                  priceCentsOverride={t.priceCentsOverride}
                  trialEndsAt={t.trialEndsAt ? t.trialEndsAt.toISOString() : null}
                  planIsTrial={planOf(t.planKey).trialDays != null}
                  isAdminAccount={t.users.some((u) => u.role === "SUPERADMIN")}
                  ownerUserId={t.users.find((u) => u.role === "OWNER")?.id ?? t.users[0]?.id}
                  createdAt={t.createdAt.toLocaleDateString("pt-BR")}
                  counts={{
                    users: t._count.users,
                    leads: t._count.leads,
                    conversations: t._count.conversations,
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
