# P-79 — Relatório mensal de ROI odontológico

Implementação do escopo mínimo solicitado para 30/09/2026. Primeira entrega ao
Instituto do Sorriso até 05/10/2026. Base: requisitos fornecidos na conversa;
a especificação citada no Obsidian não estava disponível.

## Modelo revisado (30/09/2026): todos os leads, tudo que é mensurável

Vale sobre o que este documento diz mais abaixo quando houver conflito. Regras
completas em `src/app/(dashboard)/relatorios/README.md` ("Modelo revisado").

- **Tudo que puder ser medido aparece.** **Todos os leads entram**, de dentro e
  de fora do expediente; a divisão por expediente é só um detalhe dentro de
  cada número. A regra conservadora (receita só de quem chegou fora do
  expediente) vale apenas no bloco opcional de retorno estimado.
- **Ordem do relatório**: frase do mês; contatos atendidos, avaliações
  agendadas (o número principal), compareceram e 1ª resposta do agente;
  01 Atendimento · 02 Agenda · 03 O que ajustamos no agente · 04 Qualidade dos
  leads · 05 O que não saiu como planejado · 06 Próximo mês · + Retorno
  estimado (opcional) · Como contamos.
- **Novo no relatório**: disponibilidade do agente (% no ar, quedas, contatos
  afetados), recepção (transferências respondidas x de y, mediana da 1ª
  resposta humana, espera acima de 1h, sem resposta), tempo devolvido
  detalhado, chegada pelo expediente cadastrado (nunca faixa fixa), motivo
  principal de não agendar (soma exata), ações do mês anterior com status e
  número, e os fatos do caso do mês (idade, áudios, dia da semana, período;
  nunca nome, telefone ou data).
- **Selo "estimativa" só no que é estimado**; número medido não leva selo.
- **"O que não saiu como planejado" aparece sempre**: sem incidente comprovado,
  diz "Nenhum incidente relevante identificado neste mês". Não é mais texto
  obrigatório, e a IA nunca inventa problema.
- **Arquitetura**: o motor de dados calcula e valida; a IA só redige a partir
  dos números validados; o PDF é gerado no servidor só com o conteúdo aprovado
  e versionado (cada fechamento é uma versão). Notas internas não entram.
- **Disponibilidade só existe a partir da implantação do registro de quedas**:
  meses anteriores saem como "não medida", com a limitação dita no relatório.
- **Não mudou**: agendadas pelo mês da marcação e realizadas pelo mês da
  consulta. O modelo de referência conta o comparecimento pela coorte das
  avaliações marcadas no mês; essa troca de definição ficou em aberto.

## Decisão de 30/09/2026: o que o relatório mede

O relatório mede o que o Fechai controla: **atendimento, agendamento e
comparecimento**. A métrica âncora é **avaliações agendadas e realizadas**. O
financeiro da clínica é do Clinicorp, não nosso.

- **Retorno estimado é opcional.** Receita, economia e ROI só aparecem quando
  ticket, conversão e custo do atendente estão preenchidos e confirmados (a
  chave "Retorno estimado" na etapa 2 do fechamento). Sem isso o bloco some do
  painel e do PDF: nada de "Pendente" nem de zeros.
- **Página 1**, nesta ordem: avaliações agendadas (dentro/fora do horário),
  comparecimentos, contatos atendidos e % fora do horário, primeira resposta
  (mediana); depois Atendimento, Agenda, O que ajustamos no agente, Qualidade
  dos leads, Próximo mês (até 3 ações) e O que não saiu como planejado (nunca
  vazio).
- **Fechamento**: premissa financeira ausente não é pendência nem limitação com
  o bloco desligado. Do Clinicorp só se exige o status de comparecimento.
- **Central de pendências**: "Ticket e conversão" (e custo da equipe e
  mensalidade) viram opcionais.
- **Aba Financeiro**: sem valor definido, fica só o convite.
- **Em aberto**: unificar "valor por lead" (aba Financeiro) e "ticket ×
  conversão por procedimento" (relatório mensal) numa premissa só. Hoje são
  dois modelos que não batem: o primeiro multiplica todo agendamento do período
  por um valor fixo; o segundo conta só avaliações realizadas de quem chegou
  fora do horário.

