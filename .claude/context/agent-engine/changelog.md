# Agent-engine — Histórico

Atualize a cada mudança no módulo.

### 2026-10-24 — Simulação da agenda no chat de teste

Arquivos: `orchestrator.ts` (`dryRunScheduling` → `ToolContext.dryRun`), `tools.ts`,
`scheduling-tools.ts`, `app/api/sandbox/route.ts`, `app/(dashboard)/conversas/actions.ts`,
`tests/agendamento-simulacao.test.ts`. Card cmvml66yp000m01nx96cjcq4h, commit 09d465b.
Razão: o teste marcava consulta de verdade e espelhava no Clinicorp/Google/iCloud.
Impacto: no sandbox, marcar/remarcar/cancelar só valida e devolve "Simulação: ..."; WhatsApp
e widget seguem gravando. Sem schema, env ou flag. Detalhe: README, "O teste não ocupa a agenda real".

### 2026-09-30 — Datas relativas

Arquivos: `time-context.ts`, `orchestrator.ts`, `scheduling-tools.ts`, `follow-up/compose.ts`.
Razão: repetiu "amanhã às 10:45" do lembrete no dia da consulta.
Impacto: data de agora em todo turno; consulta com dia relativo; sem schema.

### 2026-09-30 — Documentação inicial
