# reports — Relatórios (Operacional, Financeiro, ROI mensal)

Métricas do tenant para `/relatorios`, a home e o ROI mensal revisado pela Mavellium (snapshot + PDF). Código: `src/modules/reports/`.

| Aspecto | Onde |
| --- | --- |
| Domain | `monthly.ts` (tipos), `monthly-config.ts`, `monthly-evidence.ts`, `monthly-quality.ts`, `monthly-pendencies.ts`, `monthly-limitations.ts`, `monthly-analysis.ts`, `monthly-executive.ts`, `monthly-decision-maker.ts` → [domain.md](domain.md) |
| Actions (escrita) | `admin/relatorios/[tenantId]/actions.ts`, `ai-actions.ts`, `relatorios/actions.ts`, `events.ts` → [actions.md](actions.md) |
| Queries (leitura) | `service.ts`, `monthly.ts`, `monthly-publication.ts`, `origin-hours.ts` → [queries.md](queries.md) |
| Copy-paste | [patterns.md](patterns.md) · Histórico: [changelog.md](changelog.md) |

Para usar, saiba:
- [ ] Toda métrica filtra `tenantId` e `isTest: false`; dinheiro em centavos (`formatBRL`); fuso via `scheduling/time.ts`.
- [ ] ROI mensal fechado = **snapshot**; nunca recalcula nem consulta Clinicorp para exibir/exportar.
- [ ] Cada número do ROI mensal tem **registros** (`evidence`) e **selo** (`quality`), da mesma passada do cálculo.
- [ ] `missing` e as limitações só saem de `detectMonthlyPendencies`; receita/economia/ROI nunca são editados, só derivados.
- [ ] Fecha com **cobertura parcial**: pendência não trava, vira limitação confirmada pela lista exata (`limitationFingerprint`); número sem evidência fica `null` = "Não verificado".
- [ ] Assistente de IA investiga registros por ferramentas só de leitura (`monthly-ai-tools.ts`); evidências anotadas pelo servidor; lista só com confirmação.
- [ ] Admin fecha pelo assistente de 5 etapas (`MonthlyCloseWizard`): um formulário só, etapa guardada fora do editor.
- [ ] Decisor = dono/sócio em `Tenant.ownerNames` (nunca `User.role = OWNER`, que é o login da recepção) e ≠ contato operacional; regra única `decisionMakerProblem` (`monthly-decision-maker.ts`).
- [ ] Mede o que o Fechai controla; âncora = avaliações agendadas e realizadas. Receita/economia/ROI são opcionais: só por `monthlyFinancial()`; sem ele o bloco some (nunca "Pendente").
- [ ] Modelo revisado: todos os contatos contam (expediente é detalhe); regra conservadora só no retorno estimado; selo "estimativa" só no estimado.
- [ ] Cadeia: motor de dados valida → IA só redige (`monthlyAnalysisFacts`, `unbackedNumbers`) → PDF só do aprovado e versionado (`approvedDocument`, `loadApprovedReport`).
- [ ] PDF/painel = `executiveSummary()`: 4 números + partes 01–06; a 05 aparece sempre e, sem incidente comprovado, diz `NO_INCIDENT`. O PDF inteiro flui.
- [ ] Recepção, disponibilidade (`WhatsappIncident`; sem medição = não medido), chegadas pelo expediente, ações do mês anterior e fatos do caso: ver [domain.md](domain.md).
- [ ] Guias: `src/app/(dashboard)/relatorios/README.md`, `src/modules/reports/README.md`, `docs/resultados/relatorio-mensal/P-79-relatorio-mensal-roi.md`.