As seções abaixo descrevem o cálculo do retorno estimado, que continua valendo
quando o bloco está ligado.

## Operação mensal

1. Mavellium abre **Admin → ROI mensal**, seleciona o cliente e a competência.
2. Preenche os números levantados com a clínica (P-78): ticket e conversão de
   cada procedimento, custo mensal do atendente, carga mensal em horas,
   expediente humano e mensalidade. Declara também os minutos humanos por
   conversa usados para a estimativa de economia. Nada é preenchido com chute.
3. Confere a variável de procedimento, os tipos de avaliação e os status do
   Clinicorp que efetivamente comprovam realização. Status vêm de
   `/appointment/status_list`, vinculados pelo `StatusId`; o nome livre não
   é usado para inferir comparecimento. `CONFIRMED` não comprova realização.
4. Nos agendamentos históricos sem tipo, só habilita a classificação como
   avaliação depois de conferir. Essa decisão fica nas premissas do mês.
5. Escreve **O que ajustamos no agente**, até três **Próximas ações** (cada uma
   com responsável e indicador), **O que não saiu como planejado** (nunca vazio)
   e o nome do decisor. O **Resumo do período** é opcional e abre a análise detalhada.
6. Salva, confere o relatório e fecha após o término do mês. Pendências de
   dados e premissas **não bloqueiam**: o relatório pode fechar com cobertura
   parcial, desde que o admin confirme a lista de limitações (calculada pela
   mesma regra das pendências, mais histórico anterior à implantação, Clinicorp
   fora do ar, chegada sem horário e áudio sem duração). Os indicadores sem
   evidência continuam sem valor e são entregues como **não verificado**; nada é
   estimado no lugar. As limitações ficam explícitas no painel e em
   "Cobertura dos indicadores" no PDF, com aviso na página 1.
7. Visualiza o PDF, aprova, envia ao decisor e usa **Registrar envio ao
   decisor**. Depois da reunião curta, usa **Registrar reunião**.

A revisão é guiada em cinco etapas (importar e conferir, resolver pendências,
validar resultados, análise com IA, aprovar e entregar). Na quarta, a IA redige
o resumo do período, as limitações, as melhorias executadas e as próximas ações a partir de
agregados, do selo de cada número e do log de alterações do agente no mês; o
texto preenche a revisão não salva e a Mavellium confere antes de salvar.

O painel registra o envio e a reunião feitos pela equipe. Não há disparo
automático de e-mail/WhatsApp nem automação de apresentação. O cliente vê a
versão fechada em **Relatórios → ROI mensal** e pode baixar o mesmo PDF.
Rascunhos e a revisão das premissas são restritos ao superadmin.
A aba do tenant aparece somente quando existe uma publicação fechada com
snapshot. Abre a competência publicada mais recente e oferece apenas meses
disponíveis. Uma URL com competência indisponível exibe a última publicação;
sem publicações, a página permanece na visão Operacional.

### Listagem administrativa

`/admin/relatorios` lista contas ativas com usuário `OWNER` que utiliza o
produto. O card **Acompanhamento dos relatórios** tem o selo **Por clientes**,
sem contador, e quatro colunas: **Cliente**, **Data de entrada do cliente**,
**Revisão** e **Ação**. Todos os cabeçalhos são centralizados; nomes ficam à
esquerda e os demais valores, centralizados. A data de entrada vem de
`Tenant.createdAt`, exibida em `dd/mm/aaaa` no fuso `America/Sao_Paulo`.

Não há texto sobre prazo/reunião no cabeçalho da listagem nem colunas
**Entrega** e **Reunião**. Os registros de envio e reunião continuam na revisão
individual; a remoção da listagem não muda o prazo nem elimina o histórico.
Os estados são **Não iniciado**, **Em revisão** e **Fechado**; a ação é
**Revisar** ou **Ver relatório**, conforme a competência selecionada.

### Dados carregados e correções manuais

