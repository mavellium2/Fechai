# Seção: /relatorios (painel de relatórios + visão Financeira)

Guia para qualquer agente/pessoa dar prosseguimento nesta seção. Cobre **o que existe, as regras de cálculo, os arquivos, as armadilhas** e **como estender** — leia inteiro antes de mexer.

## Visão geral

### Qualidade dos leads (`?visao=leads`)

Quinta visão, com o seletor de período das visões Operacional/Financeira:
`LeadQualityView` mostra leads, % que informou a cidade, % fora do raio,
cidades, primeiras dúvidas, motivos de perda e resultado, com as melhorias
sugeridas para o tráfego. Os números vêm de `loadLeadQuality`
(`modules/lead-insights`) — regras, cobertura e limites em
[`lead-insights/README.md`](../../../modules/lead-insights/README.md). O mesmo
resumo entra no relatório mensal (bloco + 2ª página do PDF).

### Satisfação (`?visao=satisfacao`, rótulo "Satisfação")

Visão da pesquisa de satisfação pós-conversa (`SatisfactionView`): a
configuração (ligar, espera, faixa de horas, textos e "enviar teste") fica no
topo, depois nota média, distribuição, pontos de melhoria e a lista de
respostas (com filtro por nota e agente, link para a conversa, correção do
motivo e "marcar como revisada"). Regras, fluxo e exclusões em
[`satisfaction/README.md`](../../../modules/satisfaction/README.md). Mesmo seletor
de período das outras visões; `nota` e `agente` filtram só a lista. Notas 1 e 2
sem revisão também aparecem como alerta no `/inicio`.

**No relatório mensal** a satisfação é `MonthlyReportData.satisfaction?`
(`monthly-satisfaction.ts`, montada na mesma passada de `evaluateMonthlyMetrics`):
`sent`, `answered`, `responseRatePercent`, `average` (1 casa), `distribution`
(soma = `answered`), `improvementTopics` (top 3 por contagem, só chaves de
`SURVEY_TOPICS`) e `unclassified` (comentários ainda sem motivo, à parte).
Coorte: **nota pelo mês da nota** (`ratedAt`), envio pelo mês do envio, testes
fora, escopo de agentes da revisão. É **opcional**: sem envio nem resposta no mês,
ou em snapshot anterior à pesquisa, o campo não existe e o bloco some. O
validador bloqueia o fechamento quando a distribuição não soma as respostas, a
média não bate com ela ou o top 3 tem chave fora do conjunto fechado. Aparece no
documento (painel e PDF) como sub-bloco de **01 Atendimento** — as seis partes e a
ordem não mudam — e a média só com 5 ou mais respostas ("amostra pequena" antes
disso). A IA recebe só números e rótulos (`monthlyAnalysisFacts`). **O texto do
comentário nunca entra** em `data`, evidência, ferramentas da IA ou PDF
(`loadMonthlySurveys` o reduz a um booleano no limite da consulta). Testes:
`tests/pesquisa-satisfacao-relatorio.test.ts`.

### Relatório mensal v2 (`?visao=mensal`, rótulo "Relatório mensal")

**Contexto de entrada e conversão (01/10/2026).** Atendimento total não é
aquisição. `contact-context.ts` monta `service.contexts` dentro do motor e
`evidence.contexts` na mesma passada. O operacional usa o mesmo classificador.
Uma linha por contato com atividade, inclusive abordagem sem resposta:

- nova entrada: primeira mensagem do mês é do contato, primeira mensagem
  registrada também é dele e é do mês; contato criado anteriormente não é novo;
- contato antigo que voltou a escrever; abordagem iniciada pela equipe ou pelo
  agente; campanha, lembrete ou follow-up somente com finalidade registrada;
- continuidade: houve mensagem antes da borda do mês e a primeira deste mês
  ocorre até 24h depois, sem operação explícita de campanha/lembrete/follow-up;
- histórico insuficiente ou envio sem autoria/finalidade: não identificado.

`loadConversationStarts` busca início e borda pelo histórico, só id/data/papel,
com exclusão de teste e tenant. “Iniciou no período” é distinto do primeiro
autor no histórico, também preservado na evidência. Contexto é o da **primeira
atividade do contato no período**, não uma contagem de cada sessão ou intenção
que mudou depois. Não se interpreta texto privado para presumir origem.

Conversão por grupo = **contatos que agendaram / contatos do próprio grupo**,
incluindo quem não respondeu. Duas avaliações da mesma pessoa continuam um
convertido. Avaliações são do agente, criadas no período, sem canceladas, e
precisam estar ligadas à entrada anterior do contato na janela; sem vínculo
ficam no total de agenda, à parte das taxas. É vínculo de população observada,
não uma prova de causalidade de anúncio ou campanha. Os grupos atendidos somam
o atendimento; todos os grupos de atividade incluem também proativos não
respondidos, por isso podem superar o total atendido. Validar somas e taxas
antes de fechar (`contexts_sum`); resumo com taxa fora das bases calculadas ou
origem presumida é recusado. Não há taxa geral 15/300 apresentada como conversão
de 130 novas entradas. Exemplo testado: 15/130 = 11,5%, com 300 atendidos totais.

Origem de aquisição **não registrada**: sem marcação, nenhum contato é chamado
de tráfego pago e contato antigo não é chamado de base qualificada. Leituras
novas não produzem recomendações de anúncios a partir dessa população misturada.
Regra pura de sugestões continua disponível para fontes antigas; snapshots
aprovados permanecem congelados. Painel/PDF apresentam a tabela por contexto;
snapshot anterior sem `service.contexts` mantém o documento antigo até revisão.

Operações novas registram `ReportEvent.kind = contact_reminder | contact_campaign
| contact_followup`, ligados ao id da mensagem enviada, idempotentes e best-effort
(`contact-context-events.ts`). Nenhuma mudança de schema: `kind` já é string.
Isso não altera envio, cota, lembretes nem atribuição de resultado em Disparos.
Finalidades de abordagem manual, tráfego pago e base qualificada ainda dependem
de marcação explícita; não são recuperadas por palpite no histórico.

Mede o que o Fechai controla: atendimento, agendamento e comparecimento. A
âncora é **avaliações agendadas e realizadas**; todos os contatos entram, dentro
e fora do expediente, e o financeiro é um bloco opcional. Três camadas, nesta
ordem: **o motor calcula e valida → a IA só redige a partir dos números
validados → painel e PDF só apresentam o snapshot**. Nenhum número nasce em
componente, prompt ou gerador de PDF.

- **Contrato** (`modules/reports/monthly-data.ts`): `MonthlyReportData`, em
  `MonthlyReport.data`. Cada número é um `Metric { value, status, source }`;
  status `measured`, `confirmed`, `estimated`, `partial`, `unverified` ou
  `unavailable` (a linha some). Montado dentro de `evaluateMonthlyMetrics`
  (mesma entrada, nenhuma consulta nova) e congelado no snapshot. **Snapshot
  sem `data` é mês fechado antes da v2 e segue na visão antiga** (`MonthlyView`
  + `monthly-pdf.ts`); não remova a visão antiga sem migrar esses meses.
- **Definições.** *Contato atendido*: escreveu no mês e recebeu resposta (IA ou
  equipe) depois disso; a unidade é o contato, não a conversa respondida pelo
  agente nem o lead criado (era a origem do "117 × 277"). *Expediente × fora*:
  pela primeira mensagem do contato no mês, contra o expediente cadastrado;
  sem expediente só o total aparece. *Transferidas*: mensagem da equipe depois
  da primeira mensagem do contato, **ou** evento de transbordo; *só agente* é
  `contatos − transferidas`. *1ª resposta do agente*: mediana, só quando a
  primeira resposta foi da IA. *Recepção*: do transbordo (sem evento, da última
  mensagem do contato) à primeira mensagem da equipe. *Tempo de texto*:
  mensagens de texto × `secondsPerMessage` (padrão 30), sempre `estimated`.
  *Coorte*: avaliações do agente **criadas** no mês, cada uma `attended`,
  `no_show`, `upcoming` ou `unverified`; consulta passada sem status mapeado é
  não verificada, **nunca falta**. A falta do Clinicorp vem de
  `assumptions.noShowStatusTypes`. Criadas antes e realizadas no mês vão numa
  linha à parte, fora da taxa. *Motivo principal*: um por contato que não
  agendou (`lossKeyOf`); sem motivo registrado cai em "Outros", para a soma
  fechar em `contatos − agendaram`. *Comparativo*: só com o mês anterior
  inteiro medido; senão `comparison = null` e a coluna some.
- **Retorno estimado** (`estimatedReturn`): `null` sem expediente, mensalidade,
  custo da equipe ou ticket/conversão. Nulo, o bloco não é renderizado: nada
  de "pendente", zero ou convite. A receita só de quem chegou com a recepção
  fechada vale **apenas** aqui. Não é a visão Financeira (`computeFinancialSummary`),
  que segue com a própria regra; unificar as duas é decisão futura.
- **Validador** (`monthly-validate.ts`). Bloqueiam o fechamento: só agente +
  transferidas ≠ contatos; coorte que não soma; expediente + fora ≠ total;
  motivos ≠ contatos − agendaram; decisor ausente ou igual ao contato
  operacional; resumo com número fora dos dados; texto com data completa.
  Avisos (não bloqueiam, viram tópico da central): qualificados < agendados,
  equipe respondeu sem transbordo registrado, mediana do agente > 300 s,
  cidade em menos de 50% dos contatos, comparecimento não verificado,
  expediente não cadastrado. Ticket, conversão e custo da equipe não são
  pendência: na central aparecem como "Opcional · ativa o retorno estimado".
- **Documento** (`monthly-v2/MonthlyReportDocument.tsx`): a folha que o decisor
  recebe, igual no painel e no PDF. Sem cálculo, sem componente de admin e sem
  variante `panel:` (a folha é sempre clara). Textos fixos e formatos em
  `monthly-format.ts`.
