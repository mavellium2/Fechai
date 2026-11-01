# Módulo: reports

> Para a seção completa (página, componentes, regras, armadilhas e como estender), ver
> [`src/app/(dashboard)/relatorios/README.md`](../../app/(dashboard)/relatorios/README.md).

## O que faz

Calcula as métricas do tenant para `/relatorios` e a home. As consultas de
indicadores filtram por `tenantId` e por `isTest: false` (o sandbox não pode
inflar os números). No ROI mensal, também registra eventos operacionais e
apoia a revisão administrativa, com correções, fechamento em snapshot e
controle de publicação.

## Arquivos

- `monthly-config.ts`, `monthly.ts`, `monthly-pdf.ts`, `events.ts`: ROI mensal
  odontológico P-79, separado do Financeiro legado. Premissas mensais revisadas
  pelo superadmin, comparecimento confirmado, receita apenas da chegada fora
  do horário humano, economia estimada declarada, fechamento em snapshot e
  PDF A4 no modelo revisado (todos os contatos contam; a receita conservadora
  vale só no bloco opcional de retorno estimado). Contrato: [`docs/P-79-relatorio-mensal-roi.md`](../../../docs/P-79-relatorio-mensal-roi.md).
- `monthly.ts` também recebe `gaps` (perguntas da fila P-87 aprovadas na
  janela: `agentId`, `firstAskedAt`, `answeredAt`) e calcula
  `gapsAnswered`/`gapAnswerSeconds` no mês da aprovação, no escopo de agentes.
  Não são corrigíveis em `metricOverrides`. Ver
  [`knowledge-gaps/README.md`](../knowledge-gaps/README.md).
- `monthly.ts` também carrega `leadQuality` (qualidade dos leads do mês, de
  `modules/lead-insights`, congelada no snapshot; opcional em fechamentos
  antigos). O PDF inclui o bloco na análise detalhada só quando `leadQuality.leads > 0`.
  Ver [`lead-insights/README.md`](../lead-insights/README.md).
- `monthly-campaigns.ts`: bloco opcional **Leads por anúncio** (`MonthlyReportData.campaigns?`,
  parte 04 do documento). Puro sobre `MonthlyInput.campaigns`, lido por
  `loadCampaignRows`/`loadCampaignTrackedSince` (`campaign-reports/queries.ts`) no escopo de
  agentes da revisão. Só ids na evidência (`evidence.campaigns`); some sem captura no mês ou
  sem lead de anúncio. Validador `campaigns_sum`/`campaigns_scheduled` em `monthly-validate.ts`;
  limitação `campaigns` quando a captura começou no meio do mês. Ver
  [`campaign-reports/README.md`](../campaign-reports/README.md).
- `monthly-evidence.ts` e `monthly-quality.ts`: os registros por trás de cada
  número e o selo de qualidade de cada indicador — ver "Registros e selo de
  qualidade" no [README da seção](../../app/(dashboard)/relatorios/README.md).
- `monthly-executive.ts`: o conteúdo que o decisor lê (PDF e topo do painel) —
  `executiveSummary` (frase do mês, 4 números, as 6 partes e as tabelas),
  `monthlyIncidents` (faltas, quedas e espera da recepção: os incidentes
  comprovados de "O que não saiu como planejado"), `NO_INCIDENT` e
  `monthlyFinancial` (única porta do bloco financeiro opcional). Nada é escrito por IA.
- `monthly-operations.ts`: puro. Recepção (`ReceptionMetrics`), chegada pelo
  expediente cadastrado (`arrivalSlot`, nunca faixa fixa) e disponibilidade do
  agente (`availabilityMetrics`; sem medição é `null`, nunca 100%).
- `monthly-previous-actions.ts`: ações do relatório anterior aprovado com status
  (funcionou / parcial / não funcionou) e o número que comprova; fechar exige os dois.
- `monthly-case.ts`: fatos do caso do mês (idade, áudios, dia da semana, período,
  se agendou). Duração, dia e período vêm de `loadMonthlyCaseFacts` (`monthly.ts`),
  nunca do formulário.
- `monthly-document.ts`: `approvedDocument` — a fronteira do que entra no PDF
  (só conteúdo aprovado; registros, correções e notas internas ficam de fora) e
  a descrição da cadeia motor de dados → IA redige → PDF aprovado e versionado.