Na revisão individual, `mes=YYYY-MM` abre a competência pedida. Sem `mes`,
abre a última revisão existente do cliente; sem revisões, o mês anterior,
limitado ao mês do cadastro. Uma competência pedida anterior ao cadastro
abre o primeiro mês da conta e mostra um aviso. Assim, uma conta criada em
setembro não abre agosto vazio na primeira revisão.
O editor carrega as premissas salvas, os indicadores disponíveis de
mensagens/agenda/Clinicorp e as correções já registradas. O admin pode corrigir
os indicadores do mês e do comparativo: contatos, conversas/agendamentos/
comparecimentos dentro, fora e sem classificação de horário, tempo de resposta,
qualificados, transbordos, perguntas sem resposta, conversas exclusivas da IA,
horas assumidas, procedimentos e horários de pico. Há restauração por campo
para o dado carregado sem a correção da revisão atual.

As correções são guardadas em
`MonthlyRoiReport.assumptions.metricOverrides: { current, previous }`,
separadas das premissas na leitura, sem coluna ou tabela adicional. Só os
campos alterados viram correção; copiar premissas para outro mês não copia
correções. Contagens exigem inteiros não negativos; tempos e horas aceitam
decimais. Campos sem medição permanecem explícitos como ausentes.

Receita, economia e ROI são recalculados a partir dos indicadores e premissas,
sem edição direta dos valores derivados. A soma de avaliações realizadas fora
do expediente por procedimento deve bater com o total antes do fechamento.
O comparativo prioriza o snapshot fechado do mês anterior. Corrigir esse
comparativo não altera o relatório anterior; reabrir preserva os indicadores
e a base comparativa do snapshot da revisão reaberta. `updatedAt` protege
contra sobrescrita por uma revisão concorrente. Correções entram na auditoria
e no snapshot; a tela e o PDF identificam a existência de ajustes manuais.

### Componentes e PDF

A tela usa os componentes e tokens do painel: `PageHeader`, `Card`, `Badge`,
`DataTable`, `Field`, `Input`, `CurrencyInput`, `Switch` e `SelectMenu`.
`MonthPicker` compartilha menus de mês/ano e setas no admin; no tenant,
oferece apenas competências publicadas. A navegação protege alterações não
salvas. O retorno aparece antes da edição recolhível.

O PDF A4 abre com o **resumo executivo** (página 1: contatos atendidos,
conversas só com IA, mensagens respondidas, ROI estimado, resumo do período e
até três próximas ações com responsável e indicador) e segue com a **análise
detalhada** (dados de atendimento, funil, tempo devolvido, procedimentos,
ajustes, qualidade dos leads quando o mês tem leads —
[contrato](../qualidade-dos-leads/inteligencia-de-conversas.md) —, premissas, cobertura dos
indicadores e metodologia), que ocupa quantas páginas precisar.
Ele usa preto e cinza, com as imagens locais
`public/brand/fechai-black.png` e `public/brand/mavellium-black.png` no
cabeçalho. Não busca logos externamente durante a exportação. Origem dos
arquivos em [`public/brand/README.md`](../../../public/brand/README.md).

### Importação da conta e seleção de agentes

Mensalidade ausente é preenchida com `Tenant.priceCentsOverride` ou o preço
do plano atual (`planOf`), preservando zero e valores já salvos. A origem é
exibida para conferência da competência; não há histórico de preço do plano
para inferir uma cobrança antiga. Comparativos financeiros antigos sem
premissas não recebem o preço atual por aproximação. Publicações fechadas
continuam usando o snapshot.

**Importar dados da conta e dos agentes** permite todos os agentes ou uma
seleção de um ou mais agentes do próprio tenant, inclusive arquivados com
histórico. A seleção fica em `assumptions.agentIds`; ausente ou vazia conserva
o comportamento anterior de considerar a conta inteira. A prévia é de
leitura: carrega os indicadores sem gravar nem mudar o agente ou a agenda.
**Salvar revisão** persiste o escopo e recalcula o relatório. Correções
manuais são mantidas e devem ser conferidas para o escopo escolhido.

Conversas e eventos seguem o agente atualmente associado à conversa;
agendamentos seguem `Appointment.agentId`. A primeira chegada é preservada
mesmo se a consulta foi marcada por outro agente. Uma seleção explícita não
atribui registros sem agente conhecido. O mês anterior usa a mesma seleção;
snapshot/correções antigos de um escopo diferente não são usados como totais
da seleção menor. Os nomes dos agentes ficam no relatório e no PDF.

