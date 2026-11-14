# campaign-override — Ações (scripts e efeitos na agenda)

Não há Server Action deste módulo: a escrita sai de scripts (`npx tsx`) e a agenda chama as funções de `scheduling/repository.ts`.

## campanha-override.ts (escrita da regra)
- **Assinatura:** `--tenant ID [--show | --create | --set-codes ... | --set-capacity N | --set-offer TEXTO | --add-lead ID ...] [--actor USER] [--apply]`
- **Validação:** `--apply` exige `--actor`; `buildOverrideUpdate` junta os erros (listas, capacidade inteira ≥ 1, `--add-lead` só de lead da conta).
- **Fluxo:** conta e regra → mudança → antes/depois → sem `--apply`, para → `resolveScriptActor` → create/update → auditoria.
- **Autorização:** `--actor` é superadmin ou usuário do mesmo `tenantId`.
- **Auditoria:** `campaign_override.created` ou `.updated` (sem dado de lead).

## campanha-implantes-lembretes.ts → clearCampaignReminders (URG-03)
- **Assinatura:** `--tenant ID [--apply --actor USER]`
- **Fluxo:** consultas futuras de leads da regra, até `endsAt` → `reminderOverride = []` (as que ainda não são `[]`) e `ReminderDispatch` `queued` → `skipped` ("campanha implantes") → auditoria `campaign_override.reminders_cleared` com contagens.
- **Autorização:** ator inválido recusa antes de tocar em linha. Sem `--apply` só simula.

## campanha-implantes-reagendar.ts (leitura + auditoria)
- **Assinatura:** `--tenant ID [--out caminho] [--actor USER] [--no-audit] [--evento]`
- **Fluxo:** `listRescheduleCandidates` → grava `.xlsx` (padrão `out/`, ignorado pelo git) → terminal mostra quantidade e caminho → auditoria `campaign_override.reschedule_list_generated` com `count`. `--evento` inclui também as consultas do encaixe (coluna "O que fazer": "Lançar no Clinicorp" ou "Reagendar").
- **Autorização:** igual à acima; sem `--actor` a planilha sai sem registro.
- **Erro comum:** falha de banco lança e não gera planilha vazia.

## createAppointment (`scheduling/repository.ts`)
- **Fluxo:** fora de `source: "manual"`, checa a regra; vaga da regra → `withOverrideSlotLock`, `reminderOverride = []` (fica), Clinicorp `skipped`. Marcação manual: `[]` só até 19/11 23:59:59.

## rescheduleAppointment (`scheduling/repository.ts`)
- **Fluxo:** `checkCampaignSlot` na troca; vaga da regra → lock e `[]`; Clinicorp: a antiga sai, a nova fica `skipped`. Recusa devolve `campaign_rule` com `full`.

## Tools da agenda (`list_available_slots`, `schedule_meeting`, `reschedule_meeting`)
- **Recusa:** `campaignRefusalReply` — lotado com o outro dia livre, devolve as vagas do outro dia; sem vaga em nenhum dos dois, `transferToHuman` (não roda na simulação `dryRun`).
- **Erro comum:** leitura da regra falha → tool devolve `Falha ao executar <tool>.`; nada é gravado.

## Envio manual pela /agenda (`reminders.ts`, com `target`)
- **Consulta local com `reminderOverride = []`:** envio e marcação manual não saem (`remindersFor` devolve `[]`); a recepção confirma por fora. Consulta só do Clinicorp passa (o manual pula a checagem da campanha).
