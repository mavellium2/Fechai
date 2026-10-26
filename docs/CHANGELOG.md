# Changelog

Uma linha por milestone concluído (mais recente no topo).

## Contexto de manutenção do painel — 2026-10-26

Documentação pela skill `module-docs`: seis arquivos em
[.claude/context/painel](../.claude/context/painel/_index.md), com contratos,
actions reutilizadas, consultas, padrões e histórico. Índices atualizados e
README de Agentes ampliado com o switch final à direita, preferências por
contexto, tipografia e limites da validação. Etapa só de documentação.

## Tema e legibilidade do painel — 2026-10-26

Menu do tenant com transição de largura e rótulos, entrada/saída da gaveta mobile
e preferência por movimento reduzido. Modo escuro disponível no menu, inclusive
recolhido e mobile, com preferência local persistida. Switch à direita substitui
"Ligado/Desligado", com sol no modo claro e lua no escuro; no menu recolhido o
ícone fica no thumb. Aviso de personificação com contraste nos dois temas;
títulos, filtros e indicadores com escala mais contida.
Corrigido `cn`: `tailwind-merge` agora reconhece `text-micro` como tamanho, evitando
que a cor remova o token e amplie a fonte em links e botões, inclusive do admin.
O admin usa a mesma casca, com preferência de tema e menu separada do tenant,
identificação compacta e rotas administrativas preservadas. Regressão em
`tests/ui-class-merge.test.ts`. Sem mudança de dados ou regras.

## Navegação do tenant e Agentes v5 — 2026-10-26

Casca clara exclusiva do tenant, menu principal recolhível e gaveta mobile;
Agentes passa a ter menu secundário, grade/lista de configurações, busca e painel
de detalhes. Editores e chat de teste reutilizam os componentes e actions atuais,
com proteção de rascunho e feedback por toast. Estados vazio/carregando/erro e
navegação por teclado nas abas. Demais páginas recebem a nova casca e preservam
sua organização. Sem alteração em API, regras de negócio, banco ou worker.
Mapa: [Agentes](../src/app/(dashboard)/agentes/README.md).

## Propostas de alteração do agente pelo MCP, parte C — 2026-10-24

Escopo `propose` (emitível em `/admin/agentes/mcp`): `propose_change` registra uma
proposta de mudança na persona do agente (campos e regras em `avoid`), com diff por
campo e por linha do prompt, e devolve o link de aprovação; `get_proposal` mostra a
situação. Nada é aplicado pelo MCP: a proposta fica `pending` até o superadmin
decidir em `/admin/agentes/propostas/[id]`, que mostra o diff e o prompt linha a
linha. **Aprovar** grava o agente e fecha a proposta na mesma transação (com
`via: mcp` na auditoria); **recusar** exige motivo e não muda o agente. Situações:
pendente, aplicada, recusada, vencida (7 dias) e desatualizada (o agente mudou desde
a proposta). Simular a proposta com `run_simulation` (`variant` `proposal`) exige
`simulate` e `propose`. A gravação de persona e regras do painel passou para
`applyPersonaAnswers` (`agent-engine/persona-apply.ts`), o mesmo núcleo da aprovação,
sem mudar o comportamento. Sem lista de propostas no admin e sem aviso ao superadmin:
a entrada é o link devolvido pela ferramenta e o evento `agent.change_proposed` em
`/admin/logs`. Schema novo (`AgentChangeProposal`): `db push` + `generate` nos dois
processos (web e worker). Testes: `tests/agent-mcp-propostas.test.ts`, com banco em
memória; concorrência, `count` e rollback reais ainda não têm teste de integração.
Card cmvml66o1000k01nx6krbddhi. Módulo:
[agent-mcp](../src/modules/agent-mcp/README.md).

## Simulação de conversa pelo MCP, parte B — 2026-10-24

Escopo `simulate` passa a ser emitível em `/admin/agentes/mcp` (sem variável nova).
`run_simulation` roda o mesmo motor do chat de teste (`runAgentTurn`, com cota,
agente desligado e agenda em simulação) numa conversa nova `isTest`, com telefone
sintético `mcp:`; `get_simulation` relê o transcript mascarado. Nada sai pelo
WhatsApp, não entra na cota nem nos relatórios. Limite de 30 turnos a cada 10
minutos por token (sem Redis, libera). Só a variante `current`; `proposal` e
`both` ficam para a parte C. A chamada pode levar vários minutos. Sem schema novo
nesta parte. Testes: `tests/agent-mcp-simulacao.test.ts` e
`tests/rate-limit-reserve.test.ts`. Card cmvml66jc000i01nxzn09h94r. Módulo:
[agent-mcp](../src/modules/agent-mcp/README.md).

## Acesso MCP do agente, parte A (leitura da configuração) — 2026-10-24

Servidor MCP em `POST /api/mcp` para uma ferramenta externa ler a configuração dos
agentes de **uma** conta, com token Bearer emitido pelo superadmin em
`/admin/agentes/mcp` (botão "Acesso MCP" em `/admin/agentes`). Só escopo `read`
pode ser emitido; ferramentas `list_agents` e `get_agent_config`. Conta sai do
token, nunca do argumento; token guardado só como sha256 e revogação vale na hora.
A leitura não consulta lead, mensagem, conversa, agenda nem credencial. Erros e
limites (401, 403, 413, 429) estão na tabela do README. Schema novo `McpToken`:
`db push` + `generate` nos dois processos (web e worker). Testes:
`tests/agent-mcp.test.ts`, `tests/autorizacao.test.ts` e `tests/toast-feedback.test.ts`
passam (118 casos). Card cmvml66er000g01nxtqmbgbhg. Módulo:
[agent-mcp](../src/modules/agent-mcp/README.md).
## Sistema de feedback retirado — 2026-10-24

Removidos o módulo `feedback/`, a página `/admin/feedbacks` (e o item de menu),
o formulário "Enviar feedback" em `/configuracoes` e a ação `markFeedback`.
Tabela `Feedback` e exportação LGPD mantidas: apagar as mensagens já gravadas
é decisão separada e irreversível. A entrada `admin.feedback_status` continua no
registro de auditoria para o histórico antigo ser lido.

## Simulação da agenda no chat de teste — 2026-10-24

No chat de teste, marcar, remarcar e cancelar consulta só validam e descrevem o que
aconteceria: não gravam `Appointment` e não espelham no Clinicorp, Google ou iCloud.
A simulação não reserva horário; conflito, expediente, antecedência e confirmação do
cliente seguem sendo checados. WhatsApp e widget seguem gravando normalmente. Sem
schema, variável de ambiente ou flag: vale para `/api/sandbox` e o chat de teste de
`/conversas`. Testes: `tests/agendamento-simulacao.test.ts` (10 casos). Card
cmvml66yp000m01nx96cjcq4h, commit 09d465b. Contexto: [scheduling](../.claude/context/scheduling/_index.md).

## Aceite dos riscos da Evolution antes de ativar — 2026-10-09

Modal obrigatório nas confirmações QR do Clinicorp: riscos da conexão não
oficial, checkbox e nome do responsável. Só ativa após validação/gravação de
usuário/data/texto/versão no servidor; cancelar mantém desligado. Sem prova
íntegra atual, flag antiga não libera envio. Audit não reversível, sem schema
novo. Interface real verificada em desktop/mobile com servidor simulado;
**1.644 testes**, lint e build passaram. Aceite não elimina risco de bloqueio.
Publicação `ad77741` concluída; proteção dos termos, SQL e resposta no sandbox
passaram em produção. QR permanece desligado sem aceite da clínica; nenhum
WhatsApp real foi enviado. Resultados: [plano](plans/2026-10-09-confirmacoes-avaliacoes-clinicorp.md).

## Confirmações Clinicorp pelo QR, agenda e teste — 2026-10-09

QR opcional para categorias autorizadas por ID, confirmação manual na agenda,
claim SQL comum às duas filas e recibos de entrega. Envio incerto não repete;
envio aceito não é entrega comprovada. Botão adiciona a mensagem ao sandbox.
Mensagem manual fora do painel exige “Já enviei pelo WhatsApp”.
Schema aditivo: ReminderDispatch/ReminderReceipt; db push/client aplicados
na imagem compartilhada web/worker. **1.619 testes**, lint/build e SQL isolado
passaram. SQL real e resposta do agente no sandbox passaram após a publicação;
nenhum WhatsApp real foi enviado. QR permanece desligado até declaração da clínica.
Publicação/teste registrados no [plano](plans/2026-10-09-confirmacoes-avaliacoes-clinicorp.md).
Contexto: [scheduling](../.claude/context/scheduling/_index.md).

## Bitrix24: CRM e agendamentos por conta — 2026-10-08

Conexão em **Integrações → CRM**, com webhook próprio cifrado. Envio Fechai →
Bitrix24 Cloud: contatos, leads (negócios no CRM simples) e reuniões no calendário
do responsável. Remarcação atualiza; cancelamento mantém registro e observações.
Fila durável, isolamento por tenant/destino e conferência de criações incertas.
Sem importação ou leitura de vagas.

**Schema:** BitrixIntegration, BitrixSyncJob, Lead.updatedAt e índices;
`db push` + `generate` aplicados em produção, imagem compartilhada por web/worker.
**Validação:** 1.582 testes, build e smoke PostgreSQL com REST simulado passaram.
Envio ao portal real depende de webhook cadastrado pelo cliente.
Contexto: [bitrix](../.claude/context/bitrix/_index.md);
contratos e limites: `src/modules/bitrix/README.md`.

## Relatório mensal: modelo revisado (todos os leads, tudo que é mensurável) — 2026-10-01

Decisões do Vinícius (30/09). Regras em `src/app/(dashboard)/relatorios/README.md`
("Modelo revisado" e "PDF e painel: a ordem do relatório").
**Schema:** `WhatsappIncident`, `Tenant.uptimeTrackedSince`,
`MonthlyRoiReport.previousActions`, `caseFacts` — `db push` +
`generate` na web e no worker.

- **Todos os leads entram**, de dentro e de fora do expediente; a divisão é um
  detalhe de cada número. Receita só de quem chegou fora do expediente vale
  apenas no bloco opcional de retorno estimado.
- **Recepção**: transferências respondidas (x de y), mediana da 1ª resposta
  humana, espera acima de 1 hora e sem resposta no fim do mês.
- **Disponibilidade do agente**: % no ar, quedas e contatos afetados, a partir
  das quedas que o monitor de saúde passou a registrar. Mês sem medição sai
  como "não medido", nunca 100%.
- **Tempo devolvido detalhado** e **selo "estimativa" só no que é estimado**.
- **Horário pelo expediente cadastrado**, nunca por faixa fixa.
- **Motivo principal de não agendar**: um por lead, somando exatamente os que
  não agendaram.
- **Ações do mês anterior** no topo de "O que ajustamos", com funcionou /
  parcial / não funcionou e o número que comprova; fechar exige a avaliação.
- **Caso do mês** com idade, duração de cada áudio, dia da semana e período,
  lidos da conversa escolhida; data exata é recusada no texto.
- **"O que não saiu como planejado" aparece sempre** e deixou de ser texto
  obrigatório: sem incidente comprovado, diz "Nenhum incidente relevante
  identificado neste mês". A IA não inventa problema.
- **PDF** refeito no modelo novo, fluindo em várias páginas, gerado no servidor
  só com o conteúdo aprovado (`approvedDocument`) e com a versão do fechamento
  no rodapé. O PDF da clínica sai só do snapshot aprovado.
- **IA só redige**: recebe as frases e tabelas validadas pelo motor de dados, e
  número fora delas é apontado para conferência.