Os horários vêm da configuração cadastrada de `schedule_meeting`: grade
semanal ou formato antigo com dias, início/fim e pausas. Não importa horários
padrão de uma ação vazia. Para vários agentes, oferece a união dos intervalos
no mesmo fuso; fusos diferentes ou mais de quatro turnos em um dia exigem
definição manual. Uma grade ausente não é tratada como expediente conhecido.

A grade aparece como sugestão, com a origem visível, e só classifica
atendimentos dentro/fora após conferir **Horário humano conferido com a
clínica**. Horário de consultas pode diferir do expediente da recepção.
Ticket, conversão, custo e carga do atendente continuam pendentes quando não
cadastrados. Tipos da agenda não são automaticamente tratados como avaliações;
marcações antigas sem tipo e comparecimento seguem a conferência já descrita.

### Fazer com I.A

Na revisão em rascunho, **Fazer com I.A** abre uma conversa lateral com o
assistente. A pessoa pode perguntar o que cada campo significa, pedir ajuda
com as pendências, informar valores levantados com a clínica e pedir uma
redação para o próximo mês. A revisão atual, incluindo edições ainda não
salvas e a seleção de agentes, é usada como contexto.

O assistente resolve a cadeia e as credenciais de **Admin → IA**, incluindo
provedores personalizados e fallback. A resposta identifica o modelo usado.
Sem provedor disponível, mostra erro de configuração; não usa demonstração.
O consumo de tokens entra no uso da plataforma, sem criar mensagens de
atendimento ou consumir a cota de mensagens do cliente.

O contexto leva agregados, premissas e textos da revisão e os horários
estruturados dos agentes selecionados. Para perguntas sobre a composição de
um número, o assistente consulta os registros individuais por ferramentas
**somente de leitura** (agendamentos, conversas, eventos, linha do tempo de
uma conversa, configuração e integrações), no escopo do relatório, e mostra
as **evidências consultadas** anotadas pelo servidor. Não são enviados texto
de mensagens, nomes, telefones, prompts dos agentes ou segredos. Uma lista de
agendamentos para conferir com a recepção pode ser proposta, mas só aparece
depois da confirmação de quem está revisando.
O histórico da ajuda fica na tela, limitado a 12 mensagens, sem tabela nova.

Respostas estruturadas passam por validação de campos, unidades, limites e
listas. As sugestões mostram valor e motivo; **Preencher no relatório**
aplica apenas os campos listados. Tickets/conversões são mesclados por nome
do procedimento. As listas de indicadores/picos de um mês são substituídas
quando explicitamente sugeridas; a prévia mostra os dados antes de aplicar.
Os demais campos e correções manuais são preservados. **Salvar revisão**
continua sendo necessário para persistir e recalcular o relatório.

A IA não edita receita/economia/ROI diretamente, agentes selecionados,
classificação de marcações sem tipo, status Clinicorp ou publicação. Uma
sugestão de expediente retira a confirmação humana e precisa ser conferida.
Não pode aplicar sugestão se o formulário mudou depois da resposta. O servidor
exige SUPERADMIN, valida tenant/agentes, recusa revisão fechada, limita dez
perguntas por administrador/minuto e cancela a chamada após 60 segundos.
O prompt exige perguntar por números ausentes, sem inventar ticket, conversão,
custos, horas ou comparecimento; valores sugeridos continuam para revisão.

Arquivos: `MonthlyRoiAiAssistant.tsx`, `ai-actions.ts`,
`modules/reports/monthly-ai.ts` e `monthly-ai-service.ts`.

## Regra do ROI

Por procedimento:

`receita estimada = avaliações realizadas de contatos que chegaram fora do
expediente humano × conversão em basis points ÷ 10.000 × ticket em centavos`

A receita é somada por procedimento. A origem usa a **primeira mensagem do
contato, anterior à marcação**, nunca a hora da consulta nem a hora em que o
agendamento foi criado. Contato sem origem identificável não vira “fora”.

`horas devolvidas = (minutos de áudio ouvidos × 60 + (mensagens de texto +
áudios respondidos pelo agente) × segundos por mensagem) ÷ 3600`

