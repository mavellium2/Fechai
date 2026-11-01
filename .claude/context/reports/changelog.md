# reports — Histórico

**Instrução:** Atualize aqui cada vez que mexer neste módulo.

### [2026-11-01] — Leads por anúncio no relatório mensal v2 (parte 04)

**Arquivos:**
- `monthly-campaigns.ts` (novo): `buildCampaigns`, bloco opcional `MonthlyReportData.campaigns`
- `monthly-data.ts`, `monthly-evidence.ts` (`evidence.campaigns`, só ids), `monthly.ts` (`MonthlyInput.campaigns` lido na mesma passada), `monthly-validate.ts` (`campaigns_sum`, `campaigns_scheduled`), `monthly-limitations.ts` (limitação `campaigns` com captura no meio do mês)
- `campaign-reports/queries.ts` e `summary.ts` (leitura e barras compartilhadas com a aba)
- `monthly-v2/MonthlyReportDocument.tsx` (parte 04) e a aba Campanhas

**Razão:** o relatório mensal não dizia de qual anúncio vinham os leads do mês. Mesmo recorte e regra da aba Campanhas, sem nova consulta.

**Impacto:** sem mudança de schema. Some quando não há captura ou lead de anúncio; snapshots anteriores não mudam. Não entra em receita, economia nem ROI.

### [2026-10-01] — Corrigir valor do lead versus criar nova vigência

**Motivo:** “Alterar valor” sempre criava uma vigência nova, deixando R$ 10,00
no período já iniciado e devolvendo uma mensagem de sucesso que parecia
impedir a edição.

**Alterações:** o modal começa com o valor exibido e separa correção da
vigência existente (padrão) de valor novo a partir de agora. A correção
preserva a data e recalcula todos os períodos que usam aquela linha; o efeito
é explicado antes de salvar. `FinancialSummary.valueId` identifica a vigência;
`saveLeadValue` usa tenant e update condicional por id/valor/data. Registra
auditoria antes/depois e não altera snapshots mensais aprovados. Inputs são
reiniciados com o valor exibido ao reabrir o modal. Sem alteração de schema.

**Validação:** testes de recálculo real por `computeFinancialSummary`, nova
vigência, isolamento do tenant, edição concorrente, sessão e limites do valor.

### [2026-10-01] — Erros do assistente de fechamento e chave financeira acessível

**Motivo:** a análise relia `FormData` após o await, quando o fieldset estava
desabilitado e os controles não eram serializados. A aprovação com cobertura
parcial devolvia erro genérico sobre requisitos da etapa 4.

**Alterações:** capturar o rascunho antes da chamada e preservá-lo na resposta
da IA e no recálculo; validação com nomes dos campos e etapas; requisitos
editoriais compartilhados por painel e servidor (`monthlyCloseProblems`),
listados antes da aprovação com retorno à etapa 4. Sem ajustes executados,
registrar explicitamente; não inventar melhorias para preencher o campo.
Chave de retorno estimado no topo do rascunho, com salvar também na etapa 5,
preservando premissas e snapshots aprovados. Tentativa de leitura do Clinicorp
na etapa 2 e orientação para conferir presenças na agenda; a causa da resposta
inválida da API não foi comprovada no ambiente local.

**Validação:** 98 arquivos / 1.459 testes passaram; TypeScript, lint e diff
check passaram. Sem alteração de schema nem validação em produção.

### [2026-10-01] — Iniciativa da conversa e conversão por contexto

**Motivo:** a Thalita aborda pacientes e contatos antigos; atendimento total
misturado à entrada nova fazia 15 agendados parecerem 15/300 em vez de 15/130.
Usuário confirmou que ainda não há marcação de origem de aquisição.

**Entrega:** classificador compartilhado por operacional/mensal, metadados do
primeiro autor no histórico e da borda do mês, grupos mutuamente exclusivos
(nova entrada, base que voltou, abordagem humana/agente, campanha, lembrete,
follow-up, continuidade, desconhecido). Cada taxa é contato convertido uma vez
÷ contatos do mesmo grupo, incluindo não respondidos. Avaliação sem vínculo
anterior na janela fica à parte. Motor congela totais e origem dos registros;
painel/PDF/CSV apresentam a separação e a abertura destaca novas entradas.
Validação recusa soma/taxa de contexto divergente ou atribuição de origem não
comprovada no resumo. Origem não registrada não vira tráfego pago/base qualificada;
leituras novas suspendem sugestão de anúncios sobre a população misturada.