## ROI mensal: decisor (dono) separado do contato operacional — 2026-10-01

**Schema:** `Tenant.ownerNames`, `MonthlyRoiReport.operationalContact`.

- O decisor é escolhido entre os donos e sócios da conta (lista mantida na
  etapa 4); a recepção vira "contato operacional" e recebe cópia.
- Fechar e registrar o envio recusam decisor vazio, fora da lista ou igual ao
  contato operacional.

## ROI mensal: âncora na agenda e bloco financeiro opcional — 2026-10-01

Decisão de 30/09 (Vinícius). Regras em `src/app/(dashboard)/relatorios/README.md`
("O que o relatório mede e o bloco financeiro opcional"). Sem schema novo
(`financialEnabled` mora em `assumptions`).

- O relatório mede atendimento, agendamento e comparecimento; a âncora é
  **avaliações agendadas e realizadas**.
- **Receita, economia e ROI são opcionais**: sem o retorno estimado ligado e
  calculado, o bloco some do painel e do PDF — nada de "Pendente" nem de ROI
  negativo só com a economia.
- **Página 1**: agendadas (dentro/fora), comparecimentos, contatos atendidos e
  % fora do horário, primeira resposta (mediana); depois Atendimento, Agenda,
  O que ajustamos, Qualidade dos leads, Próximo mês e **O que não saiu como
  planejado**, que nunca fica vazio.
- **Fechamento**: premissa financeira ausente não é pendência nem limitação com
  o bloco desligado; na central, ticket, equipe e mensalidade viram opcionais.
- Conta sem Clinicorp deixou de ganhar a limitação "agenda não pôde ser lida".
- Aba Financeiro: sem valor do lead, só o convite.

## ROI mensal: fechamento guiado, cobertura parcial, IA que investiga e resumo executivo — 2026-09-30

Regras em `src/app/(dashboard)/relatorios/README.md` ("Assistente de fechamento",
"Assistente que investiga os registros", "PDF: resumo executivo + análise detalhada").
**Schema:** `MonthlyRoiReport.highlights`, `limitationsNote`, `nextActions` — `db push` + `generate` na web e no worker.

- **Fechamento em 5 etapas** no admin: importar e conferir, resolver pendências,
  validar resultados, análise com IA, aprovar e entregar (com prévia do PDF).
  Um formulário só; nenhuma etapa trava a outra.
- **Fecha com cobertura parcial**: pendência vira limitação explícita
  (`monthly-limitations.ts`), confirmada pela lista exata que o admin viu. Número
  sem evidência sai como **"não verificado"**, nunca estimado no lugar.
- **Análise com IA** redige resumo do período, limitações, melhorias executadas
  (só com alteração registrada no agente) e até 3 próximas ações; é rascunho.
- **Assistente com ferramentas só de leitura** (`monthly-ai-tools.ts`):
  agendamentos, conversas, eventos, linha do tempo de uma conversa, configuração
  e integrações, da mesma passada dos números, sem texto nem dado de paciente.
  Mostra as evidências consultadas; lista de conferência só com confirmação.
- **PDF e painel**: página 1 = resumo executivo (4 números, resumo do período,
  próximas ações com responsável e indicador); análise detalhada nas páginas
  seguintes, que fluem. Acabou o teto de uma página.

## WhatsApp: Evolution (QR) e API oficial da Meta conectadas ao mesmo tempo — 2026-09-29

Regras em `src/modules/whatsapp/README.md` ("Duas conexões ao mesmo tempo").
**Schema:** `db push` + `generate` na web e no worker.

- **Conta com a Meta liberada tem dois cartões em `/integracoes`** — Número por
  QR code e API oficial da Meta —, cada um com o próprio estado, credenciais e
  "Desconectar". Conectar uma não derruba a outra; sumiu o seletor de provedor e
  o "desconecte o número atual primeiro". Pausar o agente, ignorar grupos e a
  lista de bloqueados ficaram num cartão de Atendimento, porque são da conta.
- **Uma linha por provedor** (`WhatsappInstance @@unique([tenantId, provider])`)
  e `Conversation.whatsappProvider`: por qual número o contato falou por último.
- **Respostas, follow-ups, lembretes, resposta manual e retomada de perguntas
  saem pelo número em que o contato escreveu**, e com esse número fora do ar
  esperam — nunca trocam de número (pelo QR seria primeiro contato; na Meta, texto
  livre fora das 24h é recusado). Grupos continuam só no QR, Disparos só na Meta.
- **Lembretes do Clinicorp** escolhem por paciente: quem já conversou pelo QR
  recebe o texto por lá; os demais, o template pela Meta.
- **Saúde por conexão**: o silêncio é sinal só do QR; o monitor nunca religa uma
  Meta desconectada (antes o token válido a colocava de volta no ar); o e-mail de
  alerta diz qual conexão caiu.
- Admin: filtro de WhatsApp por estado da conta (qualquer conexão de pé =
  conectada), recolher a Meta desconecta só a linha Meta, excluir a conta
  desconecta as duas, exportação lista todas as conexões (`version: 2`).
- **Ao subir (schema antes do código):** o `db push` troca o índice único de
  `tenantId` por `(tenantId, provider)` e cria `Conversation.whatsappProvider`,
  sem perda de dados — mas o Prisma **recusa** o `db push` puro do `deploy.sh`
  ("unique constraint ... will be added"; o aviso é falso aqui, o índice novo é
  superconjunto do antigo). Aplique antes o SQL equivalente e o `db push` seguinte
  não acha mais nada a fazer:
  `DROP INDEX "WhatsappInstance_tenantId_key"; CREATE UNIQUE INDEX
  "WhatsappInstance_tenantId_provider_key" ON "WhatsappInstance"("tenantId",
  "provider"); ALTER TABLE "Conversation" ADD COLUMN "whatsappProvider" TEXT;`
  (ou `db push --accept-data-loss`, que aceita **todo** aviso pendente do diff).
  Por poucos segundos, o container antigo falha ao conectar WhatsApp (o `upsert`
  dele depende do índice que sai). Use números **diferentes** nas duas conexões.

## Agenda com o Clinicorp: consultas de lá, ao vivo e com lembrete — 2026-09-28

Decisões em [ADR-005](./decisions/ADR-005-agenda-clinicorp.md); regras em
`src/modules/scheduling/README.md`.

- **Consultas marcadas direto no Clinicorp aparecem na `/agenda`**
  (`listClinicorpAgenda`): só leitura, sem importar para o banco, mescladas ao
  calendário e à lista do dia, com paciente, profissional, telefone e
  observações. O que o fechai já espelhou aparece uma vez só. Falha vira aviso
  na tela, nunca calendário vazio em silêncio.
- **Ao vivo**: a tela pergunta a versão do mês a `/api/agenda/pulso` a cada
  15 s (e na hora ao voltar para a aba) e só se refaz quando algo mudou —
  inclusive o que o agente marcou no WhatsApp. Botão **Atualizar** e indicador
  "Ao vivo · atualizado às…". Pausa com um diálogo aberto, para não perder o
  formulário.
- **Troca de mês e de dia rápidas**: prefetch completo dos meses vizinhos,
  streaming (a página sai com o banco; o Clinicorp entra depois num
  `<Suspense key={mês}>`), meses vizinhos aquecidos com `after()`, cache de
  30 min revalidado pelo pulso, dia clicado acende na hora (`LinkPendingHint`).
- **Lembretes para os pacientes do Clinicorp** (worker, fila
  `clinicorp-reminders`, a cada 5 min): mesmas regras de tempo dos lembretes do
  fechai; pela **Meta só com template aprovado** (escolhido em Agentes ›
  Agendar horário › Lembretes, com variáveis e prévia); pelo **Evolution nunca
  primeiro contato**. Bloqueados, "pediu para parar", telefone inválido e
  consulta espelhada ficam de fora; envio incerto pela Meta não é repetido;
  remarcar no Clinicorp reabre os disparos. A `/agenda` mostra "lembrete
  enviado".
- Schema: `ClinicorpReminder` (`db push` + `generate` na web e no worker).
  Env nova, opcional: `CLINICORP_REMINDER_SCAN_EVERY_MINUTES` (padrão 5).

## Perguntas sem resposta (P-87) — 2026-09-28

- Regra dura no prompt de todo turno: o agente não inventa informação do
  negócio; o que não está na base vira `report_unanswered({ question })` e
  "vou confirmar com a equipe". Aviso extra quando a base não tem trecho perto.
- Fila em **Perguntas** (`/perguntas`): agrupada por texto e por vetor, com
  trecho da conversa, quem perguntou, datas e contagem por contato. Responder,
  salvar rascunho, aprovar (vira documento na base do agente), descartar.
- Transbordo pela regra da conta: seguir atendendo (padrão) ou passar para a
  equipe (`needsHuman` + grupo da transferência).
- Retomar quem perguntou com a resposta aprovada: opcional, uma vez por
  contato, respeitando janela (24h Meta, 7 dias QR), bloqueio, "pare" e
  resposta humana já dada; não pausa o agente.
- Avisos pelo worker: na hora e resumo diário, por e-mail e/ou grupo interno,
  sem dado do contato. Resumo da Mavellium por `KNOWLEDGE_GAPS_ADMIN_EMAIL`.
- `/admin/perguntas`: quem responde cada fila (clínica, Mavellium ou as duas)
  e resposta pela Mavellium com nome, telefone e conversa mascarados (LGPD).
- ROI mensal: tempo médio para a equipe responder; tela mostra a tendência de
  perguntas sem resposta nos últimos seis meses.
- Schema: `KnowledgeGap`, `KnowledgeGapOccurrence`, `KnowledgeGapSettings`
  (`db push` + `generate` na web e no worker).

## ROI mensal: assistente Fazer com I.A — 2026-09-28

- Botão **Fazer com I.A** na revisão administrativa abre conversa em
  `SidePanel`, usando os componentes e o provedor configurado no sistema.
- Explica campos, pendências e a fórmula; sugere preenchimentos com valores
  informados pelo administrador e dados agregados da revisão não salva.
- Sugestões validadas aparecem com origem/motivo antes de aplicar. Atualiza
  apenas campos listados, preserva os demais e exige salvar a revisão depois.
- Não altera fórmula, publicação, seleção de agentes ou confirmação de
  comparecimento. Expediente sugerido precisa ser conferido como humano.
- Usa a cadeia/credenciais de Admin → IA, fallback, consumo de tokens e
  cancelamento em 60 segundos. Não envia conversas de pacientes nem gera
  mensagens que consumam a cota do tenant.
- Guarda SUPERADMIN, escopo de tenant/agentes, limite de perguntas e proteção
  contra aplicação de sugestão depois que o formulário mudou.

## ROI mensal: dados da conta e importação por agente — 2026-09-28

- Corrigida a competência inicial de contas novas: nunca abre mês anterior
  ao cadastro; ao ajustar uma competência pedida, explica o motivo na tela.
- Mensalidade ausente recebe preço negociado ou plano atual, mantendo zero,
  premissas salvas e publicações congeladas. Origem visível para conferência.
- Seleção de um ou mais agentes do tenant, prévia sem gravação e escopo mensal
  persistido no JSON existente. Indicadores e comparativo seguem a seleção;
  snapshots de escopo diferente não fornecem totais da seleção menor.
- Sugestão de expediente pela grade cadastrada dos agentes, com pausas e
  minutos preservados, união no mesmo fuso e conferência explícita do horário
  humano. Configuração vazia não importa um horário padrão.