Vale quando a premissa **tempo por mensagem** (leitura e resposta, ex.: 30 s)
está preenchida. Vazia — como em toda revisão anterior a ela —, continua a
estimativa por conversa:

`horas estimadas = conversas respondidas pela IA, sem resposta humana no mês
× minutos humanos declarados por conversa ÷ 60`

Uma correção manual de horas substitui as duas na competência e permanece
identificada como ajuste. A economia usa as horas resultantes, mantendo
custo/carga mensal declarados.

`custo/hora = custo mensal em centavos ÷ carga mensal em horas`

`economia estimada = horas devolvidas × custo/hora`

`ROI = (receita + economia − mensalidade) ÷ mensalidade`

Os valores são explicitamente estimados. Mensalidade zero não gera divisão
por zero: ROI percentual não se aplica. Conversão zero e custo zero são
premissas válidas. Ausência de premissas gera `null`/“Pendente”, nunca um
número financeiro inventado.

## Tempo que o Fechai devolveu para sua equipe

Origem: pedido do Vinícius (28/09/2026) — uma paciente de 74 anos mandou dois
áudios de 4min16s e 4min48s; sem o agente, a recepção teria de ouvir quase dez
minutos e adaptar a fala. Esse tempo e essa paciência passam a aparecer no
relatório, como estimativa com premissas visíveis.

- **Áudio ouvido:** soma da duração dos áudios do contato que o agente ouviu
  (transcritos) e respondeu no mês, com a quantidade acima de 2 minutos e o
  maior áudio. A duração vem da Evolution (`seconds` do payload) ou, na Meta,
  do arquivo OGG baixado pelo webhook (`Message.audioSeconds`). Áudio sem
  duração medida aparece como tal e entra só com o tempo de resposta.
- **Mensagens de texto respondidas pelo agente.** Uma mensagem é do agente
  quando a primeira resposta depois dela é da IA; se a equipe respondeu
  primeiro, o trabalho foi da equipe.
- **Horas devolvidas** e economia: fórmula na seção acima.
- **Duração dos atendimentos:** um atendimento começa na mensagem do contato e
  termina na última mensagem antes de 24h de silêncio. Média e mediana por
  resultado — agendou (agendamento feito pelo agente, não cancelado),
  transbordou (evento de transbordo), perdido (contato marcado como perdido
  hoje, no último atendimento; desqualificado não conta) e sem desfecho.
  **Até o agendamento:** média e mediana do tempo e das mensagens trocadas desde
  a primeira mensagem do atendimento. A duração é informativa: não entra no
  dinheiro e não tem correção manual; áudio, mensagens e horas têm.
- **Caso do mês:** texto opcional de até 240 caracteres escrito pela Mavellium
  só com o perfil genérico ("paciente de 74 anos"). O servidor recusa e-mail,
  sequência de 8+ dígitos e qualquer palavra do nome de um contato atendido no
  mês. O admin recebe como sugestão as conversas com áudios longos (para abrir
  com "Entrar como"); a sugestão não entra no snapshot nem no PDF, e a IA do
  editor não redige nem vê o caso.

Na tela o bloco vem logo depois do retorno. No PDF fica abaixo do quadro do ROI,
com a frase, os áudios, o tempo até agendar e o caso; ele substitui a linha
"Horas assumidas" da tabela (o mês anterior vai no próprio bloco) e a duração
por resultado fica no painel. Relatórios fechados antes do bloco continuam como
foram entregues. Áudios recebidos antes de 23/09/2026 não têm arquivo na CDN e
ficam sem duração: nada é reconstruído por estimativa.

## Fontes e limites da medição

- `Message`/`Conversation`/`Lead`: contatos novos atendidos pela IA, conversas
  com resposta do agente, primeira resposta média, mensagens por hora.
- Conversas entram uma vez por mês, classificadas pela primeira interação
  recebida/respondida na competência; a média inclui primeiras respostas
  humanas e da IA, um par por conversa no mês. Uma resposta na virada do mês
  pode corresponder a uma chegada no mês anterior.