- `monthly-next-actions.ts`: até 3 próximas ações `{ action, owner, indicator }`
  (`parseNextActions` nunca lança; `hasNextPlan` aceita o `nextMonth` antigo).
  Voltam no relatório seguinte como ações do mês anterior.
- `monthly-limitations.ts`: limitações do fechamento (pendências + cobertura),
  indicadores não verificados e a impressão digital que o fechamento confere.
  Fechar com cobertura parcial exige confirmar a lista exata.
- `monthly-analysis.ts`: etapa 4 do assistente de fechamento — prompt da
  análise (resumo do período, limitações, melhorias, até 3 próximas ações), parse e travas
  deterministas. A IA só redige: recebe as frases e tabelas já validadas
  (`monthlyAnalysisFacts`), não inventa incidente e tem os números conferidos
  contra os fatos (`unbackedNumbers`); `draftMonthlyAnalysis` em `monthly-ai-service.ts` percorre a
  cadeia de IA.
- `monthly-overrides.ts`: valida `assumptions.metricOverrides` para o mês e o
  comparativo, aplica correções manuais e recalcula receita/economia/ROI.
  Correções não são herdadas ao copiar premissas para outro mês.
- `monthly-publication.ts`: lista apenas competências `ready` com snapshot;
  resolve a competência pedida ou a última publicação para o tenant.
- `monthly-import.ts`: mensalidade atual da conta (override/plano), competência
  inicial limitada ao cadastro e sugestão dos horários cadastrados nos agentes.
  O escopo em `assumptions.agentIds` vale para o mês e o comparativo; seleção
  ausente/vazia significa toda a conta. A grade só classifica horários depois
  de conferida como expediente humano.
- `monthly-ai.ts`: contrato de pergunta/resposta do assistente, lista de
  campos permitidos, limites e mesclagem de sugestões na revisão não salva.
- `monthly-ai-service.ts`: contexto com agregados/premissas e chamada da
  cadeia de IA configurada, com fallback, registro de tokens, laço de
  ferramentas e cancelamento (60 s; 90 s com ferramentas). Não altera o relatório.
- `monthly-ai-tools.ts`: ferramentas só de leitura do assistente sobre
  `report.evidence`, a linha do tempo de uma conversa do mês, a configuração e
  as integrações; anota as evidências consultadas e monta a lista de
  conferência proposta. Sem texto de conversa nem dado de paciente.

- `service.ts`:
  - `computeTenantReport(tenantId)` — totais desde o início da conta (legado).
  - `computeHomeSummary(tenantId, days)` — resumo da home com janela e comparação com o período anterior.
  - `resolveRange(period, de?, ate?)` — resolve a janela a partir da querystring (`?periodo=` ou `?de=&ate=`); devolve também a janela anterior (deltas) e a granularidade dos gráficos (`hora`/`dia`/`mes`).
  - `computePeriodReport(tenantId, range)` — KPIs com delta, séries de fluxo (recebidas × enviadas), resultados (leads × agendamentos), comparações IA × humano (`attendance`: contatos só com resposta da IA × com resposta humana; `closed`: agendamentos por `Appointment.source` agent × manual) e distribuições (por agente e por status).
  - `computeFinancialSummary(tenantId, range)` — visão Financeira: retorno estimado (agendamentos do período × valor por lead), investido (preço do plano atual × meses cobertos pela janela) e ROI. O valor por lead vem de `TenantLeadValue` (entradas com vigência: cada janela usa o valor em vigor no início dela — mudar o número não recalcula períodos passados).

## Contratos expostos

```ts
computeTenantReport(tenantId): Promise<TenantReport>
computeHomeSummary(tenantId, days): Promise<HomeSummary>
resolveRange(period, de?, ate?): ReportRange
computePeriodReport(tenantId, range): Promise<PeriodReport>
computeFinancialSummary(tenantId, range): Promise<FinancialSummary>
```

## O que NÃO faz

- Operacional e Financeiro recalculam a cada carga da página. O ROI mensal
  fechado usa o snapshot; não recalcula o histórico nem consulta Clinicorp
  para exibir ou exportar uma publicação.
- A visão Financeira é estimativa: não há histórico de assinatura no modelo (o investido presume o plano atual por todo o período) nem valor de lead automático.
- Gráficos são componentes locais em `/relatorios` (SVG/divs, sem biblioteca de charts).
- Leads por anúncio (`MonthlyReportData.campaigns`) não mede custo por lead nem entra em receita, economia ou ROI: o Fechai não conhece a verba da campanha.