- **PDF** (`monthly-print.ts`): o Chromium do servidor abre
  `/imprimir/relatorio-mensal?token=…` e imprime em A4. O token
  (`lib/print-token.ts`) é assinado pela rota de PDF depois de conferir a
  sessão e vale 5 minutos. Precisa de `chromium` na imagem (`CHROMIUM_PATH`,
  `PDF_BASE_URL`); sem navegador, a rota redireciona para a página de
  impressão. Esse fallback usa `Location` **relativo** (`monthlyPrintRedirect`):
  permanece no domínio aberto pelo usuário, mesmo quando `request.url` chega
  como `https://localhost:3000` atrás do proxy. `PDF_BASE_URL` é exclusivamente
  o endereço que o Chromium alcança dentro do servidor, nunca um link para o
  cliente. Redirecionamento é privado, sem cache e sem referer. O fallback
  significa que a geração no servidor falhou; confira o log `[monthly] impressão
  do PDF falhou` e a instalação/configuração do Chromium. Corrigir o endereço
  do fallback não confirma a causa dessa falha. Arquivo:
  `fechai-relatorio-{clínica}-{YYYY-MM}-v{versão}.pdf`.
- **Decisor** é o dono ou sócio (`decisionMakerRole`); a recepção é
  `operationalContact`, em cópia. **Mudanças no agente** são lista estruturada
  (`agentChanges`, `monthly-agent-changes.ts`).
- **Versões**: cada fechamento grava `MonthlyRoiReportVersion` (snapshot +
  hash) e sobe `MonthlyRoiReport.version`; reabrir não apaga o entregue.
- **Guardas da IA** (`monthly-text-guard.ts`): todo número do resumo precisa
  existir em `data` ("9h40", "78%", "R$ 8.960"); senão o rascunho é descartado
  e o fechamento bloqueia.
- **Disponibilidade e quedas**: vêm de `availabilityMetrics`
  (`monthly-operations.ts`, quedas do monitor em `WhatsappIncident`), na mesma
  passada. Sem medição no mês a linha some (`unavailable`), nunca 100%
  presumido; medição que começou no meio do mês sai com o selo de parcial. Cada
  queda vira um item de "o que não saiu como planejado".
- **Bloco 03** abre com as ações do mês anterior **já avaliadas**
  (`previousActions`, status + o número que comprova; ação sem status é
  pendência da revisão e não vai ao documento) e mostra os fatos medidos do
  caso do mês (`caseFacts`), nunca o id da conversa.
- **Ver registros v2**: `MonthlyReportEvidence` aparece abaixo da folha no
  painel da clínica e no admin. `monthly-v2-evidence.ts` projeta os contatos,
  recepção, coorte, bases da taxa de comparecimento, mensagens e eventos do
  snapshot, com filtros próprios da v2. Não usa os totais da visão antiga,
  não consulta o banco e não recalcula indicadores. Lista limitada avisa que
  os registros exibidos podem não somar o valor publicado. Não existe na
  árvore do documento nem na rota de impressão. Snapshot sem as listas novas
  não ganha registros inventados. Testes: `relatorio-mensal-v2-registros.test.ts`.
- **Feriados e dias sem recepção**: `assumptions.humanClosedDates` guarda
  datas locais `AAAA-MM-DD` informadas pela clínica na etapa 2. Cada data
  fecha a recepção o dia inteiro e prevalece sobre a grade semanal, no fuso
  cadastrado (`outsideHumanHours` e `arrivalSlot`). Sem expediente conferido
  continua não classificado. Não há calendário automático nem recorrência
  anual: datas bloqueadas da agenda do agente não são importadas. Premissa
  congelada no snapshot e apresentada no painel/PDF; chave ausente em
  revisão antiga vira `[]` sem apagar os demais valores. Guardada no JSON
  existente, sem schema novo. Testes: `relatorio-mensal-feriados.test.ts`.
- Disparo conta como mensagem da equipe (`sentBy: "human"`): um
  disparo depois de o contato escrever no mês marca o contato como transferido.
- Testes: `tests/relatorio-mensal-v2-*.test.ts`, com a fixture de aceite em
  `tests/fixtures/monthly-report-v2.ts`.

### ROI mensal odontológico (P-79, visão anterior à v2)