- `Appointment`: avaliações criadas pelo agente; agendadas pela criação,
  realizadas pela data da consulta. Canceladas e marcações manuais não contam.
  `serviceType` registra o tipo escolhido em `schedule_meeting`; linhas antigas
  permanecem `null`, sem inferência do título/nome do paciente.
- Clinicorp: confirma presença dos agendamentos **vinculados pelo ID do
  espelho**, sem modificar a agenda local. Nunca associa paciente por nome ou
  telefone e nunca duplica o agendamento local com o espelho. Cancelamento
  externo prevalece; falha de leitura/ID desconhecido deixa presença pendente.
- Configuração do Clinicorp e resultado da consulta são separados:
  `clinicorpIntegrationState` identifica conexão cadastrada, ausência,
  desabilitação, credenciais ilegíveis ou configuração indisponível. Uma falha
  de `/appointment/list` não descarta os status válidos de `status_list` nem
  significa desconexão. O editor mostra o endpoint que falhou e o código HTTP,
  sem copiar o corpo da resposta externa. Importar novamente atualiza tanto
  o aviso quanto a lista de status. Uma lista vazia válida é diferente de erro.
  A consulta exige uma clínica selecionada e respeita `clinicorpEnabled`.
  Status disponíveis para seleção, sozinhos, não comprovam presença: falha
  da agenda ou IDs inseguros mantêm os agendamentos vinculados pendentes.
  Snapshots antigos sem esse metadado continuam legíveis e não são classificados
  automaticamente como desconectados.
- IDs string preservam 64 bits; números fora da precisão segura são recusados.
- `ReportEvent`: qualificação explícita (lead quente), transbordo e pergunta
  sem resposta. As ferramentas registram eventos idempotentes e o webhook
  registra assunção por reação. `report_unanswered` não ocupa vaga de
  habilidade e participa do loop normal de ferramentas; a geração do
  relatório não inicia chamadas de IA. Desde o P-87 a mesma tool também põe a
  pergunta na fila `/perguntas` e, se a conta escolheu "passar para a equipe",
  marca `needsHuman` e conta um transbordo — ver
  [P-87](../../atendimento/perguntas-sem-resposta/P-87-perguntas-sem-resposta.md).
- Tempo médio para a equipe responder (P-87): `answeredAt − firstAskedAt` das
  perguntas da fila aprovadas na competência, no escopo de agentes
  selecionado. Opcional no snapshot: fechamentos anteriores mostram "Sem
  registro". No PDF vai na célula de perguntas sem resposta.
- Todos os dados operacionais filtram tenant e excluem lead/conversa de teste.
- A implantação **não reconstrói** eventos que nunca foram registrados.
  `Tenant.reportTrackingStartedAt` declara o início da cobertura; contagens
  históricas são apresentadas como registros parciais, não como zero medido.
- O procedimento usa o valor explicitamente guardado na variável configurada
  da conversa ou no evento de qualificação. Valores sem correspondência nas
  premissas não recebem ticket/conversão por aproximação.
- Não há chamada de IA para produzir o relatório. Ajustes e plano são
  escritos/revisados pela Mavellium. P-86 (tráfego) fica fora; a fila P-87
  foi entregue à parte ([contrato](../../atendimento/perguntas-sem-resposta/P-87-perguntas-sem-resposta.md)) e só
  acrescenta o tempo médio de resposta a este relatório.

## Registros e qualidade de cada número

Cada indicador do painel abre os registros que o compõem (identificador,
horários, tipo, procedimento, status e o critério que o incluiu ou excluiu) e
carrega um selo: verificado, estimado, cobertura parcial, pendente ou
inconsistente. Os registros saem da mesma passada do cálculo e, com o selo,
ficam congelados no snapshot; o PDF leva o selo de cada linha e a legenda no
rodapé, nunca os registros. Correção manual que diverge dos registros aparece
como inconsistente. Regras em
[`relatorios/README.md`](../../../src/app/(dashboard)/relatorios/README.md), seção
"Registros e selo de qualidade de cada número".

## Histórico, revisão e autorização

