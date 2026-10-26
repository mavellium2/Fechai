"use client";

import { useEffect, useRef } from "react";
import posthog from "posthog-js";
import { type NavItem } from "./ShellNav";
import { type UsageNavData } from "./UsageNav";
import { UnsavedChangesProvider } from "@/components/ui/unsaved-changes";
import { ToastProvider } from "@/components/ui/toast";
import { TenantShell } from "./TenantShell";
import { TenantThemeProvider } from "./TenantTheme";

/**
 * Casca comum do tenant e do admin: navegação animada e superfícies controladas
 * pelo provider. Cada contexto tem sua preferência local de tema e menu.
 * Identidade do PostHog, proteção de rascunhos e toasts permanecem compartilhados.
 */
export function PanelShell({
  navItems,
  brandHref,
  brandSubtitle,
  footerLabel,
  userLabel,
  userId,
  userEmail,
  userRole,
  signOutAction,
  usage,
  banner,
  variant = "admin",
  children,
}: {
  navItems: NavItem[];
  brandHref: string;
  /** Linha sob o wordmark (nome do tenant, "painel do admin"). */
  brandSubtitle: string;
  /** Rodapé da barra lateral (plano atual, "acesso restrito"). */
  footerLabel: string;
  userLabel: string;
  userId: string;
  userEmail?: string | null;
  userRole: string;
  signOutAction: () => Promise<void>;
  /** Uso de conversas do mês, mostrado na navegação (link para /configuracoes). */
  usage?: UsageNavData | null;
  accent?: "iris" | "signal";
  /** Aviso global fixo acima do cabeçalho (ex.: personificação em andamento). */
  banner?: React.ReactNode;
  variant?: "admin" | "tenant";
  children: React.ReactNode;
}) {
  const identifiedUserId = useRef<string | null>(null);

  useEffect(() => {
    if (!userId || identifiedUserId.current === userId) return;

    // A direct switch (such as superadmin impersonation) must not merge two
    // known people. An anonymous visitor is deliberately kept so identify()
    // can merge their pre-login activity into this account.
    const hasDifferentPersistedIdentity =
      identifiedUserId.current === null &&
      posthog.get_property("$user_state") === "identified" &&
      posthog.get_distinct_id() !== userId;

    if (identifiedUserId.current !== null || hasDifferentPersistedIdentity) {
      posthog.reset();
    }

    posthog.identify(userId, {
      ...(userEmail ? { email: userEmail } : {}),
      role: userRole,
    });
    identifiedUserId.current = userId;
  }, [userEmail, userId, userRole]);

  function handleSignOut() {
    posthog.reset();
  }

  return (
    <UnsavedChangesProvider>
      <TenantThemeProvider scope={variant}>
        <ToastProvider>
          <TenantShell context={variant} navItems={navItems} brandHref={brandHref} brandSubtitle={brandSubtitle}
            footerLabel={footerLabel} userLabel={userLabel} usage={usage}
            signOutAction={signOutAction} onSignOut={handleSignOut} banner={banner}>
            {children}
          </TenantShell>
        </ToastProvider>
      </TenantThemeProvider>
    </UnsavedChangesProvider>
  );
}