A visão `?visao=mensal&mes=YYYY-MM` apresenta relatórios revisados pela Mavellium.
No tenant, a aba só aparece quando há relatório `ready` com snapshot. O seletor
oferece somente competências publicadas e abre a mais recente; um mês ausente
cai na última publicação, e uma conta sem publicações fica na visão Operacional.
O `MonthPicker` compartilhado usa `SelectMenu` e setas, sem input mensal nativo.
No admin, o retorno vem antes da edição recolhível, com `Field`, `CurrencyInput`
e `Switch`. Alterações de formulário são protegidas ao navegar entre meses.
O admin prepara em `/admin/relatorios`, acessível pelo menu **ROI mensal** e
pelo painel de edição da conta. A listagem usa **Por clientes**, sem contador,
com cabeçalhos centralizados: Cliente, Data de entrada do cliente, Revisão e
Ação. A entrada é `Tenant.createdAt`, em data curta de Brasília. O texto sobre
prazo/reunião e as colunas Entrega/Reunião foram retirados da listagem;
seus registros permanecem na revisão individual.
O PDF A4 segue o modelo revisado (ver "Modelo revisado: todos os leads, tudo
que é mensurável" e "PDF e painel: a ordem do relatório"). Leia [`docs/P-79-relatorio-mensal-roi.md`](../../../../docs/P-79-relatorio-mensal-roi.md)
antes de alterar a nova visão: **não usa a regra do Financeiro legado**.
O relatório mede atendimento, agendamento e comparecimento; receita, economia e
ROI são um bloco opcional (ver "O que o relatório mede e o bloco financeiro
opcional"). Quando ligado, a
receita só vem de avaliações realizadas cuja primeira chegada foi fora do
expediente humano; economia usa o tempo medido (áudio ouvido + mensagens × tempo
por mensagem) e, sem tempo por mensagem, os minutos declarados por conversa.
Premissas mensais, falta de dado explícita, fechamento em snapshot e entrega
manual registrada. A leitura do Clinicorp confirma presença pelo ID do espelho
e pelos status `Type` conferidos pela Mavellium, sem alterar a agenda local.
Conexão cadastrada e consulta com sucesso são estados separados: falha da agenda
preserva a lista válida de status e mostra o endpoint/código HTTP no editor,
sem expor o corpo externo. A importação atualiza o aviso e a lista carregados;
comparecimentos vinculados continuam pendentes quando não há confirmação.
Presença local é `Appointment.attendance` marcada na `/agenda` depois do
horário (nunca "agendado" nem "confirmado"; o `done` legado vale como
compareceu). Com espelho, o status mapeado do Clinicorp vence e, sem resposta
de lá, só a marcação com `attendanceAt` conta. `kind` explícito vence
`serviceType` × `evaluationTypes`, e `Appointment.procedure` vence a variável
da conversa. Ver "Dimensões de um agendamento" em `modules/scheduling/README.md`.
Eventos anteriores à implantação não são inventados. P-86 fica fora.
A fila P-87 (`/perguntas`, [contrato](../../../../docs/P-87-perguntas-sem-resposta.md))
acrescenta a linha **Tempo médio para a equipe responder**: média de
`answeredAt − firstAskedAt` das perguntas aprovadas na competência
(`MonthlyMetrics.gapAnswerSeconds`/`gapsAnswered`, opcionais — snapshot antigo
mostra "Sem registro", mês sem aprovação mostra "Nenhuma aprovada"). Formatação
única em `formatGapTime`/`formatGapTimeShort` (`modules/knowledge-gaps/text.ts`);
no PDF o tempo vai na célula de perguntas sem resposta para não aumentar a página.

#### Assistente de fechamento (admin, 5 etapas)

`MonthlyCloseWizard` (`admin/relatorios/[tenantId]/MonthlyRoiEditor.tsx`) guia a
revisão em rascunho: **1 Importar e conferir** (escopo de agentes, cobertura dos
dados, indicadores e correções), **2 Resolver pendências** (central de
pendências, expediente, agendamentos e comparecimentos, tempo devolvido e a
chave **Retorno estimado (opcional)**, que abre investimento/equipe e ticket e
conversão), **3 Validar resultados** (os quatro números da página 1 com o selo
e o motivo de cada um; receita, economia e ROI só com o retorno ligado; "Recalcular" usa a prévia do servidor + as correções não
salvas, via `draftAnalysisBase`), **4 Análise com IA** ("o que não saiu como planejado" opcional, avaliação das
ações do mês anterior, melhorias, até 3 próximas ações, resumo do período opcional, decisor, caso do mês e os
fatos dele) e **5 Aprovar e entregar** (prévia
do PDF em `?ver=1`, confirmação das limitações, fechamento, envio e reunião).

- **Um formulário só.** As etapas ocultam seções com `hidden`, então "Salvar
  revisão" grava tudo de qualquer etapa. Campo `required` em seção oculta
  impediria o envio sem aviso: a validação é do código (`onSubmit`/`readAssumptions`).
- **Rascunho da IA durante o envio.** Capture os campos antes de aguardar a
  chamada: o `fieldset` fica desabilitado enquanto ela roda, e `FormData`
  não inclui controles desabilitados. Não releia o formulário depois do
  `await` para mesclar a resposta; preserve o rascunho capturado. O mesmo vale
  para o recálculo. `monthlyDraftProblem` aponta o campo e sua etapa em erros
  de validação, sem expor mensagens técnicas do schema.
- **Requisitos da aprovação.** `monthlyCloseProblems` é usado na tela e no
  servidor: decisor, ajustes (ou registro explícito de que não houve), plano
  seguinte e revisão das ações anteriores. A etapa 5 lista o que falta,
  oferece voltar à etapa 4 e desabilita aprovar até salvar esses requisitos.
  Confirmar cobertura parcial não os substitui.
- **Chave de retorno estimado.** Fica no topo do assistente e pode ser alterada
  em qualquer etapa do rascunho. Na etapa 5 há também “Salvar revisão”; desligar
  conserva as premissas e, ao salvar, retira o bloco do painel e do PDF.
  Snapshot aprovado exige reabrir para alterar a escolha.
- **Conferência do Clinicorp.** A etapa 2 oferece “Consultar Clinicorp novamente”
  quando há erro. Sem status válidos, a marcação explícita de comparecimento
  na Agenda do Fechai após a consulta continua sendo a alternativa; registrar
  resposta na central não modifica presenças nem transforma confirmação em
  comparecimento. Resposta inválida da API permanece como limitação real.
- **A etapa mora fora do editor.** O editor remonta a cada revisão salva (a
  chave tem `revision`); o `MonthlyCloseWizard` guarda a etapa. A central de
  pendências tem formulários próprios e é renderizada fora do formulário.
- **Nada trava o avanço.** O status de cada etapa é calculado do relatório e só
  orienta; a etapa inicial é a primeira que precisa de atenção.
- **Fecha com cobertura parcial.** `finalizeMonthlyRoi(tenantId, month, acknowledged)`
  recebe `limitationFingerprint` da lista que o admin viu; se `monthlyLimitations`
  (recalculada no clique) mudou — inclusive a contagem no texto —, recusa.
  Continuam travando: mês em andamento, decisor (dono ou sócio, ver abaixo),
  ajustes/próximo mês, **ações do mês anterior sem status ou sem resultado** e
  concorrência. "O que não saiu como planejado" em branco não trava mais. Número sem evidência segue `null` e o selo `pending` se lê
  **"Não verificado"**; em relatório fechado as células vazias também.
- **Decisor × contato operacional** (`modules/reports/monthly-decision-maker.ts`,
  pura). O **decisor** é quem decide a mensalidade: recebe o relatório e a
  reunião de 30 min. O **contato operacional** (recepção,
  `MonthlyRoiReport.operationalContact`, opcional) só recebe cópia. O decisor
  não é texto livre: tem de estar em `Tenant.ownerNames`, a lista de donos e
  sócios da conta, mantida pela Mavellium na etapa 4 e gravada junto da
  revisão. **Não use `User.role = OWNER` para isso**: é o login da conta, que em
  clínica costuma ser justamente o da recepção. `decisionMakerProblem` é a regra
  única — vazio, igual ao contato operacional ou fora da lista — e vale no
  salvar (quando preenchido), no fechar e no registro do envio; relatório
  fechado antes da regra com a recepção no campo precisa ser reaberto para
  registrar o envio. Envio e reunião são registrados com o decisor congelado no
  snapshot (auditoria e mensagem levam o nome). O PDF abre com "Para: {decisor}
  · Cópia: {contato operacional}".
- **Limitações** (`modules/reports/monthly-limitations.ts`, pura): pendências
  por tópico + histórico anterior à implantação, erro do Clinicorp, chegada sem
  horário (com expediente) e áudio sem duração. Mês anterior sem premissas não
  entra (limita o comparativo, não o mês). Anexada em `computeMonthlyReport` e
  congelada no snapshot; fechados antes dela não a têm e caem no `missing` antigo.
- **Análise com IA** (`modules/reports/monthly-analysis.ts` + `generateMonthlyRoiAnalysis`):
  agregados, selo, limitações, qualidade dos leads (manchete) e o log de
  auditoria `agent.*`/`knowledge.*` do mês, agrupado (nome do evento e do alvo;
  `knowledge.gap_*` vai sem alvo, porque o alvo é a pergunta de um contato).
  Dinheiro só vai à IA com o retorno estimado ligado e calculado
  (`facts.financial`); desligado, ela é instruída a não citar ROI, receita nem
  economia. Trava depois da resposta: sem alteração registrada, contexto ou
  texto já escrito, "melhorias" volta vazio; sem incidente comprovado,
  limitação ou contexto, "O que não saiu como planejado" volta vazio (a IA não
  inventa problema); e número fora dos fatos validados é apontado para
  conferência (`unbackedNumbers`).
  Mesmo limite de chamadas do assistente lateral; nada é salvo.
- **Textos novos**: `MonthlyRoiReport.highlights` ("Resumo do período", 600,
  opcional) e `limitationsNote` ("O que não saiu como planejado", 400), com a
  mesma recusa de e-mail e nome de contato do caso do mês
  (`reviewTextProblem`; números longos são permitidos, são o assunto).
- **PDF**: as limitações entram inteiras em "05 O que não saiu como planejado",
  depois dos incidentes; o resumo do período fica logo abaixo dos quatro
  números. O rodapé de toda página (versão aprovada e "Página X de N") é
  desenhado no fim.

#### O que o relatório mede e o bloco financeiro opcional

Decisão de 30/09/2026: o relatório mede o que o Fechai controla — atendimento,
agendamento e comparecimento. A métrica âncora é **avaliações agendadas e
realizadas** (é o que o roteiro comercial e o contrato prometem). O financeiro
da clínica é do Clinicorp.

- **Retorno estimado é opcional.** Receita, economia e ROI só existem com
  `assumptions.financialEnabled` ligado e os três valores calculados. A única
  porta é `monthlyFinancial(report)` (`modules/reports/monthly-executive.ts`):
  devolve `null` e o bloco some do painel, do PDF, da tabela, dos procedimentos
  e das premissas. Nunca "Pendente", nunca zero. Motivo: sem ticket e conversão
  a conta dava ROI negativo (só a economia contra a mensalidade), e era a
  primeira coisa que o dono via.
- **Desligado não é pendência.** `detectMonthlyPendencies` para antes dos
  tópicos `ticket`, `team` e `investment`; `applyMonthlyOverrides` zera receita,
  economia e ROI; `monthlyQuality` não cria selo de dinheiro (nem "não
  verificado"); `monthlyLimitations` não lista nada financeiro. Continuam
  exigidos: expediente, comparecimento e classificação dos agendamentos.
- **Chave ausente** (revisão ou snapshot anterior): `financialEnabled(config)`
  (`monthly-config.ts`) infere ligado só com custo e carga do atendente e todos
  os procedimentos com ticket e conversão. Relatório entregue com ROI continua
  com ROI; o incompleto para de mostrar "pendente".
- **Ligado e incompleto**: a falta volta a ser limitação (dita no fechamento) e
  o bloco segue oculto até dar para calcular.
- **Central de pendências**: com o retorno desligado, "Ticket e conversão",
  "Custo e tempo da equipe" e "Mensalidade" aparecem como **Opcional**
  (`FINANCIAL_TOPICS`, `isOpenPendency`), fora da contagem e da solicitação à
  clínica. `affectedLabels` tira receita/ROI do "afeta" de cada falta.
- **Clinicorp**: só o comparecimento é exigido. Conta sem a integração (ou
  com ela desligada) também recebe um texto em `clinicorpError`; isso não é
  falha de leitura (`clinicorpReadFailed`) e não vira limitação.
- **Aba Financeiro** (`FinancialView`): mesma regra. Sem valor do lead, só o
  convite; nada de cartões com travessão ou "ROI —".
- Testes: `tests/relatorio-mensal-executivo.test.ts` (aceite da página 1),
  "retorno estimado desligado" em `relatorio-mensal-pendencias.test.ts` e
  "aceite: fechar sem premissas financeiras" em `relatorio-mensal-access.test.ts`.

#### Modelo revisado: todos os leads, tudo que é mensurável

Decisões do Vinícius (30/09/2026), valendo para o painel e o PDF:

- **Tudo que puder ser medido aparece no relatório.**
- **Todos os leads entram**, de dentro e de fora do expediente, porque o agente
  atende todos igual. A divisão por expediente é só um detalhe dentro de cada
  número (`126 no expediente · 88 fora`), nunca o critério do que conta.
- **A regra conservadora** (receita só de quem chegou com a recepção fechada)
  vale **apenas** no bloco opcional de retorno estimado. Fora dele, os
  procedimentos mostram todas as agendadas e todos os comparecimentos
  (`procedures[].scheduled`/`attended`); `attendedOutside` é só a base da receita.

**Arquitetura em três passos que não se misturam** (`modules/reports/monthly-document.ts`):

1. **O motor de dados calcula e valida** — `evaluateMonthlyMetrics`, o selo
   (`monthly-quality.ts`) e as limitações. É a única origem de número.
2. **A IA só redige a partir dos números validados** — recebe as frases e as
   tabelas já prontas (`monthlyAnalysisFacts().validated`) e os incidentes do
   motor; é instruída a não calcular. Depois da resposta, `unbackedNumbers`
   aponta para conferência todo número que não está nos fatos nem no contexto
   do administrador. Continua rascunho até a Mavellium salvar.
3. **O PDF apresenta só o que foi aprovado e versionado** — o snapshot do
   fechamento. Cada fechamento é uma versão (`MonthlyRoiReport.version` + `MonthlyRoiReportVersion`,
   `snapshot.approval = { version, approvedAt }`), impressa no rodapé de toda
   página. O PDF da clínica sai de `loadApprovedReport` (snapshot ou 404, nunca
   um cálculo na hora); o do admin em rascunho é prévia e diz "RASCUNHO · NÃO
   APROVADO" em toda página.

**Notas internas nunca entram no PDF**, e não por um botão de esconder:
`generateMonthlyPdf` passa o relatório por `approvedDocument()` antes de
desenhar. Ficam de fora os registros individuais (`evidence`), os valores antes
das correções (`automatic`), as correções em si (`metricOverrides`; sobra só o
aviso `manualAdjustments` e as horas informadas à mão, que mudam o texto da
premissa), a origem presumida da mensalidade, os status crus do Clinicorp e a
conversa de onde o caso do mês foi lido. Nota da IA, contexto do administrador
e a central de pendências nunca fizeram parte do `MonthlyReport`.

O que o modelo acrescentou, tudo na mesma passada de `evaluateMonthlyMetrics` e
**opcional** em `MonthlyMetrics` (snapshot anterior não tem; ausente é "sem
registro", nunca zero):

- **Recepção** (`reception`, `monthly-operations.ts`): cada conversa respondida
  é de um de três grupos que **somam os contatos atendidos** — só o agente,
  passada para a recepção (tem evento `handoff` no mês) e equipe na conversa
  (alguém respondeu sem transferência). Das transferidas: respondidas (x de y),
  **mediana** da 1ª resposta humana, quantas esperaram mais de 1 hora (inclui as
  que ainda esperam) e quantas seguiam sem resposta. A espera vai da **primeira**
  transferência à primeira mensagem `sentBy: "human"`, em tempo corrido, e para
  no fim do mês: resposta que só veio no mês seguinte não conta. Correção manual
  que quebra a soma torna o selo inconsistente e a frase volta ao formato antigo.
  A 1ª resposta do **agente** (`agentFirstResponseMedianSeconds`) é o número da
  página; agente e recepção ficam sempre separados.
- **Disponibilidade do agente** (`availability`): % do período no ar, quedas e
  contatos afetados. A fonte é `WhatsappIncident`, aberto e fechado pelo monitor
  de saúde (`modules/whatsapp/incidents.ts`) — só queda **confirmada pelo
  provedor**; "silencioso" e "indeterminado" não abrem nada, e desconectar pelo
  painel fecha a queda (é decisão, não falha). `Tenant.uptimeTrackedSince` marca
  desde quando há medição: mês sem medição é `null` = **não medido** (selo
  "não verificado" + limitação `uptime`), **jamais 100% presumido**; medição que
  começou no meio do mês vale só para o período medido, e isso é dito. O início
  é o momento em que o monitor viu a queda. Quedas sobrepostas (QR e Meta) contam
  uma vez. O % é arredondado para baixo: queda nunca vira 100%. Contatos
  afetados = quem escreveu durante a queda ou nos 15 min seguintes à volta
  (`INCIDENT_BACKLOG_MS`: o fechai grava a hora em que recebeu, e o WhatsApp
  entrega o que ficou retido quando a conexão volta). A leitura das quedas é
  complemento: se falhar, o relatório sai sem o bloco.
- **Horário pelo expediente cadastrado, não por faixa fixa** (`arrivals`,
  `arrivalSlot`): no expediente, antes de abrir, no intervalo, depois de fechar,
  dia sem expediente. Sem `humanHours` não há tabela. Não existe faixa de
  horário fixa em lugar nenhum do relatório — não crie uma.
- **Agenda** (`agenda`): `noShow` (falta **marcada** na `/agenda`), `unconfirmed`
  (consulta do mês já passada sem comparecimento comprovado — inclui status do
  Clinicorp que não comprova presença; **nunca é falta**) e `upcoming` (marcada
  no mês para depois: aguarda, não é falta). Taxa de comparecimento =
  compareceram ÷ (compareceram + faltaram). A definição da âncora não mudou:
  agendadas pelo mês da marcação, realizadas pelo mês da consulta.
- **Tempo devolvido detalhado** (`timeBreakdown`, `monthly-time.ts`): quantidade
  de áudios, total ouvido, maior áudio, áudios acima de 2 min e o tempo de
  leitura e resposta. Áudio é medido; só a linha de leitura e o total levam
  "estimativa". Sem tempo por mensagem não há linha estimada nem total.
- **Selo "estimativa" só no que é estimado** (`showsSeal`, `monthly-quality.ts`):
  no relatório que a clínica lê, número medido **não leva selo**; "estimativa"
  marca o estimado, e cobertura parcial / não verificado / inconsistente só
  aparecem onde há o que avisar. "Verificado" só existe na conferência interna
  (`<QualityBadge all />` na etapa 3 do assistente).
- **Motivo principal de não agendar** (`LeadQuality.notScheduled`,
  `lead-insights/summary.ts`): um único motivo por lead que não agendou, sem
  corte de ranking — a soma é exatamente `leads − outcomes.scheduled`, e o
  relatório mostra a conta na linha de total. Além dos motivos de perda, entram
  "Em atendimento com a equipe" e "Ainda em conversa" (menos de 72h).
- **Ações do mês anterior** (`monthly-previous-actions.ts`,
  `MonthlyRoiReport.previousActions`): abrem "O que ajustamos no agente" com
  status (**funcionou, parcial, não funcionou**) e o número que comprova. A
  lista **não é digitada**: são as `nextActions` do snapshot **aprovado** do mês
  anterior (plano em rascunho não foi combinado com ninguém); a revisão só
  acrescenta status e resultado, e o servidor descarta avaliação de ação que
  não está no plano. **Fechar exige status e resultado em cada uma.**
- **Caso do mês** (`monthly-case.ts`, `MonthlyRoiReport.caseFacts`): além do
  texto, os fatos medidos — idade, duração de cada áudio, dia da semana e
  período — e se o contato agendou (pode ser de quem **não** agendou: o valor
  está no tempo e na paciência absorvidos). O formulário só diz **qual conversa
  e a idade**; duração, dia e período são lidos no servidor
  (`loadMonthlyCaseFacts`, com `tenantId`, mês e escopo de agentes). **Nunca
  nome, telefone ou data exata**: `featuredCaseProblem` recusa também `12/09`,
  `12 de setembro` e `dia 12` (`exactDateIn`).
- **"O que não saiu como planejado" aparece sempre** e só com o que os dados
  comprovam: `monthlyIncidents()` (faltas, quedas do agente, conversas que a
  recepção deixou esperando), as limitações e o texto opcional da revisão. Sem
  nada disso, a seção diz **"Nenhum incidente relevante identificado neste
  mês"** (`NO_INCIDENT`). O texto deixou de ser obrigatório para fechar, e a IA
  nunca inventa problema: sem incidente, limitação nem contexto do admin,
  `guardMonthlyAnalysis` apaga o que ela escreveu nesse campo.

Testes: `tests/relatorio-mensal-modelo-revisado.test.ts`,
`relatorio-mensal-executivo.test.ts` e o bloco "modelo revisado" de
`relatorio-mensal-access.test.ts`.

#### PDF e painel: a ordem do relatório

A abertura e o topo do painel (`MonthlyRoiSummary`) leem o mesmo
`executiveSummary(report)`, e nada ali é escrito por IA.

- **Abertura**: faixa escura "Fechai · relatório mensal / Resultados de {mês} /
  {clínica}", a linha "Para: {decisor} · Cópia: {contato operacional} ·
  Expediente da recepção", a frase do mês (`lede`) e quatro cartões, nesta
  ordem: **contatos atendidos**, **avaliações agendadas** (o número principal,
  em destaque), **compareceram** (taxa sobre presença + falta; o que ainda vai
  acontecer) e **1ª resposta do agente** (mediana). Cada um traz o expediente
  como detalhe e a comparação com o mês anterior. O resumo do período
  (`highlights`) vem logo abaixo.
- **Seis partes, sempre nesta ordem**: 01 Atendimento (tempo devolvido, quando
  os contatos chegaram, conversas passadas para a recepção) · 02 Agenda (funil,
  consultas do mês, por procedimento) · 03 O que ajustamos no agente (ações do
  mês anterior, ajustes, perguntas sem resposta, caso do mês) · 04 Qualidade
  dos leads (primeira dúvida, motivo principal de não agendar, cidades,
  sugestões de tráfego) · 05 O que não saiu como planejado · 06 Próximo mês.
  Com o retorno estimado ligado e calculado, o bloco **+ Retorno estimado** com
  a conta por procedimento.
- **Como contamos** (sempre em página nova): comparativo com o mês anterior,
  premissas, "Estimativas e avisos de cobertura" (só os indicadores com selo) e
  metodologia.
- **O documento inteiro flui** (`ensure`/`newPage`): quebra de página sozinho e
  nunca recusa a exportação por tamanho. Não existe mais página 1 de layout fixo.
- Nenhum texto de `executiveSummary` diz "pendente" ou "não verificado": sem
  expediente conferido sai o total sem a divisão; sem resposta no mês, travessão.
- **Próximas ações** (`modules/reports/monthly-next-actions.ts`): lista Zod de
  até 3 `{ action ≤120, owner ≤60, indicator ≤100 }`, todas obrigatórias por
  linha, em `MonthlyRoiReport.nextActions` (Json). Responsável é área ou
  função, nunca paciente (`reviewTextProblem` recusa nome de contato). Sem
  ações, painel e PDF mostram o texto antigo `nextMonth`; fechar exige ações
  ou esse texto (`hasNextPlan`). A análise da IA propõe as ações.

#### Assistente que investiga os registros (admin, "Perguntar à I.A")

Pergunta do tipo "por que dez agendamentos, se oito estão sem tipo?" é
respondida consultando os registros individuais, não o resumo. O laço fica em
`completeMonthlyAi` (`monthly-ai-service.ts`): até 5 voltas, 6 consultas por
volta, 90 s no total; cada modelo da cadeia recomeça do zero (`toolbox.reset`).

- **Ferramentas** (`modules/reports/monthly-ai-tools.ts`, só leitura):
  `list_appointments` (filtros `scheduled`, `attended`, `untyped`, `bucket`),
  `list_conversations`, `list_events`, `get_conversation` (linha do tempo:
  quem falou e quando, texto/áudio e duração, canal, agendamentos e eventos
  dela), `get_configuration` (premissas + agendamento dos agentes do escopo:
  ligado e tipos que o agente registra) e `get_integrations` (Clinicorp,
  Google Agenda e WhatsApp, só estado). Até 60 linhas por chamada, total sempre.
- **Mesma passada.** As listas vêm de `report.evidence`, calculado com as
  premissas do rascunho. Consultar o banco com outra regra reabriria a
  divergência que os registros existem para explicar.
- **Permissão e escopo.** A action exige SUPERADMIN; o tenant e a competência
  vêm dela, nunca dos argumentos da IA (argumento fora do contrato é
  recusado). `get_conversation` só abre conversa presente nos registros.
- **LGPD.** Nenhuma ferramenta devolve nome, telefone, e-mail, texto de
  mensagem ou credencial; da conversa sai só a variável de procedimento, que
  o relatório já usa.
- **Evidências consultadas** = `consulted`, anotado pelo servidor a cada
  chamada ("8 registros de agendamento sem tipo"), gravado no histórico.
- **Confirmação humana.** A IA pode propor `proposal: review_list`; o servidor
  descarta id que nenhuma ferramenta devolveu naquela resposta e monta as
  linhas (`monthlyReviewRows`: data e hora da consulta e o que conferir, sem
  paciente). O painel mostra "Aguardando confirmação humana" até "Gerar
  lista"; confirmar só revela e copia, não grava nada.
- Testes: `tests/relatorio-mensal-ai-tools.test.ts`.

#### Central de pendências do fechamento (admin)

Na revisão individual em rascunho, `MonthlyPendencyCenter` mostra o que falta
por tópico (expediente, comparecimento, classificação, ticket/conversão,
custo e tempo da equipe, conferência dos indicadores, mensalidade), agrupado
por responsável (Recepção, Agenda, Financeiro, Mavellium), com as métricas
que cada falta segura. Regras que não se quebram:

- **Uma regra só.** `detectMonthlyPendencies` (`modules/reports/monthly-pendencies.ts`)
  gera o `missing` em `applyMonthlyOverrides` e as limitações do fechamento, e
  a receita só é bloqueada pelos tópicos que afetam receita (`blocksRevenue`).
  A central nunca diz "confirmado" para algo que o relatório entrega como
  "não verificado".
- **Pendência é calculada, acompanhamento é gravado.** `MonthlyRoiPendency`
  (um por tenant + mês + tópico) guarda só quem responde, quando pediu e a
  resposta. Fica fora de `MonthlyRoiReport` para não mexer no `updatedAt`
  que protege a revisão. **Registrar resposta não muda número**: a Mavellium
  aplica o dado na revisão e salva. Resposta anterior ao último pedido não conta.
- **Solicitação consolidada** (`buildPendencyRequest`): uma mensagem, por
  área/pessoa, só com tópicos da clínica. Nunca leva dado de paciente (só
  contagens e nomes de procedimento). Nada é enviado sozinho: abre `wa.me` /
  `mailto` para o dono da conta (`User` OWNER) ou copia, e "Registrar envio"
  marca os tópicos como "Aguardando clínica".
- Relatório fechado não mostra a central e as actions recusam alteração.

#### Registros e selo de qualidade de cada número

Todo número do ROI mensal abre a própria origem ("Ver registros (N)" na tabela,
nos destaques e nos blocos; "Ver cálculo" nos valores derivados) e carrega um
selo: **verificado**, **estimado**, **cobertura parcial**, **pendente** ou
**inconsistente**. Nasceu de um relatório com "10 agendamentos", um sem
classificação de horário e oito sem tipo, sem como mostrar a composição.

- **Mesma passada, nunca outra consulta.** `evaluateMonthlyMetrics`
  (`monthly.ts`) devolve `{ metrics, evidence }`: cada `continue` que tira um
  registro da conta anota o motivo (`AppointmentEvidence.scheduled/attended`,
  `ConversationEvidence.excluded`, `messagesExcluded`). `calculateMonthlyMetrics`
  é só `.metrics`. Reconstruir a lista com outra query é exatamente a
  divergência que ela existe para explicar.
- **Registros** (`monthly-evidence.ts`): conversas (contou/fora e por quê),
  pares da primeira resposta (com mediana e separação IA × equipe), agendamentos
  do agente criados ou com consulta no mês (tipo, procedimento, status local e
  Clinicorp, chegada do contato, horário e critério), eventos, perguntas
  aprovadas, mensagens de texto e áudios respondidos, mensagens por hora e leads
  do mês (`lead-insights/queries.ts`). Só ids, datas e classificações — nenhum
  nome, telefone ou texto; o id da conversa abre `/conversas?id=`. Datas em ISO
  e formatadas na tela pelo fuso das premissas. Listas acima de
  `EVIDENCE_LIMIT` (5.000) são cortadas com o total anotado — o número nunca.
- **Selo** (`monthly-quality.ts`, puro): a pior situação encontrada vence
  (inconsistente > pendente > parcial > estimado > verificado) e cada selo leva
  os motivos. Contagens são verificadas; horas, receita, economia e ROI são
  estimados; sem expediente, dentro/fora é pendente; sem horário de chegada,
  sem tipo, comparecimento pendente, erro do Clinicorp, áudio sem duração ou
  cobertura histórica incompleta são parciais. **Correção manual diferente do
  que os registros somam é inconsistente** (compara `current` com
  `automatic.current`); correção igual ao registro não muda o selo. Soma por
  procedimento diferente das realizadas fora também é inconsistente.
- **Congelados no snapshot.** `computeMonthlyReport` anexa `evidence` e
  `quality` (calculado depois das correções); o fechamento grava os dois.
  Relatório fechado antes deles não tem nenhum dos dois e o painel/PDF escondem
  selo e registros (mesma regra de `time` e `leadQuality`). O editor do admin
  recebe o relatório sem `evidence` (não usa e dobraria o payload). O
  assistente de IA lê os registros pelo servidor, com as ferramentas de
  leitura (ver "Assistente que investiga os registros").
- **PDF e painel do cliente**: número medido não leva selo (`showsSeal`). A
  etiqueta "ESTIMATIVA" acompanha só as linhas estimadas (tabela de tempo
  devolvido, horas, ROI), e os avisos (cobertura parcial, não verificado,
  inconsistente) aparecem ao lado do indicador no comparativo e em "Estimativas
  e avisos de cobertura", com o motivo. "Verificado" só na etapa 3 do
  assistente. Registros nunca vão ao PDF.
- Testes: `tests/relatorio-mensal-registros.test.ts`.

#### Tempo que o Fechai devolveu para sua equipe

Bloco do ROI mensal (`src/modules/reports/monthly-time.ts`, puro) que mostra o
trabalho da recepção assumido pelo agente. Regras que não se quebram:

- **Duração do áudio é medida, nunca estimada.** `Message.audioSeconds` vem do
  payload da Evolution (`audioMessage.seconds`) ou, na Meta (que não informa),
  do próprio arquivo OGG (`audioDurationSeconds`, `src/modules/voice/received-audio.ts`).
  `null` = não medido (formato não lido ou áudio anterior à coluna) e aparece
  como "sem duração medida", **nunca como zero**. O histórico desde 23/09/2026
  (quando o áudio recebido passou a ir para a CDN) se mede com
  `scripts/mede-audios-recebidos.ts`.
- **Conta o que o agente respondeu.** Mensagem do contato entra quando a
  primeira resposta depois dela é da IA; se a equipe respondeu primeiro, o
  trabalho foi dela. Áudio sem transcrição (`UNTRANSCRIBED_AUDIO`, `[Áudio]`)
  a IA não ouviu e não conta.
- **Horas devolvidas** = (minutos de áudio × 60 + (mensagens + áudios) ×
  `assumptions.secondsPerMessage`) ÷ 3600. Sem `secondsPerMessage` vale a
  fórmula antiga por conversa; `assumedHours` corrigido manualmente vence as
  duas. `secondsPerMessage` tem `default(null)`: revisões salvas antes dele
  continuam válidas (sem o default, o parse falhava e zerava as premissas).
- **Atendimento** vai da primeira mensagem do contato até a última antes de
  24h de silêncio (a conversa é uma por contato, para sempre, sem "fim"). Só
  entram os iniciados no mês com resposta do agente. Resultado: agendou
  (agendamento do agente, não cancelado, até 24h após a última mensagem) >
  transbordou (`ReportEvent` handoff) > perdido (`Lead.status = lost` hoje, só
  no último atendimento; desqualificado não é perdido) > sem desfecho.
- **Caso do mês** (`MonthlyRoiReport.featuredCase`, até 240 caracteres) é
  escrito pela Mavellium, nunca pela IA. `saveMonthlyRoi` recusa e-mail, 8+
  dígitos seguidos e qualquer palavra do nome de um contato atendido no mês
  (`featuredCaseProblem`), e também data exata. O admin vê sugestões (conversas
  com áudios longos, `loadMonthlyCaseCandidates`) e escolhe de qual sair os
  fatos do caso (ver "Modelo revisado"); a lista de sugestões não vai para o
  snapshot nem para o PDF.
- `MonthlyMetrics.time` e `MonthlyReport.featuredCase` são **opcionais**:
  snapshots fechados antes deles não os têm, e a tela/PDF escondem o bloco.
- No PDF, o tempo devolvido é a tabela de "01 Atendimento" (`timeBreakdown`) e
  o caso do mês fica em "03 O que ajustamos no agente"; a duração dos
  atendimentos por resultado só aparece no painel.

`/relatorios` tem **cinco visões**, trocadas por um toggle no topo (querystring `?visao=`): Operacional, Financeiro, Qualidade dos leads (`leads`), Relatório mensal (`mensal`, só com mês publicado) e Afiliados (só para quem está no programa). As três do produto com regra própria:

- **Operacional** (padrão): KPIs com delta vs. período anterior, gráficos (fluxo, resultados, atendimento IA×humano, leads fechados IA×humano, donut por agente, leads por status, funil de conversão, resolução autônoma, recuperação por follow-up, horários de pico, tempo até a primeira resposta, comparecimento/no-show — compareceu × faltou pelo horário da consulta, com "não verificado" na tabela; cancelada não entra) e exportação CSV.
- **Financeiro**: retorno financeiro **estimado** do investimento no projeto — KPIs (Retorno, Investido, ROI, Ponto de equilíbrio), gráfico de retorno acumulado × investido, retorno por agente, retorno mês a mês e custo por lead fechado. O valor por lead é definido manualmente pelo dono da conta; sem ele, os gráficos que dependem desse valor mostram um estado vazio com a chamada para definir, nunca uma série de zeros. No fim da visão fica **"O que o agente filtrou"** (triagem): contatos que o agente encerrou por não serem clientes em potencial, e o tempo/dinheiro que isso poupou.
- **ROI mensal** (`mensal`): competência mensal fechada pela Mavellium, com receita somente de avaliações realizadas de contatos que chegaram fora do horário humano, economia estimada, premissas por procedimento e PDF com resumo executivo (página 1) e análise detalhada. Contrato em `docs/P-79-relatorio-mensal-roi.md`.

Tudo começa na `page.tsx`, que resolve a janela (`?periodo=`/`?de=&ate=`), computa os dados no servidor e entrega a props serializáveis aos componentes client.

## Auditoria operacional × mensal (01/10/2026)

- Contatos que escreveram vêm das mensagens recebidas na janela, nunca de
  `Conversation.updatedAt`. Conversa de agosto ativa em setembro conta em setembro.
- Contatos atendidos exigem entrada + resposta atribuída à IA/equipe posterior
  dentro da janela. `contact-activity.ts` é compartilhado com o motor mensal v2.
  Taxa de resposta = atendidos / contatos que escreveram; duas mensagens do
  contato não provam resposta. Envio proativo não é atendimento.
- Atendimento IA × humano conta cada contato uma vez no período, na primeira
  entrada. Humano em outro dia retira esse contato de “só IA”. A soma do gráfico
  fecha no KPI; autonomia usa a mesma população, não somas duplicadas por dia.
  Evento de transferência também retira de só IA, mesmo sem resposta da equipe.
- Competência completa compara com o mês civil anterior inteiro (setembro ×
  agosto), como o mensal; intervalos parciais mantêm janela de mesma duração.
- Total de agendamentos e os dois gráficos usam **createdAt**, não startsAt;
  cancelados e testes ficam fora. Comparecimento por data da consulta continua
  separado. “Avaliações agendadas pelo agente” usa `evaluationOf`, origem e
  agentes da revisão mensal, quando o filtro é uma competência completa.
  Agendamentos gerais incluem outros tipos/origens e podem ser diferentes.
- Qualidade dos leads usa a população atendida e recupera declarações literais
  de cidade no histórico até o corte (ver README de lead-insights). A leitura
  mensal e o painel usam o mesmo reconhecimento; id/data da declaração ficam
  na evidência, sem texto. Não há escrita durante a leitura.
- Leads quentes e precisam de você são **estado atual**, não setembro histórico;
  sem histórico de status, não se atribui retroativamente o valor atual ao mês.
- O painel operacional cobre a conta toda; revisão mensal pode selecionar
  agentes. Comparações exigem janela, fuso e agentes iguais. Relatório aprovado
  é snapshot: corrigir/recalcular requer nova revisão e aprovação, nunca alterar
  silenciosamente o PDF entregue.

Conferência **só de leitura**, no ambiente já configurado com acesso ao banco:

```sh
npx tsx scripts/audit-report-metrics.ts --tenant ID --month 2026-09
```

Compara atendimento, avaliações e cidades ao motor mensal com o mesmo escopo,
confere somas dos gráficos e mostra os agregados da versão aprovada à parte.
Saída sem dados pessoais. Código 2 indica divergência; 1 indica configuração
ou leitura indisponível. A conferência real do Instituto do Sorriso ainda exige
execução no ambiente conectado; os números fornecidos pelo usuário não foram
recontados localmente.

## Regras de ouro (não quebrar)

1. **Multi-tenant**: toda query filtra por `tenantId` (regra global do projeto).
2. **Sandbox não conta**: toda métrica usa `isTest: false` (o chat de teste inflaria os números).
3. **Dinheiro é sempre em centavos** (`Int`): `valueCents`, `priceCents`. Exibir com `formatBRL()` de `src/lib/format.ts`.
4. **A visão Financeira é estimativa**: valor por lead é subjetivo e o investido presume o **plano atual** por todo o período. A UI usa as palavras "estimado"/"aproximado" — nunca prometer exatidão.
5. **Cor nunca é o único indicador** (design-ui skill §4): selo de ROI carrega texto (`ROI +128%`), não só verde/vermelho; o meter de resolução autônoma sempre mostra o `%` em texto.
6. **Todo bucketing usa o fuso do painel** (`America/Sao_Paulo`, constante `PANEL_TIME_ZONE` em `service.ts`). Nunca `new Date(y, m, d)`/`getFullYear()`/`Intl.DateTimeFormat` sem `timeZone` — isso é hora do SERVIDOR, que em produção é UTC. Use `partsInZone`/`zonedTimeToUtc` de `src/modules/scheduling/time.ts`.
7. **Número que vira dinheiro precisa de régua declarada pelo cliente.** Valor por lead (`TenantLeadValue`) e custo do atendimento (`TenantAttendanceCost`) são definidos pelo dono da conta. Sem a régua, a métrica derivada é `null` e a UI mostra o convite para definir — **nunca** uma média do sistema apresentada como fato. O cliente confere esse número contra a própria folha de pagamento.
8. **Paleta categórica só de `src/components/charts/palette.ts`** (`chartColor(index)`, variáveis CSS `--chart-1..5`). Nunca um hex novo solto num gráfico — a ordem atual foi validada com o script do skill dataviz; um hex fora dela pode reprovar CVD sem ninguém notar.

## Arquivos (mapa)

### Servidor (dados)

| Arquivo | Papel |
| --- | --- |
| `src/modules/reports/service.ts` | `resolveRange`, `computePeriodReport`, `computeFinancialSummary` + todos os tipos (`PeriodKey`, `ReportRange`, `FlowPoint`, `ResultPoint`, `AiHumanPoint`, `FunnelStep`, `HeatmapCell`, `ResponseTimeBucket`, `AttendanceOutcomePoint`, `PeriodReport`, `CumulativeReturnPoint`, `AgentReturnPoint`, `MonthlyReturnPoint`, `FinancialSummary`). |
| `src/modules/scheduling/time.ts` | `partsInZone`, `zonedTimeToUtc` — base de todo o bucketing com fuso correto (ver regra 6). |
| `src/modules/billing/plans.ts` | `PLANS` e `planOf(planKey)` — fonte do "investido" (preço do plano). |
| `src/lib/format.ts` | `formatBRL(cents)` (e `dateLabel`, `relativeTime`, etc.). |
| `prisma/schema.prisma` | Modelos `TenantLeadValue` (valor por lead) e `TenantAttendanceCost` (custo do atendimento manual), ambos com vigência. `Lead.disqualifiedAt`/`disqualifiedReason` (carimbo da triagem). `Tenant.priceCentsOverride` (preço negociado). |
| `src/modules/agent-engine/disqualify.ts` | `DISQUALIFY_REASONS`, `reasonLabel`, `costPerLeadCents` e os tetos de sanidade do custo. Fonte única dos motivos de triagem. |
| `src/app/(dashboard)/relatorios/actions.ts` | Server actions `saveLeadValue` (valor por lead) e `saveAttendanceCost` (minutos + custo/hora do atendimento). |

### Página e componentes (UI)

| Arquivo | Papel |
| --- | --- |
| `page.tsx` | Server Component: lê `?periodo/de/ate/visao/mes`, resolve janela e publicações, computa sob demanda e renderiza Operacional, Financeiro, ROI mensal ou afiliados conforme papel/visão. |
| `MonthlyEvidence.tsx` / `EvidenceDialog.tsx` | Selo de qualidade (`QualityBadge`) e "Ver registros"/"Ver cálculo" de cada indicador do ROI mensal: tabelas montadas no servidor a partir de `report.evidence`, abertas num `Modal` (`size="full"`) que só monta o conteúdo aberto. |
| `MonthlyView.tsx` | Resumo executivo (`MonthlyRoiSummary`: 4 números, resumo do período, próximas ações) e "Análise detalhada", bloco "Tempo que o Fechai devolveu" (`TimeReturnedCard`), comparação, premissas, fontes e link para exportação do snapshot em PDF. |
| `RangePicker.tsx` | `<details>` com presets de período + intervalo custom; **preserva `?visao=`** nos links e no form (hidden input). |
| `FinancialView.tsx` | "use client": linha de KPIs, card "Retorno estimado" + "Valor do lead" com `<dialog>` (campo com máscara `CurrencyInput`), delega os gráficos a `FinancialCharts.tsx`. |
| `TriagePanel.tsx` | "use client": KPIs da triagem (filtrados / tempo / economia), quebra por motivo e `<dialog>` do custo do atendimento. |
| `FinancialCharts.tsx` | "use client": retorno acumulado × investido, retorno por agente, retorno mês a mês, custo por lead. Só renderizado com valor por lead definido. |
| `ChartPanel.tsx` | "use client": moldura de card para os gráficos Operacionais, com `ChartActions` (Ampliar / Como é calculado) e tabela de dados. |
| `BarsChart.tsx` / `DonutChart.tsx` / `FlowChart.tsx` / `SeriesChart.tsx` | Gráficos em SVG/divs (sem lib). `SeriesChart` é o genérico de 2 séries (agora com eixo Y, crosshair/tooltip e rótulo de pico); `FlowChart` é um wrapper dele. |
| `StatusBreakdown.tsx` | "use client": lista de leads por status. |
| `export/route.ts` | Exporta o relatório **Operacional** em CSV (`;` + BOM, abre no Excel BR). |

### Compartilhados (`src/components/charts/`)

| Arquivo | Papel |
| --- | --- |
| `palette.ts` | Paleta categórica validada (skill dataviz) + `chartColor(index)`. **Fonte única de cor categórica** — ver regra 8. |
| `ChartActions.tsx` | Botões "Ampliar" e "Como é calculado" + dialogs. |
| `ChartTable.tsx` | Tabela de dados do gráfico (tela cheia). |
| `ChartTooltip.tsx` | `ChartTooltip`, `ChartCrosshair`, `ChartHoverLayer` — hover/foco de teclado compartilhado entre os gráficos de série e barra. |
| `ChartAxisY.tsx` | `ChartAxisY` (3 gridlines + rótulos) e `niceAxisMax` (arredonda o pico bruto para um valor de eixo limpo). |
| `HeatmapChart.tsx` | Grade 7×24 (dia da semana × hora) — horários de pico. |
| `FunnelChart.tsx` | Barras horizontais em ordem — funil de conversão. |
| `MeterChart.tsx` | Medidor de razão 0–100% — resolução autônoma. |
| `DivergingBars.tsx` | Barras acima/abaixo do zero — retorno mês a mês. |
| `HorizontalBars.tsx` | Lista rankeada de barras horizontais — tempo até resposta, retorno por agente. |
| `src/components/ui/currency-input.tsx` | Campo de preço com máscara pt-BR (client). |
| `src/components/ui/filter-tabs.tsx` | Toggle por links (`aria-current="page"`). |
| `src/components/ui/month-picker.tsx` | Competência via `SelectMenu` e setas; lista restrita de publicações no tenant e proteção de dados não salvos. |
| `src/components/ui/data-table.tsx` | Tabelas do painel; `headerAlign`/`columnAlign` permitem centralizar a listagem administrativa sem alterar as outras tabelas. |

## Regras de cálculo (definições exatas)

### Janela (`resolveRange`)

- `?periodo=` (`hoje | 7 | 30 | mes | ano | tudo`) ou `?de=&ate=` (custom tem prioridade).
- Devolve `from/to` (também `prevFrom/prevTo` para os deltas) e a granularidade do gráfico: `hora` (janela ≤ 1 dia), `dia` (≤ 62 dias), `mes` (mais longo). `"tudo"` → `from: null` (desde o início da conta).
- A série começa na **primeira mensagem da conta** quando `from` é null (evita gráfico vazio).
- Todos os limites de dia/mês/hora são calculados no fuso do painel (regra de ouro 6) — "hoje" começa à meia-noite de Brasília, não do servidor.

### `computePeriodReport`

- **KPIs**: conversas ativas (por `updatedAt`), leads novos, agendamentos (`Appointment` com `startsAt` no período e `status in ["scheduled","done"]`), mensagens recebidas/enviadas (`role user/assistant`), taxa de resposta (conversas com 2+ mensagens do lead), leads quentes e "precisam de você" (**estado atual**, não do período).
- **`flow`**: recebidas × enviadas por bucket.
- **`results`**: leads novos × agendamentos por bucket.
- **`attendance`** (atendimento IA×humano): contatos **exclusivos por bucket**. Um contato que recebeu resposta da IA E do humano no mesmo bucket entra só em "humano" (`ai = aiSet.size − humanSet.size`). Base: `Message.sentBy` em `["agent","human"]`.
- **`closed`** (leads fechados IA×humano): agendamentos **efetivados** (`status in ["scheduled","done"]`) criados no período, por `Appointment.source` — `"agent"` → IA, senão humano. Alinhado ao KPI "Agendamentos" desde 2026-08-11 — antes contava cancelado como fechado (ver CHANGELOG).
- **`funnel`**: Conversas (do período) → Leads engajados (leads criados no período com 2+ mensagens, capado no total de leads criados) → Leads quentes (status `hot`, dos criados no período) → Agendados (soma de `results.appts`). **Estado atual** dos leads que chegaram na janela — não há histórico de transição de status, então não é velocidade de funil.
- **`peakHours`**: mensagens `role: "user"` do período, uma célula por (dia da semana 0-6, hora 0-23), no fuso do painel.
- **`firstResponseTime`**: por conversa, a primeira mensagem `user` pendente vs. a primeira `assistant` seguinte, bucketado em faixas (`<1min, 1-5min, 5-30min, 30min-2h, +2h`), separado por `sentBy` (IA/humano). Um par por conversa — a segunda pergunta de uma conversa já respondida não conta de novo.
- **`autonomyRate`**: `{ current, previous }` — fração `ai/(ai+human)` da mesma base de `attendance`, resumida num número por período (atual e anterior).
- **`followUpRecovery`**: `{ sent, recovered }` — conversas com `followUpSentAt` no período (`sent`) e, destas, quantas tiveram uma mensagem `user` com `createdAt` depois do envio, **dentro do mesmo período** (`recovered`). Não olha além da janela selecionada — consistente com o resto do relatório.
- **`attendanceOutcome`**: agendamentos concluídos × cancelados, por bucket, base `createdAt`.
- **Deltas**: comparação contra a janela anterior do mesmo tamanho (`prevFrom/prevTo`).

### `computeFinancialSummary` (visão Financeira)

- **`closedLeads`**: agendamentos **efetivados** (`status in ["scheduled","done"]`) criados no período — mesma base do gráfico `closed` do Operacional.
- **`months`**: meses de calendário (fuso do painel) tocados pela janela, mínimo 1. "Hoje"/"7"/"30" dentro do mesmo mês → 1. Para `"tudo"`, ancora na **criação da conta** (`Tenant.createdAt`).
- **`investedCents`**: `priceCents × months`, onde `priceCents` é `Tenant.priceCentsOverride ?? planOf(tenant.planKey).priceCents` — o admin pode fixar o preço negociado da conta sem mexer no plano (que mudaria a cota junto).
- **`months` nunca começa antes da conta existir**: o início da janela é clampado em `Tenant.createdAt`. Sem esse corte, "últimos 30 dias" numa conta criada dia 09/09 tocava agosto E setembro e cobrava 2 meses de quem pagou 1 — o "Investido" ficava maior que a fatura e o ROI, menor que a realidade. Mês tocado conta **inteiro**, não proporcional aos dias: é o que a pessoa de fato pagou; ratear daria um ROI mais bonito que o extrato.
- **Valor por lead** (`TenantLeadValue`): entradas com vigência (`startsAt`). O valor usado é o **em vigor no início da janela** (`maior startsAt ≤ from`); sem nenhum até lá, usa o mais antigo (valor definido no meio de uma janela curta). `"tudo"` usa o valor **atual** (mais recente). **Criar nova vigência não recalcula períodos que já começaram**; correção explícita da vigência é a exceção descrita abaixo.
- **Editar × nova vigência (01/10/2026):** o modal do valor do lead abre com o
  valor exibido e oferece “Corrigir o valor exibido” (padrão quando existe) ou
  “Novo valor a partir de agora”. Correção atualiza `valueCents` da vigência
  escolhida, preservando `startsAt`: todos os períodos que usam essa vigência
  são recalculados. A data e esse efeito aparecem antes do salvar. Nova vigência
  preserva o contrato anterior. `FinancialSummary.valueId` identifica a linha;
  a action exige tenant e faz `updateMany` condicional por id/valor/data para
  impedir alteração entre contas ou sobrescrita concorrente. Ambas as opções
  registram auditoria, sem alterar `MonthlyRoiReport` ou snapshot aprovado.
- **`returnCents`**: `closedLeads × valuePerLeadCents` (null enquanto não há valor definido).
- **`roiPercent`**: `(retorno − investido) / investido × 100`, arredondado. `null` se `investedCents = 0` (Plano Grátis) ou sem valor definido.
- **`cumulative`** (`null` sem valor por lead): retorno acumulado × investido acumulado, por bucket. Investido é o total dividido em partes iguais pelos buckets — aproximação estimada (o plano é mensal, não por bucket).
- **`byAgent`** (`null` sem valor por lead): `closedLeads` agrupado por `Appointment.agentId` × valor por lead, maiores primeiro.
- **`breakEvenLeads`** (`null` sem valor por lead): `ceil(investedCents / valuePerLeadCents)`.
- **`monthly`** (`null` sem valor por lead): um ponto por mês de calendário tocado pela janela, `retorno do mês − investido do mês` (investido também dividido em partes iguais pelos meses).
- **`costPerLeadCents`**: `investedCents / closedLeads`, `null` sem fechamento no período.
- **`triage`** (bloco "O que o agente filtrou"): `screened` = leads com `disqualifiedAt` no período (`isTest: false`), carimbados pela tool `disqualify_lead`. `previousScreened` é a mesma contagem na janela anterior (delta). `byReason` agrupa por `disqualifiedReason`, maiores primeiro. `minutesSaved`/`savedCents` derivam de `TenantAttendanceCost` (vigência igual à do valor por lead: o custo em vigor no início da janela) e são `null` enquanto a clínica não declarar o custo — ver regra de ouro 7.

### Selo de ROI (FinancialView)

- `roi > 0` → badge `success` ("ROI +128%"); `roi < 0` → `danger`; `roi = 0` ou `null` → `neutral` ("ROI —").

## Armadilhas (já mordemos; leia antes de depurar)

1. **`prisma generate` falha no Windows se o dev server estiver rodando** — `EPERM` ao renomear `query_engine-windows.dll.node` (arquivo está com lock). Sintoma: a página que usa o modelo novo estoura `Cannot read properties of undefined (reading 'findMany')`, porque o client em memória é antigo. Solução: parar o dev server, rodar `npx prisma generate`, reiniciar o dev. (O `tsc` passa mesmo com o client desatualizado — os `.d.ts` regeneram, o `.js` não.)
2. **Modais**: o reset do Tailwind zera o `margin: auto` da UA que centralizaria o `<dialog>` nativo — todo **modal** precisa da classe `m-auto`. Drawers laterais (`MobileNav`, `Navbar` da landing) são ancorados **de propósito** (`mr-auto ml-0` / `m-0 ml-auto`), não "corrigir".
3. **Smoke test sem login**: `/relatorios*` responde **307 → /login** para requisição não autenticada — é o sinal de sucesso esperado (a página compila e o guarda roda). 200 só com cookie de sessão.
4. **CSV**: apenas na visão Operacional (o botão some em `?visao=financeiro`). Sem `?visao=` na URL da exportação — ela usa só `periodo/de/ate`.
5. **Mudança de schema**: o projeto usa `prisma db push` (sem migrations). Tabela nova = adicionar ao schema + push. Para mudanças destrutivas que precisam preservar dados, há precedente em `prisma/manual/001-multi-agente.sql`.
6. **Gráficos**: SVG puro/divs, sem biblioteca. `SeriesChart` usa `preserveAspectRatio="none"` + `non-scaling-stroke`; hover/foco vêm de `ChartTooltip`/`ChartHoverLayer` (o `<title>` nativo continua como reforço, não como única via).
7. **Fuso**: se um número de bucket parecer deslocado (ex.: "hoje" começando ontem à noite), é quase sempre um `new Date(y, m, d)`/`getFullYear()`/`Intl.DateTimeFormat` sem `timeZone` que voltou a usar hora do servidor — ver regra de ouro 6. Isso já aconteceu uma vez nesta seção; o server local é America/Sao_Paulo, então o bug só aparece em produção (UTC).
8. **Desqualificado ≠ perdido**: `Lead.disqualifiedAt` é "nunca foi cliente" (vendedor, trote, fora da área); `Lead.status: "lost"` é "era cliente e não fechou". Somar os dois apagaria justamente o que a triagem mede. O carimbo é sempre explícito (tool), nunca inferido do texto da conversa — a métrica vira dinheiro e um palpite ali é um número que o cliente confere e não bate.
9. **Contagem de leads**: toda contagem de negócio filtra `isTest: false`. O admin (`src/modules/admin/service.ts`) mostrava o total SEM esse filtro e divergia de /relatorios para a mesma conta; hoje o `_count` leva `where`. Se dois lugares mostrarem números diferentes, compare primeiro **janela** (a home usa 7/30 dias, o admin é histórico total) e depois `isTest`.
10. **Paleta**: nunca reordenar `CHART_LIGHT`/`CHART_DARK`/as variáveis `--chart-N` sem rodar `node scripts/validate_palette.js "<hex,...>" --mode light/dark` do skill dataviz de novo — a ordem atual (iris, warn, success, signal, violeta) foi escolhida especificamente para separar dois tons que ficavam indistinguíveis (ΔE abaixo do piso) na ordem antiga.

## Como estender

### Novo gráfico Operacional

1. Tipo + série nova em `computePeriodReport` (`service.ts`) — reuse o padrão de buscar timestamps com `select` estreito e bucketar em memória (não há `_lib`/SQL cru nesta seção).
2. Variante em `ChartPanel.tsx`: incluir em `Variant`, `DESCRIPTIONS`, `chart()`, `table()` e `sources()`.
3. (Opcional) seção nova no CSV em `export/route.ts`.
4. Posicionar o `ChartPanel` na `page.tsx`.
5. Se o gráfico usa cor categórica (mais de 2 séries por identidade, não por polaridade), usar `chartColor(index)` de `palette.ts` — nunca um hex novo (regra 8).

### Nova métrica Financeira

1. Campo em `FinancialSummary` + cálculo em `computeFinancialSummary`. Se depender do valor por lead, retornar `null` quando `effective` for `null` (nunca uma série de zeros — ver `FinancialView.tsx`, que já decide o estado vazio).
2. Render em `FinancialCharts.tsx` (lembrar: dinheiro → `formatBRL`, sempre "estimado").

### Toggle de visão

O toggle é `FilterTabs` (links, querystring) — preserva `periodo/de/ate` e seta `visao`. Qualquer novo valor de `visao` precisa entrar em `VIEWS` no `page.tsx`.

## Próximos passos sugeridos (não feitos)

- Investido por período real: hoje presume o plano **atual** para todo o período (não há histórico de assinatura no modelo). Se um dia existir `SubscriptionHistory`, trocar a base do `investedCents` (e de `cumulative`/`monthly`, que hoje distribuem o total em partes iguais).
- CSAT via `Feedback.rating` — computável hoje, ainda não está em nenhum relatório (é feedback do produto, não da operação do cliente — provavelmente um relatório à parte).
- Canal de origem do lead (WhatsApp × widget × manual): não existe campo hoje. Provavelmente o campo isolado de maior valor a acrescentar — habilitaria atribuição de canal em quase todo gráfico de leads/conversas.
- Histórico de status de lead (`Lead` não tem `updatedAt` nem log de transição): bloqueia velocidade de funil e "quantos viraram quentes esta semana". O funil atual é estado-no-momento por isso.

## Como rodar/verificar

### Revisão mensal de ROI

- Admin carrega a competência solicitada (`mes`); sem parâmetro, abre a última revisão existente da clínica, com fallback para o mês anterior, limitado ao cadastro. Um pedido anterior à criação abre o primeiro mês da conta, com aviso.
- Mensalidade ausente vem do preço negociado da conta ou do plano atual, com origem para conferência. Valores existentes e zero são preservados; snapshots fechados não são atualizados pelo preço atual.
- Importação oferece todos os agentes ou uma seleção persistida em `assumptions.agentIds`. Prévia de leitura, validada no servidor, carrega métricas atuais/anteriores e mantém correções manuais. O comparativo usa o mesmo escopo; não reaproveita totais de um snapshot de escopo diferente.
- Horários cadastrados de `schedule_meeting` aparecem como sugestão com origem; grades de agentes selecionados são unidas no mesmo fuso. A classificação depende da confirmação do expediente humano. Nunca importar horários padrão de configuração vazia nem inventar ticket/conversão/custo.
- O documento `MonthlyRoiReport.assumptions` conserva as premissas originais e guarda `metricOverrides: { current, previous }` como chave adicional. `parseMonthlyAssumptions` lê apenas premissas; `parseMonthlyOverrides` valida as correções separadamente. Isso é compatível com registros existentes, sem alteração de schema.
- Dados automáticos de mensagens, agenda e Clinicorp preenchem o editor. Só campos alterados viram correção persistente; restaurar um campo remove sua correção. Correções nunca passam para o próximo mês quando se copiam premissas.
- Cada contagem, tempo de resposta, horas assumidas, procedimento e pico pode ser corrigido. Receita/economia/ROI continuam derivados pela regra definida, sem permitir que uma porcentagem arbitrária substitua a fórmula. Presenças fora do expediente devem bater com a soma por procedimento antes do fechamento.
- O comparativo usa o snapshot fechado do mês anterior quando existir. Uma correção do comparativo é local à revisão atual. Reabrir uma revisão preserva os indicadores que estavam no snapshot; relatórios já enviados continuam preservados.
- `updatedAt` identifica a revisão carregada pelo formulário e protege contra sobrescrita concorrente. Correções entram na auditoria e no snapshot de fechamento; o painel e o PDF avisam quando existem ajustes manuais.
- PDF: imagens locais em `public/brand`, tinta preta/cinza (faixa escura só no título da página 1), A4 com resumo executivo + análise detalhada. Nunca depende de uma chamada externa para buscar logos ao exportar.
- **Fazer com I.A** na revisão administrativa em rascunho abre ajuda em `SidePanel`. Usa a cadeia e as credenciais de Admin → IA, explica campos e propõe preencher dados informados. `monthly-ai.ts` valida campos/unidades e mescla sugestões; `monthly-ai-service.ts` envia os agregados e a revisão atual e deixa a IA consultar os registros pelas ferramentas de leitura (`monthly-ai-tools.ts`), nunca com texto de conversa ou dado de paciente. `ai-actions.ts` exige SUPERADMIN, valida agentes do tenant e limita perguntas. As sugestões são aplicadas por botão, preservam os outros campos e precisam de **Salvar revisão**. Não alteram fórmula/publicação/presença; expediente sugerido perde a confirmação. Mudanças posteriores no formulário invalidam a sugestão. Contrato detalhado na P-79.

- Dev server: `npm run dev` (porta 3001).
- Typecheck: `npx tsc --noEmit`.
- Lint da seção: `npx eslint "src/app/(dashboard)/relatorios" "src/modules/reports" "src/components/charts"`.
- Paleta: `node scripts/validate_palette.js "<hex,hex,...>" --mode light` e `--mode dark` (script do skill dataviz) → espera **ALL CHECKS PASS** nos dois modos antes de mudar qualquer cor categórica.
- Smoke: `Invoke-WebRequest http://localhost:3001/relatorios -MaximumRedirection 0` → espera **307**.


### Conferência antes de enviar (01/10/2026)

Com o retorno financeiro ligado, `data.financialSummary` mostra parcelas
independentes: receita potencial desconhecida é `null`, economia só usa custo,
carga e **tempo por mensagem explicitamente informado**, investimento permanece
informado. O padrão visual de 30 segundos não valida economia. ROI completo
(`estimatedReturn`) exige todas as premissas e nenhuma avaliação fora do expediente
futura, não verificada ou sem classificação. Saldo economia − mensalidade é
**saldo operacional estimado**, nunca ROI total. Desligado, nenhum bloco aparece.
Zero de receita continua válido quando as premissas e a base estão completas.
Snapshots antigos são preservados: `monthlyFinancialPresentation` apenas suprime
ROI inseguro e reapresenta parcelas congeladas que têm premissas; nova conferência
requer reabrir e fechar uma nova versão. Não se consulta o banco na apresentação.

As novas quebras e taxas nascem na mesma passada do motor: chegada por dia da
semana/expediente (inclui pausas e datas fechadas), população única de contatos,
cobertura da amostra de cidades, respostas humanas em até uma hora e no prazo
`assumptions.receptionTargetMinutes` informado com a clínica. O denominador é
**todas as transferidas**, incluindo as sem resposta; o corte exclusivo fica em
`reception.countedUntil`. Sem meta cadastrada, uma hora é indicador, não SLA.
Snapshots sem as novas medidas não as recalculam nem presumem valores.

Painel/PDF têm a mesma ordem contínua: resultados, problemas/limitações, próximas
ações e financeiro opcional. Não se força uma página inicial vazia. Cada ação
pode registrar `reason`, o problema/resultado que a motivou. Alterações do agente
são registros conferidos na revisão: só aparecem com `date` e `purpose`; o texto
genérico de ajustes fica na revisão, não no documento v2. Data inválida ou fora
da competência é recusada. Datas aqui identificam ajustes do agente, nunca pacientes.

Exportar PDF fica no topo da revisão, em qualquer etapa; o rascunho exportado é
**a revisão salva**. O servidor continua imprimindo o mesmo documento com Chromium.
Se falhar, a página de impressão oferece **Salvar em PDF**, que abre o diálogo do
navegador (escolher o destino Salvar como PDF), sem precisar de Ctrl+P. A barra
fica fora do documento e não entra na impressão. Não há mudança de schema.
