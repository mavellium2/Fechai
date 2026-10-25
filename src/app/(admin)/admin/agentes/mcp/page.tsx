import { ArrowLeft, KeyRound } from "lucide-react";
import { requireSuperadmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { listAllMcpTokens, mcpTokenState, MCP_TOKEN_PREFIX } from "@/modules/agent-mcp/tokens";
import { McpTokenIssuer } from "./McpTokenIssuer";
import { RevokeMcpTokenButton } from "./RevokeMcpTokenButton";

const STATE = {
  active: { label: "ativo", tone: "success" },
  revoked: { label: "revogado", tone: "danger" },
  expired: { label: "vencido", tone: "warn" },
} as const;

const dateTime = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

export default async function AdminMcpPage() {
  await requireSuperadmin();
  const [tenants, tokens] = await Promise.all([
    prisma.tenant.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    listAllMcpTokens(),
  ]);

  return (
    <div className="w-full space-y-6">
      <PageHeader
        eyebrow="admin"
        title="Acesso MCP aos agentes"
        description="Tokens para uma ferramenta de IA (Claude Code, por exemplo) ler a configuração dos agentes de uma conta. Cada token vale para uma só conta e vence sozinho."
        actions={
          <ButtonLink href="/admin/agentes" variant="outline" size="sm">
            <ArrowLeft size={14} aria-hidden />
            Replicar agentes
          </ButtonLink>
        }
      />

      {tenants.length === 0 ? (
        <div className="rounded-surface border border-white/10 bg-white/5">
          <EmptyState icon={KeyRound} title="Nenhuma conta" description="Crie uma conta antes de emitir um token." />
        </div>
      ) : (
        <McpTokenIssuer tenants={tenants} />
      )}

      <section className="rounded-surface border border-white/10 bg-white/5 p-6">
        <h2 className="font-display text-lg font-semibold text-white">Tokens emitidos</h2>
        {tokens.length === 0 ? (
          <p className="mt-3 text-sm text-white/60">Nenhum token emitido ainda.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 font-mono text-micro uppercase tracking-wide text-white/50">
                  <th scope="col" className="py-2 pr-4 font-normal">Nome</th>
                  <th scope="col" className="py-2 pr-4 font-normal">Conta</th>
                  <th scope="col" className="py-2 pr-4 font-normal">Token</th>
                  <th scope="col" className="py-2 pr-4 font-normal">Permissões</th>
                  <th scope="col" className="py-2 pr-4 font-normal">Situação</th>
                  <th scope="col" className="py-2 pr-4 font-normal">Vence</th>
                  <th scope="col" className="py-2 pr-4 font-normal">Último uso</th>
                  <th scope="col" className="py-2 font-normal"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((token) => {
                  const state = mcpTokenState(token);
                  return (
                    <tr key={token.id} className="border-b border-white/5 align-top text-white/80">
                      <td className="py-3 pr-4">
                        <p className="font-medium text-white">{token.label}</p>
                        {token.createdByEmail && (
                          <p className="text-xs text-white/50">por {token.createdByEmail}</p>
                        )}
                      </td>
                      <td className="py-3 pr-4">{token.tenantName}</td>
                      <td className="py-3 pr-4 font-mono text-xs">{MCP_TOKEN_PREFIX}{token.tokenPrefix}…</td>
                      <td className="py-3 pr-4 text-xs">{token.scopes.join(", ")}</td>
                      <td className="py-3 pr-4">
                        <Badge tone={STATE[state].tone}>{STATE[state].label}</Badge>
                      </td>
                      <td className="py-3 pr-4 text-xs">{dateTime.format(token.expiresAt)}</td>
                      <td className="py-3 pr-4 text-xs">
                        {token.lastUsedAt ? dateTime.format(token.lastUsedAt) : "nunca"}
                      </td>
                      <td className="py-3 text-right">
                        {state === "active" && (
                          <RevokeMcpTokenButton
                            tenantId={token.tenantId}
                            tokenId={token.id}
                            label={token.label}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
