# Painel — contratos
Fontes: `shell/{PanelShell,TenantShell,TenantTheme}.tsx` em `src/components/`.

- `PanelShell.variant`: tenant/admin; mantém PostHog, UnsavedChangesProvider e ToastProvider.
- `TenantShell.context`: rotas fornecidas pelo layout; não concede acesso.
- Tema: light/dark; padrão tenant claro, admin escuro.
- localStorage: `fechai:{tenant|admin}-theme` e `fechai:{tenant|admin}-menu-expanded`; padrão do menu: tenant recolhido, admin expandido. Sem storage, fallback em memória.
- Raiz: `data-panel` identifica contexto; `data-surface` ativa cores e variantes `panel:`.
- Tema usa Switch (role=switch, aria-checked): sol no claro, lua no escuro; expandido, switch à direita; recolhido, ícone no thumb.
- `Switch.thumbContent?: ReactNode`: decoração opcional, sem mudar os controles existentes.
- `AgentUsage`: used, limit, remaining, canCreate; calculado no servidor.
- Nenhum schema, API, worker ou código de erro novo.