**Instrumentação:** lembretes, campanhas e follow-ups novos registram finalidade
por id da mensagem em ReportEvent, sem schema novo, sem texto/paciente, sem
alterar envio/cota/atribuição e sem lançar. Histórico sem propósito não é
classificado por palpite. Sem publicação e sem acesso ao banco de produção.
Snapshots já aprovados exigem nova revisão para apresentar esta separação.

**Validação:** 98 arquivos / 1.454 testes passaram, incluindo o caso 300/130/15,
contagem única de pessoas, proativos sem resposta, continuidade na virada,
finalidade com id da operação, privacidade e registro que nunca lança.
TypeScript, lint e `git diff --check` passaram.

### [2026-10-01] — PDF: redirecionamento indevido para localhost

**Causa identificada:** o catch nas rotas de PDF admin/cliente montava o
redirecionamento absoluto com `request.url`, que atrás do proxy pode conter
`https://localhost:3000`. O navegador do usuário tentava abrir a própria máquina.

**Correção:** `monthlyPrintRedirect` retorna 303 com `Location` relativo,
`private, no-store` e `no-referrer`. Ambas as rotas usam o mesmo helper.
Preserva assinatura, competência, tenant, privilégio de rascunho e guardas de
snapshot. `PDF_BASE_URL` continua exclusivo do Chromium no servidor.

**Validação:** regressão das duas rotas com URL interna localhost e host
encaminhado diferente; o navegador resolve no domínio público atual. Token
validado para admin/cliente, sucesso continua PDF attachment e relatório sem
aprovação continua 404. Sem acesso ao servidor para identificar a falha original
do Chromium; o fallback errado foi corrigido no código, sem publicação.

### [2026-10-01] — Auditoria das métricas e cidades históricas

**Motivo:** o operacional do Instituto do Sorriso (setembro/2026) não refletia
as conversas observadas; cidade só tinha o registro novo da tool.

**Mudanças:** atividade por mensagens, atendimento e transbordo compartilhados
com o mensal v2, taxa de resposta real, contato único nos gráficos e autonomia,
agendamentos por criação, avaliação do agente pela mesma regra do mensal,
comparativo de mês inteiro por mês civil, exclusão de testes. Qualidade usa
contatos atendidos, incluindo antigos. Recuperação conservadora de declaração
literal de cidade no histórico, com lista IBGE e corte do período; leitura
paginada, nenhum GET grava, origem só por id/data no snapshot e na conferência.
CSV acompanha os rótulos e novos KPIs. Sem schema novo.

**Validação local:** 95 arquivos / 1.436 testes passaram; TypeScript, lint e
`git diff --check` passaram.

**Verificação de produção:** não executada: este workspace não tem acesso ao
banco. `scripts/audit-report-metrics.ts` faz a reconciliação só de leitura com
janela/fuso/agentes iguais e separa números ao vivo da versão aprovada. Não
houve alteração nem publicação no servidor. Snapshots já entregues continuam
congelados; atualização exige revisão e aprovação de nova versão.

### [2026-10-01] — Continuação do SDD: feriados do expediente humano

**Arquivos:** `monthly-config.ts` (`humanClosedDates`, `isHumanClosedDay`),
`monthly-operations.ts`, `MonthlyRoiEditor.tsx`, `MonthlyReportDocument.tsx`,
`MonthlyView.tsx`, `monthly-format.ts`, `monthly-pdf.ts`, `monthly-ai-tools.ts`,
`relatorio-mensal-feriados.test.ts`, testes de acesso, README e SDD.

**Razão:** dias sem recepção precisam classificar a chegada como fora do
expediente mesmo quando a grade semanal tem turno naquele dia.

**Impacto:** premissa em JSON, sem schema novo. Datas locais informadas pela
clínica, sem importação dos bloqueios do agente nem recorrência anual.
Snapshot aprovado continua preservado; chave ausente vira `[]`.

### [2026-10-01] — Continuação do SDD: registros dos indicadores v2

