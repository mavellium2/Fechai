import { ScrollText, ShieldBan } from "lucide-react";
import { requireSuperadmin } from "@/lib/session";
import { listAuditLogs, AUDIT_PAGE_SIZE } from "@/modules/audit/query";
import { AUDIT_GROUPS, type AuditGroup } from "@/modules/audit/events";
import { activeBlocksAmong, countActiveBlocks, listBlockedIps } from "@/modules/auth/ip-block";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { PageHeader } from "@/components/ui/page-header";
import { LogsToolbar } from "./LogsToolbar";
import { LogList } from "./LogList";
import { BlockedList } from "./BlockedList";
import { normalizeDays, type LogFilterValues } from "./filter-url";

/**
 * A trilha de auditoria: quem fez o quê, em qual conta, e o botão de desfazer —
 * mais a lista de IPs barrados do login.
 *
 * As duas abas moram na mesma tela porque são o mesmo assunto visto de dois
 * lados: a trilha mostra quem bateu na porta, e a lista mostra quem foi
 * impedido de bater de novo. Separá-las em rotas obrigaria a ir e voltar para
 * conferir se aquele IP que aparece dez vezes já está bloqueado.
 *
 * Mesma estrutura da lista de contas (Server Component + filtros na URL +
 * `Toolbar`): as duas telas do admin fazem a mesma tarefa sobre listas
 * diferentes, e quem usa uma usa a outra no mesmo dia.
 */
export const metadata = { title: "Logs" };

const TABS = [
  { key: "eventos", label: "Eventos" },
  { key: "bloqueados", label: "IPs bloqueados" },
];

