# Painel — contratos
- PanelShell mantém PostHog, UnsavedChangesProvider e ToastProvider.
- Temas light/dark: tenant claro, admin escuro por padrão. localStorage `fechai:{tenant|admin}-theme` e `fechai:{tenant|admin}-menu-expanded`; fallback em memória.
- `data-panel` identifica contexto; `data-surface` ativa tokens/variantes. Switch do tema à direita; sol/claro, lua/escuro; recolhido, ícone no thumb.
- AgentUsage: used, limit, remaining, canCreate (servidor). Só principal ligado atende WhatsApp.
- SandboxDraft: documentId/title/content/baseRevision; baseTitle/baseContent locais para diff. Rascunho em memória, sem mudar atendimento.
- SandboxInspection: sources(documentId/title/content/draft?), searched, instructions, tools; sem raciocínio interno.
- /api/sandbox expandida, sem nova tabela/worker. Overrides só em conversa isTest do tenant + dryRunScheduling.