**Arquivos:** `monthly-v2-evidence.ts`, `monthly-v2/MonthlyReportEvidence.tsx`,
pages do cliente e do admin, `relatorio-mensal-v2-registros.test.ts`, README.

**Razão:** depois das fases 1–6, o Claude deixou a conferência dos registros
v2 pendente. Agora contatos, recepção e coorte abrem listas do snapshot com
a mesma população do motor v2, sem confundir com os indicadores antigos.

**Impacto:** sem schema novo. PDF continua sem registros individuais. Listas
limitadas avisam sobre cobertura; snapshots antigos preservam seu comportamento.

### [2026-10-01] — Relatório v2 usa a medição de quedas, as ações do mês anterior e os fatos do caso

**Arquivos:** `monthly-data.ts` (`buildMonthlyReportData(..., uptime)`, `MonthlyIncident` removido, `incidents` = `AvailabilityIncident[]`, `outage.endsAt` anulável); `monthly.ts` (`MonthlyInput.incidents` removido); `monthly-format.ts` (`problemText` de queda); `monthly-v2/MonthlyReportDocument.tsx` (bloco 03); fixture e testes `relatorio-mensal-v2-*`

**Razão:** a folha v2 não mostrava a disponibilidade (dependia de uma lista manual que ninguém preenchia) nem as ações do mês anterior e os fatos do caso, que já existiam no relatório.

**Impacto:** sem schema novo; a disponibilidade do v2 passa a ser a de `availabilityMetrics` (arredondada para baixo, parcial quando a medição começou no meio do mês); ação do mês anterior sem status não aparece no documento.

### [2026-10-01] — Modelo revisado: todos os leads, tudo que é mensurável

**Arquivos:** novos `monthly-operations.ts`, `monthly-previous-actions.ts`, `monthly-case.ts`, `monthly-document.ts`, `whatsapp/incidents.ts`; `monthly.ts` (recepção, chegadas, disponibilidade, agenda, `loadApprovedReport`, `loadMonthlyCaseFacts`), `monthly-executive.ts` e `monthly-pdf.ts` (reescritos), `monthly-quality.ts` (`showsSeal`, selos novos), `monthly-analysis.ts` (`monthlyAnalysisFacts`, `unbackedNumbers`), `monthly-time.ts` (`timeBreakdown`, `exactDateIn`), `lead-insights/summary.ts` (`notScheduled`); `actions.ts`, `MonthlyRoiEditor.tsx`, `MonthlyView.tsx`, `MonthlyEvidence.tsx`, rotas de PDF; `tests/relatorio-mensal-modelo-revisado.test.ts`

**Razão:** decisões do Vinícius (30/09): tudo que dá para medir aparece, todos os leads contam, regra conservadora só no retorno estimado.

**Impacto:** schema (`WhatsappIncident`, `Tenant.uptimeTrackedSince`, `MonthlyRoiReport.previousActions`/`caseFacts`) → `db push` + `generate` (web e worker); `hasUnplanned` e `UNPLANNED_ITEMS` removidos; `executiveSummary().unplanned` mudou de forma; fechar exige avaliar as ações do mês anterior e não exige mais texto na parte 05; disponibilidade só existe em meses medidos.

### [2026-10-01] — Decisor (dono) separado do contato operacional

**Arquivos:** `monthly-decision-maker.ts` (novo: `decisionMakerProblem`, `parseAccountOwners`, `ownersFromText`, `samePerson`); `monthly.ts` (`operationalContact?`); `actions.ts` (salvar/fechar/entrega); `MonthlyRoiEditor.tsx` (lista de donos, seletor do decisor, contato), `page.tsx` (`owners`); schema `Tenant.ownerNames`, `MonthlyRoiReport.operationalContact`; `tests/relatorio-mensal-access.test.ts`

**Razão:** o relatório saía endereçado à recepção (Instituto do Sorriso: "Thalita Santos"); ele é de quem decide a mensalidade.

**Impacto:** `db push` + `generate` (web e worker); `MonthlyCloseWizard` exige a prop `owners`; rascunho com decisor fora de `Tenant.ownerNames` não fecha nem registra envio; PDF inalterado.

### [2026-10-01] — Âncora na agenda e bloco financeiro opcional