export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<{
    aba?: string;
    q?: string;
    grupo?: string;
    autor?: string;
    tipo?: string;
    dias?: string;
    conta?: string;
    pendentes?: string;
    cursor?: string;
  }>;
}) {
  await requireSuperadmin();
  const sp = await searchParams;
  const tab = sp.aba === "bloqueados" ? "bloqueados" : "eventos";

  // A contagem alimenta o rótulo da aba nas DUAS abas: quem está lendo eventos
  // precisa ver que existem bloqueios ativos sem trocar de aba para descobrir.
  const activeBlocks = await countActiveBlocks();

  const tabs = TABS.map((t) =>
    t.key === "bloqueados" && activeBlocks > 0 ? { ...t, count: activeBlocks } : t,
  );

  if (tab === "bloqueados") {
    const blocked = await listBlockedIps();

    return (
      <div className="w-full space-y-6">
        <Header activeCount={blocked.length} tab={tab} />
        <FilterTabs
          accent="signal"
          label="Alternar entre eventos e IPs bloqueados"
          options={tabs}
          active={tab}
          href={(key) => (key === "eventos" ? "/admin/logs" : `/admin/logs?aba=${key}`)}
        />

        {blocked.length === 0 ? (
          <div className="rounded-surface border border-white/10 bg-white/5">
            <EmptyState
              icon={ShieldBan}
              title="Nenhum IP bloqueado"
              description="Na aba Eventos, um endereço que insiste em entrar pode ser bloqueado direto na linha do log — o botão aparece nos eventos de acesso."
            />
          </div>
        ) : (
          <BlockedList
            rows={blocked.map((b) => ({
              ...b,
              createdAt: b.createdAt.toISOString(),
              expiresAt: b.expiresAt?.toISOString() ?? null,
            }))}
          />
        )}
      </div>
    );
  }

  // Cada campo vem como "a,b" na URL — um parâmetro por campo, e não repetido,
  // para o endereço ficar legível e curto o bastante para copiar e mandar.
  const list = (v?: string) => (v ? v.split(",").filter(Boolean) : []);

  const filters: LogFilterValues = {
    q: sp.q ?? "",
    // Só chaves que existem no catálogo: um grupo inventado na URL viraria um
    // `IN` vazio e a lista abriria em branco sem explicar por quê.
    grupo: list(sp.grupo).filter(isGroup),
    autor: list(sp.autor).filter((a) => ACTOR_KEYS.includes(a)),
    tipo: list(sp.tipo).filter((t) => KIND_KEYS.includes(t)),
    // Janela padrão de 30 dias: a tabela cresce sem teto, e abrir a tela na
    // história inteira faria a primeira consulta varrer tudo para mostrar as
    // 50 linhas de cima.
    dias: normalizeDays(sp.dias),
    pendentes: sp.pendentes === "1",
    conta: sp.conta ?? "",
  };

  const { rows, nextCursor } = await listAuditLogs({
    search: filters.q || undefined,
    // Já filtrado por `isGroup` acima; o cast só reconcilia o tipo largo que a
    // URL produz com o estreito do catálogo.
    groups: filters.grupo as AuditGroup[],
    actors: filters.autor,
    kinds: filters.tipo,
    tenantId: filters.conta || undefined,
    days: filters.dias,
    onlyRevertible: filters.pendentes,
    cursor: sp.cursor,
    take: AUDIT_PAGE_SIZE,
  });

  // Uma consulta só para a página inteira, em vez de uma por linha: são 50
  // eventos, e checar o bloqueio linha a linha seriam 50 idas ao banco para
  // desenhar uma etiqueta.
  const blockedIps = await activeBlocksAmong(
    rows.map((r) => r.ip).filter((ip): ip is string => Boolean(ip)),
  );

  const filtering =
    filters.grupo.length + filters.autor.length + filters.tipo.length > 0 ||
    filters.pendentes ||
    Boolean(filters.conta);

  // Página cheia até o teto: provavelmente há mais eventos depois dele.
  const atLimit = rows.length === AUDIT_PAGE_SIZE;

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="admin"
        title="Logs"
        description="Entradas na plataforma e alterações feitas pelas contas. Alterações e exclusões podem ser desfeitas."
        actions={
          <span className="font-mono text-micro uppercase tracking-[0.15em] text-white/60">
            {/* Com filtro ativo o número é do recorte, não do total. E cheio até
                o teto da página, o "+" avisa que há mais além do corte. */}
            {rows.length}
            {atLimit ? "+" : ""}{" "}
            {filtering || filters.q ? "no filtro" : `evento${rows.length === 1 ? "" : "s"}`}
          </span>
        }
      />

      <FilterTabs
        accent="signal"
        label="Alternar entre eventos e IPs bloqueados"
        options={tabs}
        active={tab}
        href={(key) => (key === "eventos" ? "/admin/logs" : `/admin/logs?aba=${key}`)}
      />

      <LogsToolbar filters={filters} />

      {rows.length === 0 ? (
        <div className="rounded-surface border border-white/10 bg-white/5">
          <EmptyState
            icon={ScrollText}
            title={
              filters.q
                ? `Nenhum evento com “${filters.q}”`
                : filtering
                  ? "Nenhum evento com esses filtros"
                  : "Nenhum evento nesse período"
            }
            description={
              filters.q
                ? "Confira a grafia ou limpe a busca para ver todos os eventos."
                : filtering
                  ? "Nenhum evento combina com o recorte escolhido. Limpe um filtro para ampliar a lista."
                  : "Nada foi registrado na janela de tempo escolhida. Amplie o período para ver eventos mais antigos."
            }
          />
        </div>
      ) : (
        <LogList
          rows={serialize(rows)}
          nextCursor={nextCursor}
          filters={filters}
          blockedIps={[...blockedIps]}
        />
      )}
    </div>
  );
}

/** O cabeçalho da aba de bloqueados — a de eventos tem a contagem do recorte. */
function Header({ activeCount, tab }: { activeCount: number; tab: string }) {
  return (
    <PageHeader
      eyebrow="admin"
      title="Logs"
      description="Entradas na plataforma e alterações feitas pelas contas. Alterações e exclusões podem ser desfeitas."
      actions={
        tab === "bloqueados" ? (
          <span className="font-mono text-micro uppercase tracking-[0.15em] text-white/60">
            {activeCount} {activeCount === 1 ? "bloqueio" : "bloqueios"}
          </span>
        ) : undefined
      }
    />
  );
}

/**
 * Datas viram string antes de cruzar para o Client Component: um `Date` passa
 * pela serialização do Next, mas volta como string do outro lado — melhor
 * converter aqui, onde o tipo diz a verdade, que descobrir no runtime.
 */
function serialize(rows: Awaited<ReturnType<typeof listAuditLogs>>["rows"]) {
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    revertedAt: row.revertedAt?.toISOString() ?? null,
  }));
}

const ACTOR_KEYS = ["cliente", "admin", "sistema"];
const KIND_KEYS = ["create", "update", "delete", "auth", "access"];

function isGroup(value: string): value is AuditGroup {
  return value in AUDIT_GROUPS;
}
