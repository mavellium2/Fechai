# satisfaction — Histórico

**Instrução:** Atualize aqui cada vez que mexer neste módulo.

### [2026-10-24] — Documentação inicial + MVP da pesquisa (card cmul846wk002t01jwjndtt8y7, PR #11)

**Arquivos:**
- `prisma/schema.prisma`: `SatisfactionSurveySettings`, `SatisfactionSurvey` (só tabelas novas)
- `satisfaction/*`, `workers/follow-up-worker/satisfaction.ts` (fila `satisfaction-surveys`), `scan.ts` (follow-up não sai depois da pesquisa)
- `whatsapp/meta.ts` (lista interativa), `meta-events.ts` (`list_reply`), `process-incoming.ts` (eco + captura)
- `relatorios/SatisfactionView.tsx`, `SurveySettingsForm.tsx`, `actions.ts`; `conversas/SurveyThreadCard.tsx`; `/inicio` (alerta)
- `reports/monthly-satisfaction.ts`, `monthly-data.ts`, `monthly-validate.ts`, `MonthlyReportDocument.tsx`

**Razão:** medir a satisfação do lead para melhorar o agente e mostrar qualidade no relatório mensal; economizar tokens em futuras sessões.

**Impacto:** `db push` + `generate` em web e worker; reiniciar o worker. P-88 (reativação) e aviso por grupo/e-mail ficam para depois.
