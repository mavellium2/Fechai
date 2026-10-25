import type { Metadata } from "next";
import { requireSuperadmin } from "@/lib/session";
import { signOut } from "@/auth";
import { PanelShell } from "@/components/shell/PanelShell";
import type { NavItem } from "@/components/shell/ShellNav";

const NAV: NavItem[] = [
  { href: "/admin/contas", label: "Contas", icon: "Building2" },
  { href: "/admin/relatorios", label: "Relatórios", icon: "BarChart3" },
  { href: "/admin/perguntas", label: "Perguntas", icon: "CircleHelp" },
  { href: "/admin/agentes", label: "Agentes", icon: "Bot" },
  { href: "/admin/logs", label: "Logs", icon: "ScrollText" },
  { href: "/admin/ia", label: "IA", icon: "Cpu" },
];

/** Painel restrito: nunca indexar. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

async function signOutAction() {
  "use server";
  await signOut({ redirectTo: "/login" });
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSuperadmin();

  return (
    <PanelShell
      navItems={NAV}
      brandHref="/admin/contas"
      brandSubtitle="painel do admin"
      footerLabel="acesso restrito"
      userLabel={`${session.user.email} · superadmin`}
      userId={session.user.id}
      userEmail={session.user.email}
      userRole={session.user.role}
      signOutAction={signOutAction}
      accent="signal"
    >
      {process.env.DATABASE_ENVIRONMENT === "test" && (
        <div role="status" className="mb-5 rounded-control border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
          Ambiente de testes — todas as alterações desta janela usam o banco isolado do laboratório.
        </div>
      )}
      {children}
    </PanelShell>
  );
}