**Arquivos:** `monthly-executive.ts` (novo); `monthly-config.ts` (`financialEnabled`); `monthly-pendencies.ts` (tópicos financeiros condicionais, `optional`); `monthly-overrides.ts`, `monthly-quality.ts`, `monthly-limitations.ts`, `monthly.ts` (mediana), `monthly-pdf.ts`, `monthly-analysis.ts`; `MonthlyView.tsx`, `MonthlyRoiEditor.tsx`, `MonthlyPendencyCenter.tsx`, `FinancialView.tsx`

**Razão:** página 1 abria com "ROI: Pendente"; o relatório passa a medir o que o Fechai controla.

**Impacto:** sem schema novo; relatório sem premissas financeiras fecha sem pendência; `MonthlyRoiSummary` perdeu `showMissing`.

### [2026-09-30] — PDF e painel: resumo executivo + análise detalhada

**Arquivos:** `monthly-pdf.ts` (reescrito: página 1 fixa, detalhe que flui); `monthly-next-actions.ts` (novo); `monthly.ts`, `monthly-ai.ts`, `monthly-analysis.ts` (`nextActions`); `MonthlyView.tsx` (`MonthlyRoiSummary` executivo); `MonthlyRoiEditor.tsx`, `actions.ts`; schema `MonthlyRoiReport.nextActions`

**Razão:** o decisor vê primeiro o valor entregue; o técnico fica para consulta.

**Impacto:** PDF deixa de ter uma página; `db push` + `generate`; `highlights` = "Resumo do período" (600).

### [2026-09-30] — Assistente de IA com ferramentas de leitura

**Arquivos:** `monthly-ai-tools.ts` (novo); `monthly-ai-service.ts` (laço de ferramentas, `MonthlyAiAnswer`); `monthly-ai.ts` (`proposal`); `monthly-ai-chat.ts` (`consulted`, `review`); `monthly-evidence.ts` (`kind` do agendamento); `ai-actions.ts`; `MonthlyRoiAiAssistant.tsx`; `tests/relatorio-mensal-ai-tools.test.ts`

**Razão:** a IA explicava números só pelo resumo; agora consulta os registros e mostra as evidências.

**Impacto:** sem schema novo; `answerMonthlyAi(messages, draft, toolbox?)` devolve `consulted` sempre.

### [2026-09-30] — Assistente de fechamento em 5 etapas + fechar com cobertura parcial

**Arquivos:**
- `monthly-limitations.ts`, `monthly-analysis.ts` (novos); `monthly.ts` (`limitations`, `highlights`, `limitationsNote`); `monthly-quality.ts` ("Não verificado", `QUALITY_KEY_LABEL`); `monthly-pdf.ts`; `monthly-ai(-service).ts`; `monthly-time.ts` (`reviewTextProblem`)
- `admin/relatorios/[tenantId]/MonthlyRoiEditor.tsx` (`MonthlyCloseWizard`), `actions.ts`, `ai-actions.ts`, `page.tsx`, `pdf/route.ts`; `relatorios/MonthlyView.tsx`
- Schema: `MonthlyRoiReport.highlights`, `limitationsNote`; testes `relatorio-mensal-fechamento.test.ts`

**Razão:** fluxo guiado em vez de todos os campos de uma vez; fechar sem todos os dados, com limitações explícitas.

**Impacto:** `finalizeMonthlyRoi` recebe `string[]`; `db push` + `generate`; snapshots antigos sem `limitations` caem no `missing`.

### [2026-09-30] — Documentação inicial + origem e selo de qualidade de cada número

**Arquivos:**
- `monthly-evidence.ts`, `monthly-quality.ts` (novos); `monthly.ts` (`evaluateMonthlyMetrics`, `evidence`/`quality` no relatório); `monthly-time.ts` (sink de mensagens); `monthly-pdf.ts` (coluna Qualidade, legenda no rodapé)
- `relatorios/MonthlyEvidence.tsx`, `EvidenceDialog.tsx`, `MonthlyView.tsx`; `ui/modal.tsx` (`size="full"`), `ui/stat.tsx` (`footer`)
- `lead-insights/queries.ts` (`loadLeadQualityDetail`); `tests/relatorio-mensal-registros.test.ts`

**Razão:** "10 agendamentos" com 1 sem horário e 8 sem tipo, sem evidência da composição.

**Impacto:** sem schema novo; snapshots antigos sem `evidence`/`quality` escondem selo e registros.