`MonthlyRoiReport` é único por tenant + `YYYY-MM`. Premissas são mensais; editar
uma competência não altera outra. Uma competência nova oferece uma cópia das
últimas premissas anteriores, identificada na tela, que precisa ser conferida
e salva para este mês; nunca usa premissas de um mês futuro. Fechar salva um snapshot de métricas,
premissas e textos. O fechamento verifica `updatedAt` para não congelar uma
revisão concorrente. Reabrir é permitido antes do envio; relatório enviado
é preservado. Exportação e tela do cliente usam o snapshot, sem reconsultar o
Clinicorp. Alterações, fechamento, reabertura e entrega entram na auditoria.

As actions e rotas de exportação verificam autorização no servidor. O PDF do
cliente exige papel de produto, tenant ativo, competência fechada e usa apenas
o tenant da sessão, ignorando IDs forjados na query. PDF não inclui dados de
pacientes.

## Arquivos e implantação

- `src/modules/reports/monthly-config.ts`: validação e competências/fusos.
- `src/modules/reports/monthly.ts`: cálculo e carregamento.
- `src/modules/reports/monthly-overrides.ts`: validação das correções e
  recálculo dos valores derivados.
- `src/modules/reports/monthly-publication.ts`: competências publicadas e
  seleção do mês disponível no tenant.
- `src/modules/reports/monthly-import.ts`: preço da conta, competência inicial,
  leitura de grades cadastradas e união dos horários dos agentes.
- `src/modules/reports/events.ts`: registro explícito, best-effort e idempotente.
- `src/modules/reports/monthly-pdf.ts`: PDF com resumo executivo (página 1) e análise detalhada.
- `src/modules/reports/monthly-time.ts`: tempo devolvido, duração dos
  atendimentos, formatação, frase do bloco e checagem do caso do mês.
- `src/modules/voice/received-audio.ts`: duração do OGG e marcador de áudio
  não transcrito.
- `scripts/mede-audios-recebidos.ts`: mede os áudios já guardados na CDN
  (prévia por padrão, `--apply` para gravar).
- `src/app/(admin)/admin/relatorios/`: fila mensal, revisão, fechamento, entrega.
- `src/app/(admin)/admin/relatorios/[tenantId]/MonthlyMetricFields.tsx`:
  edição dos indicadores atuais e anteriores.
- `src/app/(admin)/admin/relatorios/[tenantId]/MonthlyAgentImport.tsx`:
  seleção de agentes e importação de prévia para conferência.
- `src/app/(admin)/admin/relatorios/[tenantId]/actions.ts`: gravação,
  fechamento, reabertura e registro de envio/reunião, com autorização.
- `src/app/(dashboard)/relatorios/MonthlyView.tsx`: resumo executivo (`MonthlyRoiSummary`) e análise detalhada.
- `src/components/ui/month-picker.tsx`: navegação entre competências.
- `src/components/ui/data-table.tsx`: tabela compartilhada; `headerAlign` e
  `columnAlign` permitem o alinhamento local sem mudar o padrão das outras telas.
- `scripts/check-monthly-roi.ts`: consulta de prontidão no banco configurado.
- `scripts/preview-monthly-roi.ts`: gera PDFs **fictícios** para inspeção visual.

O projeto usa `prisma db push` + `prisma generate`. Na implantação, regenerar o
client e reiniciar **web e worker**; não iniciar o worker em uma amostra de
teste que tenha números/compromissos reais. O novo client é necessário tanto
para `Appointment.serviceType` quanto para os eventos das tools.
As correções manuais em JSON, logos e ajustes de listagem não exigem nova
alteração de schema. A seleção de agentes também usa o JSON existente.
O tempo devolvido acrescenta `Message.audioSeconds` e
`MonthlyRoiReport.featuredCase`: `db push` + `generate` e reiniciar web e
worker; depois `npx tsx scripts/mede-audios-recebidos.ts` (prévia) e
`--apply` para medir o histórico desde 23/09/2026.

Validação: testes de fórmula, limites/fusos, presença, isolamento, autorização,
snapshot, concorrência e PDF A4 (página 1 com conteúdo máximo). Typecheck, lint e inspeção visual
dos PDFs de demonstração e de conteúdo máximo.

No banco local consultado em 27/09/2026, não havia tenant com “sorriso” no nome.
O relatório real do Instituto depende do cadastro/conexão no ambiente correto
e dos números do P-78; nenhum dado foi fabricado para a clínica.