- Correções manuais são preservadas. Tipos de avaliação, comparecimento,
  ticket/conversão/custo continuam exigindo seus dados e conferências.
- Contrato, limites e arquivos: [P-79](./P-79-relatorio-mensal-roi.md).

## ROI mensal: revisão, edição manual, PDF e listagem por cliente — 2026-09-28

- Revisão administrativa carrega a competência e os dados existentes, com
  correções manuais dos indicadores atuais e anteriores, restauração por campo,
  auditoria e proteção contra sobrescrita concorrente. Receita/economia/ROI
  continuam derivados das premissas; correções ficam no JSON existente.
- Comparativo prioriza o snapshot anterior; reabertura preserva indicadores e
  base comparativa. Relatórios enviados continuam preservados.
- Componentes e tokens do painel no editor e no seletor de competência.
  No tenant, a aba ROI mensal e o seletor aparecem apenas com publicações
  fechadas, oferecendo somente competências disponíveis.
- PDF A4 de uma página, preto/cinza, com logos locais do fechai e da Mavellium.
- Listagem administrativa **Por clientes**, sem contador nem texto sobre
  prazo/reunião. Cabeçalhos centralizados; Entrega/Reunião substituídas por
  Data de entrada do cliente, baseada em `Tenant.createdAt` no fuso de Brasília.
  Registros de envio e reunião permanecem na revisão individual.
- Último ajuste de listagem validado visualmente com dados fictícios no banco
  isolado, checagem de tipos e lint. Este registro não confirma implantação
  em produção nem entrega do relatório real do Instituto do Sorriso.
- Regras e operação: [P-79](./P-79-relatorio-mensal-roi.md).

## Prioridade: aviso no grupo interno sem incluir o lead — 2026-09-27

- Corrigida a transferência para humano: o grupo configurado recebe um aviso
  com `Nome:`, `Número:` e `Resumo:`. O lead nunca é adicionado ao grupo.
- O aviso reusa o resumo salvo e acrescenta o motivo da prioridade; sem resumo,
  usa falas recentes do contato, sem uma chamada adicional de IA.
- Configurações antigas com `addToGroup` preservam grupo, nome e motivo como
  notificações (`notifyGroup`). Tela e descrição da habilidade foram atualizadas.
- Removida a inclusão de participantes dos adapters. A tool notifica na
  transição para prioridade; repetir a chamada não repete o aviso.
- Validação local: simulação confirmou uma mensagem e participantes inalterados;
  suíte com 710 testes, checagem de tipos e lint dos arquivos alterados passaram.
- **Implantação pendente:** a validação foi local; este registro não confirma
  publicação em produção nem intervenção no grupo real.
