# campaign-override — Ações (scripts)

Não há Server Action: a escrita e a planilha saem de scripts (`npx tsx`).

## campanha-override.ts (escrita)
- **Assinatura:** `--tenant ID [--show | --create | --set-codes ... | --add-lead ID ...] [--actor USER] [--apply]`
- **Validação:** `--apply` exige `--actor`; `buildOverrideUpdate` junta os erros (listas não vazias, capacidade inteira ≥ 1, `--add-lead` só de lead da conta).
- **Fluxo:** conta e regra → monta a mudança → mostra antes/depois → sem `--apply`, para → `resolveScriptActor` → create/update → auditoria.
- **Autorização:** `--actor` é superadmin ou usuário do mesmo `tenantId`.
- **Auditoria:** `campaign_override.created` ou `.updated` (antes/depois sem dado de lead).

## campanha-implantes-reagendar.ts (leitura + auditoria)
- **Assinatura:** `--tenant ID [--out caminho] [--actor USER] [--no-audit]`
- **Fluxo:** `listRescheduleCandidates` → grava `.xlsx` (padrão `out/`, ignorado pelo git) → terminal mostra quantidade e caminho → auditoria `campaign_override.reschedule_list_generated` com `count`.
- **Autorização:** igual à acima; sem `--actor` a planilha sai sem registro.
- **Erro comum:** falha de banco lança e não gera planilha vazia.
