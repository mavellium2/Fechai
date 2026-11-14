# campaign-override — Histórico

**Instrução:** Atualize aqui cada vez que mexer neste módulo.

### [2026-11-13] — Agenda e lembretes da campanha de implantes (URG-02 e URG-03)

Cards cmwee3rdy003m01t8cgf0vhpr (URG-02) e cmwee3ro6003o01t8kk6xsfv5 (URG-03). Commits b7052ef, d0680da, bd3ff33, 2a19542, 8b5f42d. Sem schema nem env.

**Arquivos:**
- `agent.ts` (novo): campanha sintética da regra, recusa e frase do prompt
- `slot-lock.ts` (novo): trava de vaga por horário (`pg_advisory_xact_lock`)
- `clear-reminders.ts` (novo) + `scripts/campanha-implantes-lembretes.ts`: desliga lembretes das consultas já marcadas
- `lead.ts`: `getCampaignOverrideForLeadStrict` (lança em falha de banco)
- `reschedule-list.ts`: `--evento` (`inEvent`, coluna "O que fazer")
- `campaigns/active.ts`, `campaigns/slots.ts`, `campaigns/agent.ts`: regra como fallback sem `Campaign` real, recusa e transbordo sem vaga
- `scheduling/repository.ts`: `createAppointment` e `rescheduleAppointment` com trava, `reminderOverride = []` e sem espelho no Clinicorp
- `workers/follow-up-worker/clinicorp-reminders.ts`: consulta só do Clinicorp de lead da regra fica sem lembrete até 19/11
- `agent-engine/tools.ts`, `agent-engine/scheduling-tools.ts`: recusa com o outro dia; `transferToHuman` exportada
- `audit/events.ts`: `campaign_override.reminders_cleared` (só contagens)

**Razão:** lead da campanha só agenda 18 ou 19/11 às 09:00, com vaga por dia, sem lembrete e sem espelho no Clinicorp. Consultas já marcadas deixam de receber lembrete.

**Impacto:** agenda, prompt e lembretes consultam a regra para todo lead sem `Campaign` real; falha de leitura recusa a tool e o lembrete espera. Sem `capacityPerDay` a regra recusa e transfere. Some sozinho em 19/11 23:59:59 (-03:00), sem cron.

### [2026-11-13] — Documentação inicial + regra provisória (URG-01/URG-04, PR-1)

**Arquivos:** `schema.prisma` (`CampaignOverride`), `campaign-override/*`, `scripts/campanha-*.ts`, `audit/events.ts`, `tests/campanha-implantes-*`

**Razão:** economizar tokens em futuras sessões.

**Impacto:** só scripts; agente, agenda e lembretes entram no PR-2. `db push` + `generate` em web e worker.
