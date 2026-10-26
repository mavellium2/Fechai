import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { signOut } from "@/auth";
import { clearImpersonation } from "@/lib/impersonation";
import { getUsageSummary } from "@/modules/billing/usage";
import { getAccountRoles, isAffiliateOnly } from "@/modules/affiliates/roles";
import { Button } from "@/components/ui/button";
import { PanelShell } from "@/components/shell/PanelShell";
import { ImpersonationBanner } from "@/components/shell/ImpersonationBanner";
import { stopImpersonation } from "@/app/(admin)/actions";
import type { NavItem } from "@/components/shell/ShellNav";

/** Telas do produto (agente de WhatsApp) — só para quem marcou "usar no meu negócio". */
const NAV_PRODUTO: NavItem[] = [
  { href: "/inicio", label: "Início", icon: "Home" },
  { href: "/conversas", label: "Conversas", icon: "MessagesSquare" },
  { href: "/agenda", label: "Agenda", icon: "CalendarDays" },
  { href: "/perguntas", label: "Perguntas", icon: "CircleHelp" },
  { href: "/contatos", label: "Contatos", icon: "Users" },
  { href: "/agentes", label: "Agentes", icon: "Bot" },
];

/** Só para quem está no programa de afiliados. */
const NAV_AFILIADO: NavItem = { href: "/afiliado", label: "Afiliado", icon: "HandCoins" };

/** Relatórios servem aos dois papéis (a aba de afiliados vive lá dentro). */
const NAV_RELATORIOS: NavItem = { href: "/relatorios", label: "Relatórios", icon: "BarChart3" };

/** Sempre presente: é onde os papéis são ligados/desligados. */
const NAV_CONFIG: NavItem = { href: "/configuracoes", label: "Configurações", icon: "Settings" };

/**
 * Monta o menu a partir dos papéis da conta.
 *
 * Quem é só afiliado não vê Agentes, Conversas nem WhatsApp: são telas de um
 * produto que essa pessoa não usa, e um menu cheio de itens inúteis é pior que
 * um menu curto. Configurações fica sempre por último — é de lá que a pessoa
 * liga o outro papel quando quiser.
 */
function navFor(roles: { usesProduct: boolean; isAffiliate: boolean }, metaEnabled: boolean): NavItem[] {
  const items: NavItem[] = [];
  if (roles.usesProduct) items.push(...NAV_PRODUTO);
  if (roles.usesProduct && metaEnabled) items.push({ href: "/disparos", label: "Disparos", icon: "Send" });
  if (roles.isAffiliate) items.push(NAV_AFILIADO);
  items.push(NAV_RELATORIOS);
  if (roles.usesProduct) items.push({ href: "/integracoes", label: "Integrações", icon: "Plug" });
  items.push(NAV_CONFIG);
  return items;
}

/** Área logada: fora do índice. Robots.txt já bloqueia, mas a meta tag cobre o
 *  caso de a URL ser descoberta por link externo. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

async function signOutAction() {
  "use server";
  await clearImpersonation();
  await signOut({ redirectTo: "/login" });
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireOwner();
  const impersonating = session.user.impersonating ?? false;
  const tenantId = session.user.tenantId;
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { status: true, name: true, planKey: true, onboardingCompleted: true, metaWhatsappEnabled: true },
  });

  // Conta suspensa: bloqueia o app e orienta a contatar o suporte.
  if (tenant?.status === "suspended") {
    return (
      <div data-surface="dark" className="flex min-h-screen items-center justify-center bg-ink px-4">
        <div className="max-w-md rounded-surface border border-danger/40 bg-white/5 p-8 text-center">
          <h1 className="font-display text-xl font-semibold text-white">Conta suspensa</h1>
          <p className="mt-2 text-sm text-white/65">
            Sua conta está temporariamente suspensa. Fale com o suporte para reativá-la.
          </p>
          {impersonating ? (
            <form action={stopImpersonation} className="mt-6">
              <Button variant="outline" size="sm" type="submit">
                Sair da personificação
              </Button>
            </form>
          ) : (
            <form action={signOutAction} className="mt-6">
              <Button variant="outline" size="sm" type="submit">
                Sair
              </Button>
            </form>
          )}
        </div>
      </div>
    );
  }

  const roles = await getAccountRoles(session.user.id);
  const affiliateOnly = isAffiliateOnly(roles);

  // Conta nova: passa pelo onboarding guiado antes de entrar no painel. Fica
  // depois da checagem de suspensão para a conta suspensa ver o aviso, não o
  // wizard. (/onboarding está fora deste grupo de rotas, então não há loop.)
  //
  // Quem é SÓ afiliado escapa dessa porteira: não tem WhatsApp para conectar
  // nem agente para configurar, e prendê-lo no wizard seria um beco sem saída.
  // Quem usa o produto continua passando por ele — inclusive quem é as duas
  // coisas, porque aí o agente é metade do motivo de a conta existir.
  if (tenant && !tenant.onboardingCompleted && !affiliateOnly) redirect("/onboarding");

  // Uso do mês para o indicador da navegação (mensagens X/Y, link para
  // /configuracoes). Sem sentido para quem só afilia: a cota é de respostas da
  // IA, que essa conta não gasta.
  const usage = affiliateOnly ? null : await getUsageSummary(tenantId);

  const navItems = navFor(roles, tenant?.metaWhatsappEnabled ?? false);

  return (
    <PanelShell
      variant="tenant"
      navItems={navItems}
      // A marca leva para a primeira tela que a conta de fato tem: /inicio é
      // do produto e não existe para quem só afilia.
      brandHref={affiliateOnly ? "/afiliado" : "/inicio"}
      brandSubtitle={tenant?.name ?? "seu painel"}
      // Plano é assinatura do produto; para quem só afilia o rodapé identifica
      // o papel, que é a informação que faz sentido ali.
      footerLabel={affiliateOnly ? "programa de afiliados" : `plano · ${tenant?.planKey ?? "FREE"}`}
      userLabel={session.user.email ?? ""}
      userId={session.user.id}
      userEmail={session.user.email}
      userRole={session.user.role}
      signOutAction={signOutAction}
      usage={usage}
      banner={impersonating ? <ImpersonationBanner email={session.user.email ?? ""} /> : undefined}
    >
      {children}
    </PanelShell>
  );
}