- Contratos, formato e proteções: [agent-engine/README.md](../src/modules/agent-engine/README.md#transferir-para-humano-e-o-grupo-do-whatsapp-handoffts).

## Disparos pela API oficial da Meta — 2026-09-27

- Página `/disparos` visível apenas para contas do produto com Meta liberada,
  com a mesma proteção no servidor para URL direta e todas as actions.
- Importação Excel `.xlsx`/JSON com validação por linha, deduplicação, modelos
  para download e revisão das mensagens personalizadas antes da confirmação.
- Templates aprovados de texto da própria conta Meta, variáveis posicionais
  no corpo, rascunhos retomáveis, cancelamento e resultado por destinatário.
- Fila persistida no banco e processada pelo worker existente; bloqueados e
  pedidos para parar são ignorados, envios incertos não são repetidos.
- Pausa/retomada, agendamento com fuso/faixa diária, distribuição por tenant e
  diagnóstico do serviço. Desconexão preserva destinatários pendentes.
- Entrega/leitura/falha via recibos assinados, inclusive retornos antecipados;
  webhook processa lotes inteiros e deduplica textos e áudios.
- Associação de colunas, envio de teste explícito, busca/filtros/paginação/CSV,
  confirmação com autor e aviso de envios recentes.
- Respostas, oportunidades e agendamentos com atribuição documentada de sete dias.
- Requer `prisma db push` para as novas tabelas e atualização do web/worker.
  Regras e limitações: [broadcasts/README.md](../src/modules/broadcasts/README.md).

## Portabilidade de agentes e laboratório administrativo — 2026-09-20

- **Duplicar e transportar agentes:** o dono pode duplicar um agente, exportar
  um pacote versionado `.fechai-agent.json` e importá-lo em outra conta. Persona,
  regras, comportamento, configurações das habilidades e documentos do Cérebro
  são recriados; conversas, contatos e agendamentos ficam fora.
- **Réplica entre empresas:** `/admin/agentes` permite ao superadmin escolher um
  agente de origem e uma empresa de destino. Toda cópia nasce desligada e não
  principal, respeita os limites do plano e entra na trilha de auditoria.
- **Voz e Cérebro isolados:** vozes do catálogo são portáveis; voz gravada não é
  compartilhada. Documentos são ingeridos novamente para gerar chunks e
  embeddings ligados ao novo agente.
- **Banco de laboratório:** `npm run test:db:prepare` cria/sincroniza o banco
  lógico `saas_test`, e `npm run dev:test` abre o app isolado na porta 3002. O
  script recusa a URL de produção e nomes que não indiquem teste.
- **Laboratório na VPS:** `docker-compose.test.yml` cria Postgres, Redis, volume
  e app próprios; `deploy-test.sh` aplica schema/seed somente nessa stack. O
  workflow manual **Deploy Laboratório** impede que um push de produção ligue
  integrações ou recrie o ambiente de testes sem intenção.
- **Deploy esclarecido:** push para `main` recria web/worker, mas não cria outro
  Postgres, não transporta `saas_test` e não roda `prisma db push` sozinho.

## Triagem de contatos, investido correto e preço por conta — 2026-09-17

O agente passou a encerrar sozinho quem não é cliente em potencial, e o
relatório financeiro passou a mostrar o que a conta de fato pagou.

- **Triagem (`disqualify_lead`)**: nova habilidade do agente. Vendedor, trote,
  currículo ou contato fora da área atendida são encerrados com educação, sem
  entrar na fila de ninguém. O carimbo mora em `Lead.disqualifiedAt` +
  `disqualifiedReason`, **não** em `status: "lost"` — "nunca foi cliente" e "era
  cliente e não fechou" são perguntas diferentes, e somá-las apagaria justamente
  o que a triagem mede. O handler mantém o primeiro carimbo (contato que volta
  não entra no relatório de dois meses) e não marca `needsHuman`, que seria o
  oposto do objetivo.
- **Economia estimada** em /relatorios (visão Financeira): contatos filtrados ×
  custo do atendimento manual, declarado pela clínica em `TenantAttendanceCost`
  (minutos + custo/hora, com vigência, igual ao valor por lead). Sem a régua
  declarada, tempo e dinheiro vêm `null` e a UI convida a definir — nunca uma
  média do sistema apresentada como fato, porque o cliente confere esse número
  contra a própria folha de pagamento.
- **"Investido" corrigido**: os meses cobrados agora são clampados em
  `Tenant.createdAt`. Uma conta criada em 09/09, vista em 17/09 na janela de 30
  dias (que começa em 19/08), cobrava 2 meses de plano de quem tinha 8 dias de
  vida — R$ 398,00 em vez de R$ 199,00, inflando o investido e afundando o ROI
  do cliente. Mês tocado segue contando inteiro (é o que se paga); ratear daria
  um ROI mais bonito que o extrato.
- **Preço por conta** (`Tenant.priceCentsOverride`, editável em /admin/contas):
  override só do VALOR, para desconto negociado ou cortesia, sem trocar o plano
  (que mudaria a cota junto). Mesmo desenho de `messageLimitOverride`. Zero é
  cortesia legítima, por isso a resolução usa `??` e não `||`.
- **Contagem de leads unificada**: o admin contava leads e conversas **sem**
  filtrar `isTest`, e divergia de /relatorios para a mesma conta (108 × 90) sem
  que desse para saber qual estava certo. O `_count` agora leva `where`. A
  diferença que resta entre home e relatórios é só de janela (7 × 30 dias).

## Programa de afiliados: comissão progressiva e papéis da conta — 2026-08-30

Programa de indicação completo, com landing pública, painel próprio e comissão
**recorrente** — o afiliado ganha em toda mensalidade paga pela conta indicada,
não só na primeira compra. Junto veio a separação dos papéis da conta: usar o
produto e afiliar passam a ser escolhas independentes.

- **Comissão progressiva** (`COMMISSION_TIERS` em `modules/affiliates/config.ts`):
  5% na entrada, 10% com 5+ vendas ativas, 15% com 25+, 20% com 100+. Vale para
  qualquer plano, e subir de faixa vale para a **carteira inteira**, não só para
  as vendas novas. "Venda" é `Referral` `CONVERTED` — quem cancela sai da
  contagem, então o nível reflete a carteira viva (a mesma base do MRR do
  painel). A venda que fecha a faixa já entra na taxa nova.
- **A comissão nasce em `invoice.paid`**, não no checkout: é o único evento que
  dispara em toda renovação, e só depois de o dinheiro entrar. Base é
  `amount_paid` (não o preço de tabela), idempotência por `stripeEventId`, e
  estorno escuta `credit_note.created` — só a nota de crédito diz qual fatura
  foi revertida. O percentual é **copiado** para cada linha: mudar a regra não
  reescreve o que já foi ganho.
- **Crédito first-touch e único**: `Referral.tenantId` é `@unique`, e o cookie
  (30 dias, gravado no `proxy.ts`) não é sobrescrito por um segundo link. O
  clique é contado por `/api/afiliados/clique`, não pelo proxy — que roda também
  em prefetch e inflaria a métrica.
- **Papéis da conta.** "Cliente" virou `User.usesProduct` (default `true`, para
  contas antigas não perderem o painel); "afiliado" é existir `Affiliate` ativo.
  Os dois são escolhidos no `/cadastro` e alteráveis em `/configuracoes`, com a
  regra de **pelo menos um sempre ativo**. `getAccountRoles()` é a fonte única.
- **Conta só-afiliado vê um painel enxuto**: sem Agentes/Conversas/WhatsApp/
  Agenda, sem onboarding, sem indicador de cota e **sem "7 dias grátis"** — o
  trial é de mensagens da IA, que essa conta não gasta. `/relatorios` abre na
  visão de afiliados e `/planos` redireciona. As rotas do produto são guardadas
  no servidor (`requireProductAccess()`), porque esconder item de menu não é
  autorização.
- **Sair do programa é `OPTED_OUT`, não `SUSPENDED`.** Saída voluntária não
  apaga nada — código, indicações e comissões ficam, e reativar devolve o mesmo
  link. O status do admin continua separado, e visível, para a pessoa ver o
  aviso do bloqueio.

## Resumo de conversa + teste dos dois lados — 2026-08-30

Toda conversa passa a poder ter um resumo em texto gerado pela IA — "o que o
cliente quer / onde parou / próximo passo", mais uma linha "Atenção:" quando
aparece orçamento, data marcada, objeção ou reclamação. O painel só sabia
mostrar a conversa inteira: isso resolve o caso de 6 mensagens e falha no de
60, onde reabrir a conversa significava reler tudo de novo antes de responder.

- **Motor**: `summarizeConversation(tenantId, conversationId)` em
  `src/modules/agent-engine/summary.ts` — chamada única de texto no LLM ativo,
  sem tools, com a mesma chain de fallback do orquestrador (Gemini → Grok →
  Groq) e `recordUsage` no provider que de fato respondeu. Máximo de 60
  mensagens no prompt, reordenadas em ordem cronológica; mínimo de 4 mensagens
  para valer a pena.
- **Sob demanda, não a cada turno.** Resumir dentro de `runAgentTurn` dobraria
  o gasto de tokens de toda mensagem recebida (consumo que conta na cota do
  plano) para produzir um resumo que talvez ninguém leia. Quem paga é quem
  clica.
- **Cache com contagem de mensagens.** Três colunas novas em `Conversation`:
  `summary`, `summaryAt`, `summaryMsgCount`. A última é o que deixa a interface
  dizer "4 mensagens novas desde este resumo" sem gastar uma chamada — e a UI
  **não** regera sozinha nesse caso: um resumo velho que se anuncia velho é
  melhor do que um custo silencioso a cada abertura.
- **A gravação usa `$executeRaw`**, não `prisma.conversation.update`:
  `updatedAt` tem `@updatedAt` e ordena a caixa de entrada — gerar um resumo
  não pode empurrar a conversa para o topo como se o cliente tivesse escrito.
- **Onde aparece**: bloco no `LeadPanel` (coluna do cliente, acima do telefone
  e das datas — quem abre uma conversa quer primeiro saber o que rolou nela),
  no topo do `ConversationThread` em xl+, no `<details>` mobile, e como texto
  pronto nas linhas e cards de `/contatos`, onde substitui a prévia da última
  mensagem quando existe ("ok, obrigado" não diz nada sobre o que o cliente
  queria).
- **Escrever dos dois lados na conversa de teste.** Na aba "Testes" de
  `/conversas`, a caixa de resposta ganhou um seletor "você | cliente": dá para
  escrever como o cliente e ver o agente responder de verdade, com o histórico
  da conversa aberta, sem sair para o diálogo "Testar agente" (que sempre
  recomeça do zero). Como "você" o comportamento é o de antes — grava
  `sentBy: "human"` e pausa o agente. A action nova é `sendTestClientMessage`,
  restrita a `isTest: true`: numa conversa real, forjar uma mensagem "do
  cliente" que ele nunca mandou envenenaria histórico e relatórios. Quando o
  agente fica calado (pausado, desligado, sem agente, cota esgotada), o
  `status` do turno vira aviso na tela em vez de parecer bug.
- **Os dois blocos novos da coluna do meio são recolhíveis.** O resumo acima
  do histórico virou `<details>` fechado por padrão (aberto, comia um terço da
  altura do histórico; o texto completo segue sempre visível na coluna do
  cliente) e o seletor de lado ficou atrás de um botão "Enviando como
  você/cliente", que mantém o lado atual à vista quando fechado.
- **Schema**: aplicado com `prisma db push`. O push local carregou junto o drop
  de `Tenant.trialUnlimitedUntil`, coluna já removida do schema em commit
  anterior e sem nenhuma referência no código, que só não tinha sido aplicada
  ao banco de desenvolvimento.

## Novos gráficos em /relatorios + correções de fuso e paleta — 2026-08-11

Onze gráficos novos (seis no Operacional: funil de conversão, horários de
pico, tempo até a primeira resposta, resolução autônoma, recuperação por
follow-up, comparecimento/no-show; cinco no Financeiro: retorno acumulado ×
investido, retorno por agente, ponto de equilíbrio, retorno mês a mês, custo
por lead), além de melhorar a apresentação dos seis gráficos existentes e
corrigir dois defeitos achados durante o levantamento.

- **Bug de fuso nos buckets de `/relatorios`.** `src/modules/reports/service.ts`
  montava os buckets (`startOfDay`, `startOfMonth`, `bucketStart`) e os rótulos
  (`MONTH_LABEL`/`DAY_LABEL`/`HOUR_LABEL`) com hora do **servidor**, não do
  painel — o mesmo bug já corrigido em `src/lib/format.ts` no commit anterior,
  que tinha ficado de fora deste arquivo. Em produção (UTC), "hoje" começava às
  21h da véspera em Brasília. Fix: todo o bucketing agora passa por
  `partsInZone`/`zonedTimeToUtc` (`src/modules/scheduling/time.ts`), incluindo
  o cálculo de meses da visão Financeira (`computeFinancialSummary`), que também
  usava `getFullYear()/getMonth()` cru.
- **Paleta do donut reprovava CVD.** `DonutChart.tsx` usava
  `["#4b3cf0", "#1fc8a3", "#f59e0b", "#ff6b4a", "#94a3b8"]` — validado com o
  script do skill dataviz, `#ff6b4a` e `#f59e0b` (posições adjacentes) tinham
  ΔE 12,7 em visão normal (piso é 15) e 7,2 em deuteranopia: duas fatias
  vizinhas indistinguíveis para boa parte dos leitores. O neutro `#94a3b8`
  também reprovava o piso de croma. Nova paleta centralizada em
  `src/components/charts/palette.ts` — ordem `iris, warn, success, signal,
  violeta` (variáveis CSS `--chart-1..5` em `globals.css`, claro e escuro com
  passos próprios) — **ALL CHECKS PASS** nos dois modos.
- **Mudança de definição: "lead fechado" não conta mais cancelado.** `closed`
  (gráfico Operacional) e `closedLeads` (base do ROI Financeiro) contavam
  qualquer agendamento **criado** no período, sem filtrar status — cancelado
  entrava como fechado, divergindo do KPI "Agendamentos" ao lado, que já
  filtrava `status in ["scheduled","done"]`. Alinhado aos dois. **Efeito
  esperado:** o retorno e o ROI exibidos na visão Financeira caem para contas
  com cancelamentos — não é regressão, é a métrica ficando consistente com o
  que a mesma tela já mostrava ao lado.
- **Apresentação dos gráficos existentes.** `SeriesChart`/`BarsChart` ganharam
  eixo Y com 3 gridlines, rótulo do valor de pico de cada série, crosshair +
  tooltip com paridade de teclado (`ChartTooltip`/`ChartHoverLayer`, novos em
  `src/components/charts/`) — o `<title>` nativo (só hover, sem foco) deixou de
  ser a única via para ler um valor. `BarsChart` também parou de desenhar uma
  barra visível para bucket zerado (piso antigo de 4% de altura fazia zero
  parecer dado).

Arquivos novos: `src/components/charts/palette.ts`, `ChartTooltip.tsx`,
`ChartAxisY.tsx`, `HeatmapChart.tsx`, `FunnelChart.tsx`, `MeterChart.tsx`,
`DivergingBars.tsx`, `HorizontalBars.tsx`,
`src/app/(dashboard)/relatorios/FinancialCharts.tsx`. Mapa completo e regras
de cálculo exatas: `src/app/(dashboard)/relatorios/README.md`.

## Fix: horários das conversas presos no fuso do servidor — 2026-08-11

O painel mostravam horas/datas no fuso em que o servidor roda. Na máquina de
dev (Brasília) tudo parecia certo, mas em produção o servidor roda em UTC e o
histórico de `/conversas` amanhecia com 3h a menos ("14:32" virava "11:32").
Causa: `Intl.DateTimeFormat("pt-BR", …)` **sem `timeZone`** em
`src/lib/format.ts` usa o fuso do runtime — nada no código fixava Brasília.

Fix: toda formatação de data/hora de UI do painel agora é calculada em
`America/Sao_Paulo` de forma explícita, em duas frentes:

- **`src/lib/format.ts`** — constante `PANEL_TIME_ZONE = "America/Sao_Paulo"`
  aplicada a `dateLabel`, `dateTimeLabel`, `timeLabel`, `shortAge` e ao
  fallback de data do `dayLabel`. Novos `startOfPanelDay` (meia-noite do dia no
  fuso do painel, como instante UTC — mesmo truque de `Intl.formatToParts` do
  `modules/scheduling/time.ts`) e `samePanelDay` (compara se duas datas caem no
  mesmo dia de painel).
- **`src/app/(dashboard)/conversas/ConversationThread.tsx`** — o separador de
  dia do histórico usava `createdAt.toDateString()`, que também depende do fuso
  do servidor; trocado por `samePanelDay`.

Regra para o futuro: **nenhum `Intl.DateTimeFormat` de UI do painel deve
formatar data/hora sem `timeZone`** — o painel é brasileiro e Brasília
(`America/Sao_Paulo`) é o fuso do produto, mesmo que o servidor rode em UTC.
Precedente original: a saudação de `/inicio` já fixava Brasília. Fora de escopo
aqui: páginas de `/admin` ainda usam `toLocaleDateString` cru e não foram
tocadas.


## Fix: agendamento em loop, base de conhecimento sem visualização, conversas de teste permanentes + resposta manual — 2026-08-08

Três problemas relatados em uso real, sem relação entre si além de todos
tocarem `agent-engine`.

- **Bug: o agente marcava um horário, "esquecia" e entrava em loop.**
  Causa: o system prompt (`modules/scheduling/config.ts`) mandava sempre
  confirmar um horário chamando `schedule_meeting`, mas não dizia para parar
  de chamar depois de já confirmado. Numa mensagem seguinte da mesma
  conversa, o LLM rechamava a tool para o mesmo horário, `hasConflict` batia
  contra o compromisso que o próprio agente tinha acabado de criar, e ele
  concluía que o horário fora tomado — oferecia outro, marcava, repetia.
  Fix em duas camadas independentes: instrução explícita no prompt para não
  reconfirmar um horário já marcado, e `findOwnAppointment`
  (`modules/scheduling/repository.ts`) no handler de `schedule_meeting`
  (`agent-engine/tools.ts`) — se a *mesma conversa* já tem esse horário,
  responde "já confirmado" em vez de tratar como conflito, mesmo que o LLM
  chame de novo.
- **Base de conhecimento sem visualização/edição.** O texto extraído (de PDF
  ou colado) sempre foi salvo por completo em `KnowledgeDocument.content` —
  nada era perdido ao apagar/recriar a base — mas `listDocuments` nunca
  selecionava esse campo e não havia UI para lê-lo. Novo:
  `getDocument`/`updateDocument` (`knowledge-base/repository.ts`, o segundo
  reescreve o texto e regenera chunks/embeddings) e
  `ViewEditDocumentDialog.tsx` — ícone de olho ao lado de cada documento abre
  um modal com o texto usado pelo agente, editável. Editar não toca no
  arquivo original na CDN (`fileUrl`), que continua baixável — só o texto do
  RAG muda, podendo divergir do PDF depois de editado (aceito de propósito).
- **Conversas de teste (sandbox) eram descartáveis e invisíveis em
  `/conversas`.** `resetTestConversation` fazia hard delete
  (`prisma.lead.deleteMany`) a cada "Recomeçar", e toda consulta da tela de
  Conversas excluía `isTest: true` — dava a impressão de que testar apagava
  histórico. Agora: `startFreshTestConversation` (`agent-engine/conversation.ts`)
  arquiva a conversa atual (muda o telefone para
  `sandbox:<agentId>:archived:<timestamp>`, fora do caminho de busca) em vez
  de apagar, e libera o telefone canônico para nascer vazio — nada se perde,
  e a IA não recomeça vendo o histórico do teste anterior. Nova aba "Testes"
  em `/conversas` (`leadStatus.ts`) mostra esse histórico com badge "teste";
  os demais filtros (inclusive "Todos") continuam só com conversas reais, e
  Contatos/Relatórios/Agenda/Home não mudaram — já filtravam `isTest` por
  conta própria.
- **Responder manualmente pelo painel** (pedido junto: "conversar com o
  agente por aqui"). Novo núcleo `sendManualReply`
  (`agent-engine/conversation.ts`) — numa conversa real o texto sai de
  verdade para o WhatsApp do cliente via `WhatsAppProvider.sendMessage`
  (Evolution API, já existia); numa conversa de teste fica só na simulação
  local. No caminho, achei que `contatos/actions.ts` já tinha uma
  implementação **duplicada** disso (`sendMessageToContact`, usada pelo botão
  "Enviar mensagem" da tela de Contatos) — sem `sentBy` nem pausa do agente.
  As duas telas (`conversas/actions.ts` → `sendManualMessage`,
  `contatos/actions.ts` → `sendMessageToContact`) agora chamam o mesmo
  `sendManualReply`, então o fix de baixo vale para as duas, não só para
  Conversas.
  Grava a mensagem com o novo campo `Message.sentBy: "agent" | "human"` —
  `role` continua `"assistant"` nos dois casos (o histórico que o LLM lê não
  muda), `sentBy` é metadado extra só para UI/auditoria, sem o qual uma
  resposta manual gravada como "assistant" faria o LLM achar que tinha sido
  ELE quem disse aquilo nos turnos seguintes. Responder manualmente marca
  `Conversation.agentPaused = true` (campo novo) — `runAgentTurn` checa isso
  antes de montar contexto e fica em silêncio *só nessa conversa* (as outras
  do mesmo agente continuam normais); "Devolver para o agente"
  (`ResolveButton`, reaproveitando `reopenConversation`) desliga a pausa.
  Novo status de turno `human_handling` em `TurnStatus`, tratado como
  qualquer não-`"ok"` pelos três consumidores existentes
  (`webhooks/whatsapp`, `api/widget`, `Sandbox.tsx`) sem precisar editá-los.
- Verificado: `tsc --noEmit` e `eslint` limpos em todos os arquivos tocados;
  `prisma db push` aplicado contra o Postgres de dev; `next dev` sobe e
  `/conversas` responde sem erro de servidor. **Não verificado**: fluxo de
  clique real no navegador (enviar mensagem, ver badge de teste, editar
  documento) — sem sessão autenticada disponível neste ambiente para
  screenshot/E2E manual.
- **Pré-existente, não corrigido aqui**: dois `no-var` em
  `orchestrator.ts:117,131` (`var result = ...` dentro do loop de fallback de
  modelo) — fora do escopo desta rodada, sinalizando para quando alguém
  mexer ali de novo.

## Layout de `/inicio`, `/conversas` e `/whatsapp` — 2026-07-31

Proposta e wireframes em `docs/proposta-layout-painel-2026-07.md`. A revisão de
UI anterior padronizou os componentes; este passe é sobre **layout, densidade e
estado**: as três telas eram uma coluna de cards de mesmo peso que não mudava
quando o estado da conta mudava.

- **`/conversas` virou caixa de entrada de verdade.** Três painéis (lista ·
  histórico · contexto do lead), cada um com scroll próprio dentro da altura da
  viewport — antes a página inteira rolava e o cabeçalho "com quem estou
  falando" saía de vista numa conversa longa. Novos: busca por nome/telefone,
  agrupamento por urgência ("Precisam de você" no topo, depois Hoje / 7 dias /
  Antes), "carregar mais" (o `take: 50` cortava em silêncio), separador de dia e
  mensagens seguidas do mesmo autor coladas. No celular aparece um painel por
  vez, comandado pelo `?id=` que já existia na URL.
- **Fim do beco sem saída do handoff** (pendência 4 da revisão anterior): a
  terceira coluna traz dados do lead (telefone, primeiro contato, agente que
  atendeu, follow-up) e ações — `resolveConversation`/`reopenConversation`
  (`updateMany` com `tenantId` no `where`) e "Responder no WhatsApp" via
  `wa.me`. O lead do sandbox (telefone literal `sandbox`) não ganha link
  quebrado: ganha explicação.
- **Sandbox saiu do fluxo da página** e virou `<dialog>` nativo acionado pelo
  cabeçalho — ocupava card permanente numa tela sobre conversas reais.
- **`/whatsapp` passou a ser orientada a estado.** Desconectada: QR gerado
  sozinho ao abrir (era um clique a mais para a única coisa que a pessoa veio
  fazer), grande, com cronômetro de validade — o código expirava em silêncio e a
  tela ficava dizendo "aguardando" para sempre, mesmo defeito do bug nº 13 por
  outro caminho. Conectada: painel de saúde (desde quando, mensagens recebidas
  nos últimos 7 dias), sem código nenhum. O snippet do site deixou de ser card
  irmão do WhatsApp e virou item da seção "Outros canais" (Site · Instagram em
  breve), que dá lugar para o produto crescer.
- **`/inicio` tem duas fases.** Em setup, só o **próximo** passo tem ação (eram
  seis botões "Começar" idênticos competindo, contra a regra de uma ação
  primária por tela); concluídos colapsam num `<details>`. Já no ar, a home vira
  resumo: faixa de saúde (agente · WhatsApp · plano/uso), números por período
  com variação contra a janela anterior, sparkline de mensagens por dia,
  "Precisa de você" e últimas conversas.
- **Bug encontrado no caminho**: o passo `site` do checklist tinha `done: false`
  fixo ("habilitado no Milestone 5"), então `allDone` era **inalcançável** — o
  progresso nunca chegava a 100% e a conta ficava presa em modo configuração
  para sempre. Virou `optional: true`, com `requiredSteps()`/`setupComplete()`
  em `modules/tenants/onboarding.ts`.
- **`PanelShell`**: o wrapper do `main` virou `flex min-h-full flex-col`, o que
  dá altura definida para uma tela pedir `flex-1` e ocupar a viewport. Telas
  normais não mudam.
- Novos: `lib/format.ts` (tempo relativo pt-BR, rótulo de telefone, `wa.me`),
  `computeHomeSummary()` em `modules/reports/service.ts` (janela + comparação
  com o período anterior; `computeTenantReport` continua "desde o início" para
  `/relatorios`), `Stat` com `delta` e `compact`.
- Verificado: `tsc --noEmit` e `eslint` limpos, `next build` verde (24/24). No
  navegador, contra o banco de dev: `/inicio` nas duas fases, `/conversas`
  (lista, detalhe, busca sem resultado, filtro vazio, lead de sandbox) e
  `/whatsapp` desconectada. **Não verificado**: `/whatsapp` conectada e a leitura
  real do QR — nenhuma conta de teste tem número conectado.

## Fix: rodapé da sidebar (botão minimizar) sumindo em telas compridas — 2026-07-30

- **Causa real do "o botão de minimizar não aparece"**: não era cache de
  navegador nem bug do componente — era layout. `PanelShell` era
  `flex min-h-screen` (linha) com a `Sidebar` e o `main` como irmãs; com
  `min-h-screen`, a altura do container cresce junto com o conteúdo da
  página, e por `align-items: stretch` (padrão do flex) a sidebar esticava
  para acompanhar essa altura total — não a da viewport. Em telas com
  conteúdo comprido (`/configuracoes`, com checklist + form de feedback), o
  rodapé da sidebar (agora com o botão de minimizar) ficava empurrado bem
  abaixo da dobra, exigindo rolar a **página inteira** pra aparecer.
- **Fix**: `PanelShell` virou `h-screen overflow-hidden` (em vez de
  `min-h-screen`) — a casca fica travada na altura da viewport, só o `main`
  rola internamente (`overflow-y-auto`). Sidebar e header ficam sempre
  visíveis, padrão de app shell. `Sidebar.tsx` ganhou `h-full` explícito (em
  vez de depender do stretch implícito) + `overflow-y-auto` defensivo, caso
  algum painel ganhe nav longa o bastante para não caber na viewport.
- Verificado: `tsc --noEmit` e `eslint` limpos.

## Sidebar minimizável no desktop (dashboard + admin) — 2026-07-30

- **Novo `Sidebar.tsx`** (client) substitui o `<aside>` estático que vivia
  dentro de `PanelShell.tsx`: mesma sidebar de sempre, agora com botão
  minimizar/maximizar no rodapé (`PanelLeftClose`/`PanelLeftOpen`). Minimizada,
  vira uma coluna só de ícones (`w-16`) com `title` (tooltip nativo) e label
  em `sr-only` por item — continua com nome acessível, só não ocupa espaço
  visual. `ShellNav` ganhou a prop `collapsed` para isso; a gaveta mobile
  (`MobileNav`) não usa, sempre mostra os labels.
- **Preferência em `localStorage`**, lida via `useSyncExternalStore` — não
  `useEffect` + `setState`, que dispara `react-hooks/set-state-in-effect`
  (a mesma regra que pegou o bug real do `NewAccountForm`, ver revisão de
  UI do painel). `useSyncExternalStore` é o mecanismo do próprio React para
  sincronizar com uma fonte fora do React sem esse problema: usa
  `getServerSnapshot` (sempre "aberta") na hidratação e troca para o valor
  real do client sem descompasso.
- Transição de largura em 200ms `ease-out`, com `motion-reduce:transition-none`.
- Verificado: `tsc --noEmit` e `eslint` (projeto inteiro) limpos; `/inicio` e
  `/admin/contas` seguem respondendo (307 de auth, sem erro de servidor).
  **Não verificado em navegador**: clicar o botão e ver a sidebar de fato
  encolher/expandir — mesma limitação de ambiente das entradas anteriores
  (sem Playwright/chromium-cli aqui).

## Ícones na navegação do painel (dashboard + admin) — 2026-07-30

- **`ShellNav`/`NavItem`** ganhou campo `icon`, usado pelos dois `NAV`
  (`(dashboard)/layout.tsx`, `(admin)/layout.tsx`) e renderizado uma vez em
  `ShellNav.tsx`, que já é compartilhado pela sidebar desktop e pela gaveta
  mobile (via `PanelShell`/`MobileNav`) — corrigir num lugar só resolveu os
  dois painéis e os dois breakpoints.
- Dashboard: Início `Home`, Agentes `Bot`, WhatsApp `MessageCircle`, Conversas
  `MessagesSquare`, Relatórios `BarChart3`, Configurações `Settings`.
  Admin: Contas `Building2`, IA `Cpu`, Feedbacks `Star`.
- **Fix em produção do primeiro passe**: `NAV` nasce em `layout.tsx` (Server
  Component) e ia para `ShellNav` (Client Component) com o **componente**
  lucide direto no array (`icon: Home`) — React rejeita passar
  função/objeto-com-`render` de Server para Client Component ("Only plain
  objects can be passed..."). Corrigido para o layout mandar só o **nome**
  (`icon: "Home"`, string, serializável) e o `ShellNav` resolver o componente
  num mapa `ICONS` local.
- Verificado: `tsc --noEmit` e `eslint` limpos, rota volta a responder
  (307 de auth, não mais 500).

## Navbar da landing: menu mobile + ícones + acessibilidade — 2026-07-30

- **Ícones nos links** (`lucide-react`, mesma lib já usada no resto do produto):
  `Workflow`/`Zap`/`Layers`/`CircleHelp` nos 4 links de seção, `LogIn` em
  "Entrar", `UserPlus` em "Criar conta" — desktop, drawer mobile e rodapé do
  drawer. `aria-hidden` neles (o texto do link já rotula a ação; duplicar via
  leitor de tela seria ruído).
- **Sem navegação no celular** (mesma classe de bug já corrigida no painel em
  28/07): `nav` dos links de seção era `hidden md:flex` sem nenhum substituto
  abaixo de 768px — quem abria a landing pelo celular não via "Como funciona",
  "Ações", "Planos" nem "FAQ". Novo drawer mobile no próprio `Navbar.tsx`
  (mesmo padrão do `MobileNav` do painel: `<dialog showModal()>`, ícones
  `Menu`/`X` do lucide-react, fecha ao clicar num link/CTA), com os CTAs
  "Entrar"/"Criar conta" repetidos no rodapé da gaveta.
- **Contraste abaixo do piso**: os links de seção usavam `text-white/50`
  sobre `ink` — mesmo problema (~3.9:1, reprova AA) já corrigido no
  `ShellNav` do painel, que fixou o piso em `/60`. Alinhado ao mesmo piso.
- **`focus-visible` ausente** no logo, nos 4 links de seção e no link
  "Entrar" (desktop e dentro do drawer) — navegável por mouse, invisível por
  teclado. Ganharam o mesmo anel (`ring-iris` + offset `ink`) usado no resto
  do produto.
- **`text-[11px]` → `text-micro`**: os links da navbar ainda usavam o valor
  solto que o token (`--text-micro`, criado na revisão do painel) existe
  justamente para eliminar.
- Verificado: `tsc --noEmit` e `eslint` limpos. **Não verificado em
  navegador**: abrir/fechar a gaveta em ~375px — sem `chromium-cli`/Playwright
  neste ambiente para captura de tela; pendente de um passe manual.

## Revisão de UI do painel (dashboard + admin) — 2026-07-28

> Relatório completo: [revisao-ui-painel-2026-07.md](./revisao-ui-painel-2026-07.md)

- **Navegação no celular** (era o buraco maior): a barra lateral era `hidden md:flex` sem nenhum substituto abaixo de 768px — no telefone dava para entrar no painel e não dava para sair da primeira tela. Novo `MobileNav` (gaveta com `<dialog showModal()>`: foco preso, `Esc` e devolução de foco vêm do navegador). Os dois layouts, que eram cópias quase idênticas já divergindo, viraram um `PanelShell`.
- **Superfície por atributo**: `PanelShell` marca `data-surface="dark"` uma vez e o `globals.css` declara `@custom-variant panel (&:where([data-surface="dark"] *))`. Os primitivos trazem a variante embutida, então sumiram os overrides manuais (`className="border-white/20 bg-transparent text-white/70 …"`) repetidos em 4 telas. Confirmado no CSS compilado (46 regras, inclusive compostas).
- **Bugs corrigidos**: `form.reset()` no corpo do render apagava o que a pessoa digitava (`KnowledgeManager`); bolhas de chat invertidas entre `/conversas` e o sandbox (lead e agente trocados de lado); chat sem rolagem automática nas duas telas; `<select onChange={grava}>` no admin gravava plano/status intermediários a cada seta do teclado; suspender conta e remover documento executavam sem confirmação; `NaN%` na barra de progresso com catálogo vazio; `pending` global desabilitava os 5 toggles de ação de uma vez; falha ao remover documento sumia em silêncio (`void` no retorno); `role="radiogroup"` com `<li>` no meio quebrava o grupo no `ModelPicker`; status do WhatsApp só atualizava com clique manual (agora faz polling de 5s enquanto o QR está na tela, com teto de 2min).
- **Acessibilidade**: labels associadas via `Field`/`fieldProps` (campos que só tinham `placeholder` como rótulo); `role="switch"` no lugar de `aria-pressed`; nota por estrelas virou `fieldset` com radios nativos (setas do teclado funcionam, e "1 estrela" no singular); `focus-visible` nos ~10 controles feitos à mão que não tinham; erros/sucessos em `Alert` com `role="alert"`/`role="status"`; contraste do texto pequeno subiu de `white/35–40` (≈3.4–3.9:1, reprova AA) para piso `white/55`; skip link; `scope`/`caption` na tabela do admin e região rolável focável; status crus (`warm`, `pending_qr`) traduzidos.
- **Estados que faltavam**: `loading.tsx` nos dois grupos (não existia nenhum, com 9 rotas consultando o Prisma), `error.tsx` no admin (+ `digest` e ação de contato no do dashboard), e estado vazio **com próximo passo** em conversas, documentos, relatórios, contas e feedbacks.
- **Padronização — segue shadcn/ui, sem dependência nova**: o projeto já era shadcn (`cn()` com clsx+tailwind-merge, CVA, tokens no `@theme`, lucide), só que com 4 primitivos para uma superfície que precisava de ~18 — a diferença virava HTML solto por tela. Catálogo completado: `alert`, `badge`, `button` (+`loading`, `ButtonLink`), `confirm-dialog`, `copy-button`, `empty-state`, `field`, `filter-tabs`, `loading-dots`, `page-header`, `segmented-control`, `select`, `skeleton`, `stat`, `switch`, + `chat/ChatBubble`, `chat/ChatLog`, `shell/PanelShell`, `shell/MobileNav`, `shell/PanelError`. MUI/AntD foram descartados por trazerem tema próprio (duas fontes de verdade para cor); Radix, porque o `<dialog>` nativo já cobria o que faltava.
- **Duplicatas eliminadas**: 3 implementações de campo-com-label → 1 (`LabeledField` de `(auth)` e `Field` do onboarding agora reexportam o mesmo); 3 selects → 1; 2 cópias de copiar-para-área-de-transferência → 1; ~8 pílulas de status → `Badge`; 7 cabeçalhos → `PageHeader`; 2 grupos de filtro → `FilterTabs`; 3 bolhas de chat (2 discordando) → `ChatBubble`. Removido `(dashboard)/_components/Placeholder.tsx` (código morto, sem importador).
- **Raio e tipografia micro viraram token** (`--radius-control` 8px, `--radius-surface` 12px, `--text-micro` 11px no `@theme`). O produto misturava `rounded-md`/`lg`/`xl`/`2xl` na mesma tela e usava `text-[9px]`/`[10px]`/`[11px]` para o mesmo papel — como eram valores soltos, não havia um lugar para corrigir. Agora qualquer `rounded-[Npx]` ou `text-[Npx]` no código é desvio detectável.
- **Fix na seta do `<select>`**: era um `<svg>` irmão dentro de um wrapper `relative` que não recebia o `className` — a largura ia para o `<select>` e o wrapper ficava com 100%, então em qualquer select estreito (`w-32` na tabela de contas) a seta descolava do campo. Virou `background-image` na classe `.ui-select`: o `<select>` é um elemento só e `className` se comporta como em qualquer outro campo.
- Cabeçalho de `/agentes` renomeado de "Configuração do agente" para "Seu agente" — colidia com `/configuracoes` no menu. **Rota inalterada.**
- Verificado: `npm run build` verde (24/24) e `npm run lint` verde — o lint **estava vermelho antes** deste passe, com 2 erros pré-existentes (`setState` em efeito no `NewAccountForm`; `window.location.href =` no `PlanPicker`), ambos corrigidos. **Não verificado em navegador**: gaveta mobile, diálogos de confirmação, polling do WhatsApp e rolagem automática — pendente de um passe manual.

## Reorganização do menu do painel do cliente — 2026-07-28

- **`/configuracao` → `/agentes`** (nav "Agentes"): mesma tela (persona, base de conhecimento, ações), só rota e label renomeados para não colidir com a nova `/configuracoes`. `revalidatePath` (`agentes/actions.ts`, `onboarding/actions.ts`) e os `href` do checklist de onboarding (`src/modules/tenants/onboarding.ts`) atualizados junto.
- **Nova `/configuracoes`** (nav "Configurações"): junta o que antes eram as rotas `/status` (checklist "Sua configuração") e `/feedback` (form de feedback) numa única tela, cada um em seu card. As duas rotas antigas foram removidas — nada mais linkava para elas fora do nav.
- **Seção "Integrações" retirada** da visão do tenant: mostrava quais env vars (Stripe, Evolution, Redis, IA) estão configuradas, informação de configuração de plataforma sem utilidade para o cliente final. `integrationChecks()` (`src/lib/health.ts`) não foi removida, só deixou de ser chamada por essa página — fica disponível caso um painel admin precise dela.
- Verificado: `tsc --noEmit` e `eslint` limpos após o rename (as duas rotas antigas não deixaram referência solta).

## Onboarding guiado para contas novas — 2026-07-28

- **Wizard de 4 passos em `/onboarding`** (boas-vindas → configurar o atendente → o que ele resolve → conectar), numa única rota: os passos são estado do client component, sem navegação entre URLs. Stepper com barra de progresso, `%` e passos já visitados clicáveis para voltar.
- **Passo 2 com prévia ao vivo**: um chat simulado (`ChatPreview.tsx`) reflete nome, tom de voz e objetivo enquanto o usuário escolhe. É simulação local — não chama a IA; o sandbox real segue em `/conversas`.
- **Passo 3 — processos**: 4 opções pré-definidas (atender, vender, resolver problemas, agendar) + campo livre. Cada processo mapeia para automações do `agent-engine`, e a seleção respeita o teto de ações do plano (`maxActiveActions`), avisando quando algo fica de fora em vez de estourar silenciosamente.
- **Passo 4 — integração**: snippet de instalação no site com botão de copiar e conexão do WhatsApp com QR + status (reaproveita as server actions de `/whatsapp`). Nenhum dos dois trava a conclusão.
- **Progresso persistido**: autosave com debounce de 800ms grava `onboardingStep` + `onboardingDraft` no `Tenant`; ao voltar, o wizard reabre no passo em que parou com as respostas preenchidas. `parseDraft()` tolera Json nulo ou corrompido.
- **Validação por passo** no client (libera o "Continuar") **e** revalidada na server action antes de gravar — a UI não é a única linha de defesa.
- **Guard de rota** no layout de `(dashboard)`: enquanto `onboardingCompleted` for falso, qualquer página do painel redireciona para `/onboarding`. Fica **depois** da checagem de conta suspensa (conta suspensa vê o aviso, não o wizard), e `/onboarding` mora fora do grupo `(dashboard)` para não haver loop. `SUPERADMIN` nunca vê o wizard (`requireOwner()` o manda para `/admin/contas`).
- **Sem estado paralelo**: ao concluir, as respostas viram `PersonaAnswers` + `TenantAction`s numa transação, então tudo segue editável em `/configuracao`. Para isso `PersonaAnswers` ganhou `agentName` (novo campo no formulário de persona) — sem ele, salvar a persona em `/configuracao` apagaria o nome do agente.
- Schema: `Tenant.onboardingCompleted` / `onboardingStep` / `onboardingDraft`. Contas pré-existentes receberam backfill para `true` e o `seed.ts` já cria os tenants de exemplo concluídos, então ninguém é jogado no wizard retroativamente.
- Verificado ponta a ponta: conta nova é desviada de `/inicio` e `/configuracao` para `/onboarding`; superadmin cai em `/admin/contas`; conta antiga entra direto no painel; retomada reabre no passo 3 com rascunho e checkboxes corretos; após concluir, `/onboarding` devolve para `/inicio` e a persona aparece em `/configuracao`. 26 asserções das funções de domínio (validação, limite de plano, `parseDraft`, composição do prompt) passando.

## Admin cria contas (qualquer papel, qualquer plano) — 2026-07-25

- `/admin/contas` ganhou o painel **Nova conta**: nome do tenant, e-mail, **tipo de conta** (Cliente/owner ou Superadmin) e **plano** (FREE→BUSINESS). Reaproveita `createTenantWithOwner`, então a conta já nasce com `AgentConfig`, instância de WhatsApp e as 5 ações padrão — a pessoa entra pelo `/login` e usa.
- **Senha opcional**: em branco, o sistema gera uma provisória de 14 caracteres (alfabeto sem `0/O/1/l/I`) e mostra **uma vez** com botão de copiar. Preenchida, usa a do admin. Nunca é relida depois — só o hash bcrypt fica no banco.
- Aviso explícito ao escolher Superadmin (enxerga/edita todas as contas) e badge `admin` na tabela para distinguir conta de plataforma de conta de cliente.
- E-mail duplicado é rejeitado com mensagem clara. `createAccount` valida com zod e passa por `requireSuperadmin`.
- Verificado ponta a ponta: OWNER criado loga com a senha gerada e cai em `/inicio` (bloqueado em `/admin`); SUPERADMIN criado cai em `/admin/contas` (bloqueado em `/inicio`); duplicado recusado; tenant provisionado completo.

## Rename: o produto agora se chama **fechai** — 2026-07-25

- Wordmark `fechai.` (minúsculo, ponto em `signal`) nos 5 shells: landing (Navbar/Footer), dashboard, admin e auth.
- `metadata` da raiz com `title.template` (`%s · fechai`) e `applicationName`; `package.json` → `"fechai"`; header do `schema.prisma`; rodapé da landing.
- `README.md` reescrito (era o boilerplate do create-next-app): o que é, como rodar, contas do seed, aponta para `docs/INDEX.md`.
- Regra registrada em `CONVENTIONS.md` e `INDEX.md`: **fechai** é o nome do produto; **agente** continua sendo o termo de domínio da IA (`agent-engine`, `AgentConfig`, `runAgentTurn`, "o agente responde") e não foi renomeado.
- Infra não mexida de propósito: containers `saas_postgres`/`saas_redis` e volumes `teste_pgdata`/`teste_redisdata` mantêm o nome — renomear recriaria os volumes e apagaria o banco local.

## Fonte corrigida + camada de IA trocável (Gemini) + config no admin — 2026-07-24

- **Fix de fonte (raiz)**: `--font-sans`/`--font-display` referenciavam `--font-satoshi`/`--font-clash-display`, que nunca foram definidas (as fontes da Fontshare não chegaram). `var()` sem fallback em custom property indefinida invalida a declaração inteira (IACVT), então `html`/`body` caíam no serif padrão do navegador — e como `--font-mono` funcionava, o resultado era a mistura de fontes visível na dashboard. Fallback movido para dentro do `var()`: `var(--font-satoshi, var(--font-jakarta))`. Confirmado no CSS compilado.
- **Camada de IA** (`src/modules/ai/`): contratos + erros tipados (`AiError` com `rate_limit`/`quota_exceeded`/`auth`/`provider` e mensagem PT-BR para o lead), adapters **Gemini** (REST, sem SDK) e OpenAI, catálogo de modelos com limites/preços, e `getLLMProvider()` resolvendo o modelo ativo do banco. O `agent-engine/llm.ts` foi removido — nada fora de `providers/` importa SDK de provedor.
- **Embeddings/RAG também no Gemini** (`gemini-embedding-001` com `outputDimensionality: 1536` para casar com a coluna pgvector, normalizado). O RAG passa a funcionar sem chave da OpenAI.
- **Limites do free tier tratados**: 429/`RESOURCE_EXHAUSTED` vira `rate_limit` ou `quota_exceeded` (distingue por minuto vs. por dia); ao estourar a cota o lead recebe mensagem clara e a conversa é marcada `needsHuman` em vez de morrer em silêncio.
- **Novo `/admin/ia`**: modelo ativo (provedor, credencial, embeddings, quem trocou) + troca entre modelos do catálogo com tier gratuito/pago, limites e custo por 1M. Persistido em `AiSetting` (linha única) — sem env var, sem deploy; cache de 30s.
- `docs/pesquisa-llm-2026-07.md`: comparativo de custo/escalabilidade com recomendação (ficar no Gemini; migrar para Flash pago no primeiro cliente sério).

## Redesign dos painéis (usuário + admin) + separação por role — 2026-07-18

- **Mundos separados**: login agora decide o destino pelo role (superadmin → `/admin/contas`; owner → `/inicio`). Novo guard `requireOwner` em `src/lib/session.ts` expulsa superadmin do dashboard de tenant (e `requireSuperadmin` já fazia o inverso) — verificado via HTTP nas duas contas do seed.
- **Shell escuro editorial** nos dois painéis (mesma identidade da landing): sidebar `ink` com o wordmark, nav em mono uppercase com barra `signal` no ativo (`components/shell/ShellNav.tsx`), header com e-mail em mono, glow sutil no conteúdo. Admin tem selo "painel do admin" e glow coral.
- **Páginas do usuário** refeitas: início (checklist numerado com progresso `signal`), configuração (persona/base/ações com toggles que acendem `iris`), whatsapp (QR em card branco, snippet mono), conversas (filtros pill, lista com hover, bolhas de chat) + sandbox escuro, relatórios (stat tiles com display gigante), status (checks `success`), feedback (estrelas `warn`).
- **Páginas do admin** refeitas: contas (tabela escura, selects nativos escuros, badges ativo/suspenso, busca) e feedbacks (cards + filtros pill).
- Card/Placeholder/error boundary migrados para o tema escuro. Zero classes `gray-*`/`amber-*`/`red-*` nos painéis.

## Experiência de scroll + UX do auth — 2026-07-18

- **Âncoras do menu**: `scroll-behavior: smooth` + `scroll-padding-top: 76px` (CSS nativo) — clique no menu rola suave e a seção não fica cortada sob o header. Scrollspy no navbar (link da seção visível acende com sublinhado `signal`).
- **Barra de progresso de leitura** no topo (Motion `useScroll` + spring) e **parallax sutil** no telefone do hero e no headline do CTA (`Parallax.tsx` — Motion apenas lê o scroll nativo, sem controlá-lo). Reveals agora revelam em cascata (stagger 70ms por lote).
- **Auth elevado**: painel direito virou a identidade escura com a **demo ao vivo do produto** (reuso do `HeroChat` — a conversa se atende sozinha enquanto a pessoa preenche o form), grade técnica + glow; autofocus no primeiro campo; `FadeIn` na entrada do form; wordmark consistente.
- Tudo respeita `prefers-reduced-motion` (progress some, parallax estático, reveals visíveis, chat completo estático).

## Fix: travamento de scroll na landing + botão do header — 2026-07-18

- **Lenis e GSAP removidos** (desinstalados): o smooth scroll do Lenis travava a rolagem quando a altura da página mudava (accordion do FAQ) — a página parava antes do CTA final. Rolagem agora é 100% nativa; reveals de scroll refeitos com IntersectionObserver + CSS (`[data-animate] .reveal` em `globals.css`). Sem JS/reduced-motion, tudo visível.
- Botão "Criar conta" do navbar ajustado ao tema escuro (outline branco translúcido, sem cor sólida fora do padrão).
- `docs/animations.md` atualizado (regra: não reintroduzir smooth-scroll de biblioteca).

## Redesign editorial da landing + hero corrigido — 2026-07-18

- Direção nova ("a conversa é o produto"): landing editorial escura (`ink`) com display gigante, labels em `font-mono`, glows de `iris`/`signal` e grade técnica sutil — sai o layout claro genérico de SaaS.
- **Hero corrigido**: o `HeroShowcase` (GSAP com cenas absolutas que sobrepunham) foi **removido**; entrou o `HeroChat` — conversa de WhatsApp que se atende sozinha, sequencial (Motion/AnimatePresence + máquina de estados), com chips de ação ("Lead registrado", "Horário agendado") e fecho em `signal`. Sem empilhamento absoluto → sem sobreposição possível; reduced-motion mostra a conversa completa estática.
- Seções refeitas no idioma editorial: Problema (pull-quote com label vertical), ComoFunciona (linhas numeradas estilo índice), Ações (banda ink com hover-glow + célula "novas ações a caminho"), Planos (destaque = card ink invertido, sem ring genérico), ProvaSocial (faixa honesta), CTA final (display 6xl + glow signal). Navbar/Footer escuros.
- Verificado: build verde, landing 200 com todo o conteúdo novo, zero resquício do hero antigo.

## Refatoração de identidade visual + front-end elevado — 2026-07-18

- **Refatoração de identidade visual aplicada**: tokens `ink/paper/iris/signal/success/neutral` no `@theme` (Tailwind v4), zero cores fora da paleta em todo o `src/`; tipografia `font-display`/`font-sans`/`font-mono` (Clash Display/Satoshi via fallback Space Grotesk/Jakarta até os arquivos da Fontshare chegarem; JetBrains Mono ativo); botão `variant="cta"` (signal) restrito a conversão.
- **Stack de animação** (conforme skill `design-ui`): GSAP+Lenis **só na landing**; Motion (`motion/react`) na UI; documentado em `docs/animations.md`.
- **Assinatura da marca**: `TypingToCheck` ("digitando → check") em botões de auth, bolha do sandbox e painel do auth; keyframes CSS próprios.
- **Landing anti-"cara de IA"** (auditoria da seção 8 da skill): hero novo = demonstração do produto em GSAP timeline (formulário autopreenchendo → ações ligando → QR+snippet → conversa terminando em check coral + "Horário agendado"), autoplay em loop ~10.5s, frame estático com reduced-motion; seção "O problema" concreta; ComoFunciona em 4 passos numerados; ações reais do catálogo; **depoimentos fictícios removidos** (prova social honesta); 1 CTA `signal` por tela; reveals de scroll (`.reveal`).
- **Auth split-screen**: form à esquerda (labels visíveis, validação em tempo real com mensagens específicas, mostrar/ocultar senha, magic link visível como "em breve", micro-copy de confiança), painel de marca à direita; transição fluida para `/planos` (FadeIn).
- Verificado: build verde, landing/login/cadastro 200 com conteúdo novo, `prefers-reduced-motion` respeitado em GSAP/Lenis/Motion/CSS, mobile via grid responsivo (split empilha, hero empilha).
- Pendência: arquivos reais de `brand-guide.md`, `logo.svg`, `icon-mark.svg`, `favicon.svg` e fontes Fontshare ainda não estão no repo — estrutura pronta para recebê-los.

## Milestone 8 — Polimento de autoatendimento — 2026-07-18

- **`/status`** (dashboard): saúde da configuração do tenant (persona, base, ações, WhatsApp) + integrações (OpenAI, Stripe, Evolution, Redis) via `src/lib/health.ts`. Link no menu.
- **`GET /api/health`**: verifica o banco (200/503) para monitoramento de deploy.
- **Conta suspensa**: layout do dashboard bloqueia o app e orienta contato (com botão Sair).
- **Estados de erro**: `error.tsx` (boundary com "tentar de novo") no dashboard; `not-found.tsx` global (404). WhatsApp desconectado já tinha botão de reconectar (M5).
- `ARCHITECTURE.md` revisado refletindo o que foi construído; anotações "(Milestone X)" removidas.
- **Critério atendido:** erros tratados, página de status/health disponível, docs finais coerentes. Verificado: build verde (22 rotas); `/api/health`→503 (sem DB, sem crash), `/status`→307, 404 renderiza.

> **MVP concluído** — 8/8 milestones. Para rodar tudo ao vivo: `npm run db:up && npm run db:push && npm run db:seed && npm run dev` (+ `npm run worker`), com `.env` preenchido (OpenAI/Stripe/Evolution opcionais — o app degrada sem eles).

## Milestone 7 — Painel do Admin + Feedback — 2026-07-18

- **Módulo `feedback/`**: `createFeedback` (cliente, tenant-scoped), `listFeedbacks` + `setFeedbackStatus` (admin). **`/feedback`** no dashboard: form com nota (estrelas) + mensagem → server action grava `Feedback`.
- **Módulo `admin/`**: `listTenants`/`getTenantDetail`/`setTenantStatus`/`adminSetPlan` (cross-tenant, SUPERADMIN).
- **Rota `(admin)/`** protegida por `requireSuperadmin`: `admin/contas` (lista tenants + busca; trocar plano; suspender/reativar) e `admin/feedbacks` (lista + filtro por status; mudar status). Server actions revalidam e re-checam SUPERADMIN.
- Docs: READMEs de `feedback` e `admin`.
- **Critério atendido:** superadmin loga, vê todos os tenants e lê feedbacks sem acessar o banco. Verificado: build verde (20 rotas); gating `/admin/contas`, `/admin/feedbacks`, `/feedback` → 307 `/login`. _(Distinção OWNER→/inicio e dados reais exigem Postgres + login como superadmin do seed.)_

### Próximos passos → Milestone 8 (Polimento de autoatendimento)

- Estados de erro (WhatsApp desconectado → reconectar); página de status/health do tenant; revisão final de `ARCHITECTURE.md`.

## Milestone 6 — Follow-up automático + Relatórios — 2026-07-18

- **Worker `workers/follow-up-worker/`** (BullMQ + Redis): job repetível `scan` (`upsertJobScheduler`, padrão 15 min) → `scanAndSendFollowUps` varre conversas sem resposta (dos tenants com `follow_up` ativo), envia follow-up via WhatsApp se conectado, grava a mensagem e marca `followUpSentAt` (não reenvia). Regra pura `isEligible` isolada e testada. Script `npm run worker`.
- **Módulo `reports/`**: `computeTenantReport(tenantId)` → conversas, leads, quentes, agendamentos, precisam-humano, follow-ups enviados e taxa de resposta (conversas com lead 2+ mensagens).
- **`/relatorios`**: grid de cards com os números reais do tenant.
- Docs: READMEs de `reports` e do worker; `worker` no package.json.
- **Critério atendido:** lead sem resposta após o limiar recebe follow-up (uma vez); dashboard mostra números reais. Verificado: build verde; unit test de `isEligible` (regra de disparo). _(Disparo real requer Redis + Postgres + WhatsApp conectado.)_

### Próximos passos → Milestone 7 (Painel do Admin + Feedback)

- Rota `(admin)/` protegida por `SUPERADMIN` (`requireSuperadmin`): `contas/` (lista tenants, suspender/reativar, trocar plano) e `feedbacks/` (lista + filtro/status).
- Formulário de feedback no dashboard do cliente (`/feedback`) gravando `Feedback` vinculado ao `tenantId`.

## Milestone 5 — Motor de Conversa + WhatsApp + Sandbox — 2026-07-18

- **Módulo `whatsapp/`**: interface `WhatsAppProvider` + `EvolutionProvider` (createInstance/getQrCode/sendMessage/parseWebhook para Evolution API v2) + factory `getWhatsAppProvider()`. Degrada sem config.
- **`agent-engine` motor**: `LLMProvider`/`OpenAIProvider` (function calling, `gpt-4o-mini`, degrada sem key), `tools` (schemas + handlers das 5 ações gravando no banco), `conversation` (get/create lead+conversa, histórico), `orchestrator.runAgentTurn` (persona + RAG via `searchSimilarChunks` + histórico → loop de tools máx 3 → resposta).
- **Webhook** `POST /api/webhooks/whatsapp`: mapeia instância→tenant, roda o turno e responde pelo provider. **Sandbox** `POST /api/sandbox`: mesmo motor sem WhatsApp real.
- **`/whatsapp`**: status + botão conectar/QR (server actions) + snippet de site. **`/conversas`**: chat de sandbox + lista de conversas com filtro (novo/morno/quente/precisa-humano) + histórico da conversa selecionada.
- Docs: README de `whatsapp`, README de `agent-engine` atualizado.
- **Critério atendido:** uma mensagem (sandbox ou WhatsApp) passa pelo motor, executa ação e persiste; conversa aparece no histórico. Verificado: build verde (18 rotas); gating `/api/sandbox`→307, webhook junk→200 `{ignored}`, `/whatsapp`→307; unit test do `parseWebhook` (extrai/ignora corretamente). _(Resposta de IA real requer `OPENAI_API_KEY`; envio real requer Evolution API + Postgres.)_

### Próximos passos → Milestone 6 (Follow-up + Relatórios)

- Worker BullMQ (`workers/follow-up-worker/`) lê conversas com `lastInboundAt` sem resposta e sem `followUpSentAt` → dispara follow-up e marca `followUpSentAt`.
- `/relatorios`: nº de conversas, leads capturados, leads quentes, taxa de resposta (do tenant).

## Milestone 4 — Checklist de Onboarding + Configuração do Agente — 2026-07-18

- **Checklist de onboarding** em `/inicio`: 6 passos com status calculado do banco (`src/modules/tenants/onboarding.ts`), barra de progresso e botão "Fazer" por item pendente.
- **`/configuracao`** (3 seções em cards): wizard de Persona → `composeSystemPrompt` salva `AgentConfig` (+ `personaDraft` para reeditar); Base de conhecimento (colar texto ou upload `.txt/.md/.pdf`) com lista e remoção; Ações com toggles e enforcement de `maxActiveActions` por plano.
- **Módulo `knowledge-base/`**: `extract` (pdf-parse v2 via `PDFParse.getText`), `chunk` (~800 chars c/ overlap), `embeddings` (OpenAI `text-embedding-3-small`, degrada sem key), `repository` (ingest/list/delete + `searchSimilarChunks` para o M5). Coluna `embedding vector(1536)` (Unsupported) gravada/consultada via SQL cru.
- **Módulo `agent-engine/`** (início): `ACTION_CATALOG` (5 ações, algumas `stub`) e `persona` (campos do wizard + gerador de prompt).
- Schema: `KnowledgeChunk` (pgvector), `KnowledgeDocument.status`, `AgentConfig.personaDraft`. Placeholders para `/whatsapp`, `/conversas`, `/relatorios`, `/feedback` (navegação sem 404).
- Docs: READMEs de `knowledge-base` e `agent-engine`.
- **Critério atendido:** cliente vê o checklist e conclui cada item sem sair do dashboard; itens mudam de status conforme avança. Verificado: build verde (16 rotas) + testes unitários de `chunkText`/`composeSystemPrompt`. _(Persistência real de persona/docs/ações e embeddings requerem Postgres+pgvector e `OPENAI_API_KEY`.)_

### Próximos passos → Milestone 5 (Motor de Conversa + WhatsApp)

- Interface `WhatsAppProvider` + adapter Evolution API (createInstance/getQrCode/sendMessage/onMessageReceived); tela `/whatsapp` com QR.
- `LLMProvider` (OpenAI function calling); orquestrador: persona + `searchSimilarChunks` (RAG) + histórico → tools ativas → executa ação → responde.
- Webhook `/api/webhooks/whatsapp`; sandbox de chat de teste; tela `/conversas` com histórico e filtros.

## Milestone 3 — Cadastro/Login + Seleção de Plano — 2026-07-17

- Módulo `billing/`: `stripe.ts` (cliente lazy), `checkout.ts` (Checkout Session com `price_data` inline — ADR-002), `service.ts` (`setTenantPlan` idempotente + `isValidPlan`).
- Tela `/planos` (pós-cadastro): grid de planos com `PlanPicker` (client). FREE → `POST /api/plan/free` → `/inicio`. Pago → `POST /api/checkout` → redireciona ao Stripe Checkout.
- Webhook `POST /api/webhooks/stripe`: valida assinatura (corpo cru), `checkout.session.completed` e `customer.subscription.*` atualizam `Tenant.planKey` via metadata `{tenantId, planKey}`; cancelamento → FREE.
- Cadastro agora redireciona para `/planos`; `/inicio` mostra plano atual e banner de sucesso (`?checkout=success`). Degradação graciosa quando Stripe não configurado (aviso + free funciona).
- Docs: billing/README, ADR-002.
- **Critério atendido:** do cadastro ao dashboard sem etapa manual. FREE funciona sem Stripe; fluxo pago usa Stripe modo teste. Verificado auth-gating: `/planos`→307 `/login`, `/api/checkout`→401, webhook sem secret→503. _(Fluxo end-to-end com pagamento real requer chaves Stripe + Postgres rodando.)_

### Próximos passos → Milestone 4 (Checklist + Configuração do Agente)

- `/inicio`: checklist de onboarding com status por item (persona, base, ações, WhatsApp, snippet, teste).
- `/configuracao`: wizard de persona (gera systemPrompt) + objetivo; upload de documento → embeddings (pgvector) no módulo `knowledge-base/`; toggles das ações (`TenantAction`).
- Enforcement de `maxActiveActions` por plano (usar `PLAN_BY_KEY`).

## Milestone 2 — Landing Page — 2026-07-17

- Grupo `src/app/(marketing)/` com layout próprio (Navbar sticky + Footer).
- Hero animado em loop com Framer Motion mostrando os 3 passos (cadastro → integra no site → integra no WhatsApp) + barra de progresso; 100% código, sem vídeo.
- Seções componentizadas (uma por arquivo em `_components/`): `Hero`, `ComoFunciona`, `Beneficios`, `AcoesExemplos`, `ProvaSocial`, `Planos`, `FAQ` (accordion animado), `CTAFinal`.
- Planos vêm de fonte única `src/modules/billing/plans.ts` (reuso na seleção de plano + Stripe no M3).
- Todo CTA aponta para `/cadastro` (verificado: 8 links na home). Placeholder antigo de `page.tsx` removido; `/` agora é a landing (estática).
- **Critério atendido:** landing carrega (HTTP 200), hero anima, todos os CTAs levam a `/cadastro`.

### Próximos passos → Milestone 3 (Cadastro/Login + Seleção de Plano)

- Tela `/planos` pós-cadastro: escolher FREE (libera dashboard direto) ou pago (Stripe Checkout modo teste → webhook provisiona/atualiza plano).
- Módulo `billing/`: cliente Stripe, criação de Checkout Session, `POST /api/webhooks/stripe` (idempotente) atualizando `Tenant.planKey`.
- Ajustar redirect do cadastro para `/planos` (hoje vai direto a `/inicio`).
- Magic Link por e-mail (opcional no MVP — avaliar provider de e-mail).

## Milestone 1 — Fundação — 2026-07-17

- Next.js 16 + TypeScript + Tailwind v4 + UI shadcn-style (Button, Input).
- Prisma 6 + PostgreSQL (pgvector) — schema inicial completo (Tenant, User, AgentConfig, KnowledgeDocument, TenantAction, WhatsappInstance, Lead, Conversation, Message, Feedback).
- Auth.js v5 (Credentials, sessão JWT) com `role`/`tenantId` no token; guards em `src/lib/session.ts`.
- Cadastro (`/cadastro`) → provisiona tenant + owner (`src/modules/tenants/provision.ts`); login (`/login`); dashboard protegido com sidebar e `/inicio` vazio.
- `docker-compose.yml` (Postgres+pgvector, Redis), `.env.example`, seed (superadmin + tenant demo).
- Docs: INDEX, ARCHITECTURE, CONVENTIONS, ADR-001 (pin Prisma 6).
- **Critério atendido:** usuário cadastra, loga e cai em dashboard vazio.

### Próximos passos → Milestone 2 (Landing Page)

- `src/app/(marketing)/` com hero animado (Framer Motion) mostrando 3 passos: cadastro → integra no site → integra no WhatsApp.
- Seções componentizadas: `Hero`, `ComoFunciona`, `Beneficios`, `Planos`, `FAQ`, `CTA`. Todo CTA → `/cadastro`.
- Substituir o placeholder atual em `src/app/page.tsx`.
