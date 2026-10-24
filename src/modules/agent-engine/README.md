# Módulo: agent-engine

## O que faz

Cérebro do produto: recebe uma mensagem, monta o contexto (persona + RAG + histórico), roda function calling com as ações ativas, executa os handlers e devolve a resposta.

## Arquivos

- `actions.ts` — `ACTION_CATALOG` (key, label, descrição, status ready|stub) e `ACTION_BY_KEY`.
- `persona.ts` — `PERSONA_FIELDS` (wizard) e `composeSystemPrompt(answers)` → `AgentConfig.systemPrompt`.
- ~~`llm.ts`~~ — removido. A camada de IA mora em `src/modules/ai` (providers Gemini/OpenAI, catálogo, modelo ativo no banco). Use `import { getLLMProvider } from "@/modules/ai"` — é `async`.
- `tools.ts` — schemas + handlers por ação (`getToolSchemas`, `runToolHandler`). Handlers gravam no banco (lead/conversation).
- `conversation.ts` — `getOrCreateConversation`, `appendMessage`, `getRecentMessages`, `startFreshTestConversation`, `sendManualReply`.
- `orchestrator.ts` — `runAgentTurn({tenantId, conversationId, leadId, userMessage})`: loop de tools (máx 3), RAG via `searchSimilarChunks`, persiste mensagens.
- `reply-sanitizer.ts` — última barreira antes de persistir/enviar: remove variáveis de template não resolvidas (`[Nome]`, `{{push_name}}` etc.) e recompõe a pontuação.
- `variables.ts` — definições por agente e valores por conversa. Nome, número e endereço existem por padrão; as demais são opcionais e configuradas em Agentes › Variáveis.
- `summary.ts` — `summarizeConversation(tenantId, conversationId)`: resumo em texto da conversa, sob demanda, com cache no banco. Ver seção abaixo.
- `disqualify.ts` — motivos da triagem (`DISQUALIFY_REASONS`), rótulos e o custo do atendimento manual que converte triagem em dinheiro. Ver seção abaixo.
- `handoff.ts` — config da ação "Transferir para humano" e `notifyHandoffGroup`: avisa a equipe no grupo interno ao passar para atendimento, sem adicionar o contato. Ver seção abaixo.
- `unanswered-rule.ts` — `unansweredRule(retrieved)`: a regra "nunca invente" que vai no prompt de todo turno com agente, com aviso extra quando a base não tem trecho próximo. Ver seção abaixo.

### Perguntas sem resposta (`report_unanswered`, P-87)

O agente não inventa: o que não está nas instruções, na base ou no resultado
de uma ferramenta vira `report_unanswered({ question })` e a resposta ao
contato é "vou confirmar com a equipe". A tool conta no relatório
(`ReportEvent` `unanswered`) **e** põe a pergunta na fila de `/perguntas`
(`modules/knowledge-gaps`); `handoff_human` com `unanswered: true` faz o mesmo
ao transferir. Com a regra da conta `handoff`, `report_unanswered` também
marca `needsHuman` pelo mesmo `transferToHuman` do `handoff_human`. A tool
continua sem vaga de habilidade. Detalhes em
[`knowledge-gaps/README.md`](../knowledge-gaps/README.md).

## Contratos expostos

```ts
runAgentTurn(input) -> { reply, toolsUsed, status } // status: ok|agent_off|human_handling|no_agent
getOrCreateConversation(tenantId, phone, name?, { isTest? }) -> { lead, conversation }
startFreshTestConversation(tenantId, phone) -> void
sendManualReply(tenantId, conversationId, text) -> { ok: true } | { ok: false, error }
summarizeConversation(tenantId, conversationId) -> { ok: true, summary, summaryAt, messageCount } | { ok: false, error }
composeSystemPrompt(answers): string; ACTION_CATALOG: ActionDef[]
getHandoffConfig(agentId) -> HandoffConfig            // para a tela preencher o formulário
saveHandoffConfig(tenantId, agentId, config) -> void
notifyHandoffGroup(tenantId, agentId, conversationId, { isTest?, reason? }) -> void  // nunca lança
listWhatsAppGroups(tenantId) -> { ok: true, groups } | { ok: false, reason, error }  // nunca lança
handoffToolDescription(config?) -> string              // descrição de handoff_human com o motivo
```

Consumidores: `api/webhooks/whatsapp` (WhatsApp real) e `api/sandbox` (chat de teste).

### Variáveis da conversa

`Agent.variableDefinitions` guarda até 20 chaves personalizadas com descrição.
`Conversation.variables` guarda só os valores informados naquela conversa;
ausência aparece como "não informado" na lista recolhível em `/conversas`.
**Toda variável nasce "não informado" e só é preenchida pelo que a conversa
revelar.** A única exceção é `{{numero}}`: o telefone é a identidade do contato
no WhatsApp, o sistema já o conhece antes da primeira mensagem e o agente não
tem como perguntá-lo a quem está falando pelo próprio telefone — por isso ele é
controlado pelo sistema e `remember_variables` o recusa. `{{nome}}` **não** é
pré-preenchido com `Lead.name`: esse valor pode ser o apelido do perfil (ou
"Chat de teste", no sandbox), e mostrá-lo faria a tela afirmar que o contato
informou um nome que nunca disse. No chat de teste nem `{{numero}}` nasce
preenchido, porque `sandbox:<agentId>` não é um telefone. Definições inválidas
na leitura são ignoradas, e a escrita recusa chaves duplicadas ou que tentem
substituir as três padrão.

Conversas anteriores a essa regra têm o nome do perfil e o número sintético já
gravados; `scripts/limpa-variaveis-herdadas.ts` limpa o resíduo uma vez. Ele
não mexe no `{{nome}}` de conversa real de propósito: `remember_variables`
grava o nome dito **e** atualiza `Lead.name`, então os dois serem iguais não
distingue o valor herdado do legítimo.

**Resumir a conversa também preenche as variáveis** (`summary-variables.ts`).
As variáveis só se preenchem quando o agente chama `remember_variables`
durante o turno, o que deixa de fora todo o passado: conversa anterior à
variável existir, conversa atendida à mão, conversa em que o agente não chamou
a tool — o dado está escrito no histórico e a tela diz "não informado". Como o
resumo já relê a conversa inteira numa chamada que o dono pediu, o mesmo
retorno traz um bloco `<variaveis>` com os valores encontrados: recupera o
passado **sem uma segunda chamada paga**. O bloco é arrancado do texto antes de
exibir (é protocolo interno, não faz parte do resumo) e só as chaves ausentes
são pedidas — o que o agente guardou ao vivo tem prioridade sobre a releitura e
nunca é sobrescrito. O modelo é instruído a escrever "não informado" quando o
dado não aparece, e esses valores são descartados: sem essa saída explícita um
modelo pressionado a preencher todo campo preenche com o que é *provável*, que
é justamente o erro que não se pode cometer com dado de cliente. A gravação
acontece depois do resumo e num `try` próprio — a extração é um brinde da mesma
chamada e não pode derrubar o que a pessoa pediu.

O contexto do turno mostra as definições e os valores ao agente. A tool interna
`remember_variables` atualiza os valores informados, sem consumir uma vaga de
habilidade; chaves não configuradas e valores vazios são recusados. Ao mudar
`{{nome}}`, o nome do contato também é atualizado. A resposta final substitui
valores conhecidos e remove tokens ausentes antes de salvar ou enviar; o
follow-up aplica a mesma barreira. Lembretes aceitam as variáveis da conversa
como extras, além de data/hora/local da consulta. Exportar ou duplicar o agente
leva as definições, nunca os valores das conversas.

### Conversa de teste (sandbox)

`getOrCreateConversation` com `isTest: true` cria lead/conversa marcados — ficam
fora de Contatos e Relatórios, mas **aparecem em `/conversas`** (aba "Testes"),
com histórico permanente. O botão "Recomeçar" do sandbox chama
`startFreshTestConversation`: em vez de apagar, arquiva a conversa atual
(muda o telefone para `sandbox:<agentId>:archived:<timestamp>`, fora do
caminho de busca) e libera o telefone canônico para nascer vazio na próxima
mensagem — a IA não recomeça vendo o histórico do teste anterior, mas nada é
perdido do lado do usuário.

#### O teste não ocupa a agenda real (`dryRunScheduling` / `ToolContext.dryRun`)

Os dois caminhos de teste (`/api/sandbox` e `sendTestClientMessage`) passam
`dryRunScheduling: true`, que o orquestrador põe em `ToolContext.dryRun`. Com
a marca, `schedule_meeting`, `reschedule_meeting` e `cancel_meeting` fazem
toda leitura e validação (antecedência, expediente, conflito em todas as
agendas via `hasConflictAnywhere`; nas trocas e cancelamentos, também o
`confirmed` do cliente — `schedule_meeting` não tem essa confirmação) mas
**não gravam `Appointment` nem chamam Clinicorp, Google ou iCloud**. A gravação
e os espelhos moram em `createAppointment`, `rescheduleAppointment` e
`cancelAppointment` (`scheduling/repository.ts`), que o ramo simulado não
alcança. Cada tool devolve uma frase "Simulação: ... seria marcado/remarcado/
cancelada", que manda o agente seguir como se tivesse acontecido, sem dizer que
é simulação. Sem a marca (WhatsApp, widget) nada muda. A futura rota MCP deve
ligar a mesma flag.

**Ativação:** nenhuma variável de ambiente, flag de painel, migração ou config.
Vale para todo turno que passa pelas duas rotas de teste, e só para elas.

**Limites da simulação:** não reserva o horário, então dois pedidos seguidos do
mesmo horário recebem "livre" nos dois. Não enxerga corrida com outra marcação
(o `unavailable` da remarcação real não se reproduz). Como não cria registro, a
idempotência de `findOwnAppointment` não se aplica: repetir o pedido na mesma
conversa simula de novo.

**Como testar:**
- Automático: `npx vitest run tests/agendamento-simulacao.test.ts` (10 casos:
  simulação não grava nem espelha; simulação ainda recusa horário ocupado ou
  fora do expediente, e exige `confirmed`; fluxo real sem a marca segue igual).
- Manual, no chat de teste com a agenda e uma conta com Clinicorp/Google/iCloud
  conectados: pedir um horário livre (resposta "Simulação"), remarcar e cancelar
  (pedir confirmação antes). Conferir em `/agenda` e em `Appointment` que nada
  mudou e que nenhum evento apareceu nos calendários conectados.

#### O teste responde com o agente desligado (`skipEnabledCheck`)

`Agent.enabled` é a chave geral, e desligada ela cala o agente **para o
cliente** — WhatsApp e widget do site. O chat de teste é a exceção: os dois
caminhos de teste (`/api/sandbox` e `sendTestClientMessage`) passam
`skipEnabledCheck: true`, e o gate de `agent_off` em `runAgentTurn` só vale
sem essa marca.

Existe pelo mesmo motivo do `skipUsageCheck` ao lado: desligar o agente é
justamente o que se faz para mexer nele. Com o sandbox mudo, conferir uma
mudança de persona exigia religar a chave — ou seja, voltar a atender cliente
de verdade com a versão que ainda estava sendo ajustada, que é o oposto do
que a chave existe para permitir.

Só o teste ganha a exceção. As outras pausas continuam valendo lá dentro:
`agentPaused` (humano assumiu a conversa) é checado antes e cala o teste
também — um humano no comando de uma conversa é um fato sobre aquela
conversa, não sobre o canal.

#### Escrever dos dois lados dentro da conversa de teste

Numa conversa com `isTest: true`, a caixa de resposta de `/conversas` ganha um
seletor de lado (`SendMessageForm`, `SegmentedControl` "você | cliente"):

O modo inicial é **cliente** em cada conversa de teste aberta. A escolha manual
vale durante aquela abertura; trocar de conversa remonta o formulário pelo ID.
Conversas reais continuam iniciando como **você**.

| lado | action | o que acontece |
| --- | --- | --- |
| **você** | `sendManualMessage` → `sendManualReply` | grava `assistant`/`sentBy: "human"` e liga `agentPaused` |
| **cliente** | `sendTestClientMessage` → `runAgentTurn` | grava `user` e o agente responde de verdade |

Existe porque testar de dentro de uma conversa aberta era meio caminho: a
caixa só sabia escrever como o dono da conta (e ainda pausava a IA), então
para ver o agente responder era preciso sair para o diálogo "Testar agente" —
que sempre começa do zero, sem o histórico da conversa aberta.

`sendTestClientMessage` recusa qualquer conversa que não seja de teste
(`isTest: true` no `where`, junto do `tenantId`): forjar numa conversa real uma
mensagem "do cliente" que ele nunca mandou envenenaria o histórico e os
relatórios. Usa `skipUsageCheck: true` e `skipEnabledCheck: true` pelo mesmo
motivo do `/api/sandbox` — teste não é atendimento.

O `status` do turno volta para a interface e vira aviso quando o agente fica
calado (`human_handling` = pausado nesta conversa, `no_agent`,
`limit_reached`). Sem isso, escrever como cliente e não ver resposta parecia
bug, sendo que cada um desses silêncios é o comportamento correto — só que por
uma causa diferente. `agent_off` não chega por aqui: o teste responde com a
chave geral desligada (ver abaixo).

O seletor nasce **recolhido**, atrás de um botão "Enviando como você/cliente":
aberto, ele custava duas linhas acima do campo em toda mensagem enviada. O
lado atual continua impresso no próprio botão quando fechado — esconder o
controle não pode esconder o estado.

### Resposta manual e humano assumindo a conversa (`sendManualReply`, `agentPaused`)

`sendManualReply(tenantId, conversationId, text)` é o núcleo de "o dono da
conta respondeu pelo painel em vez do agente" — usado por
`conversas/actions.ts` (`sendManualMessage`, a partir de uma conversa aberta)
e `contatos/actions.ts` (`sendMessageToContact`, a partir de um lead); as duas
telas faziam essa lógica em duplicado, cada uma só com metade do cuidado,
antes desta função existir. Numa conversa real envia de verdade pelo
`WhatsAppProvider` **do número em que o contato escreveu** (`Conversation.whatsappProvider`,
ver `modules/whatsapp/instances.ts`): com a Evolution e a Meta conectadas, o número
dele fora do ar vira erro na tela dizendo qual reconectar — nunca envio pelo
outro número. Numa conversa de teste (sandbox) só grava, sem WhatsApp envolvido.

Sempre grava com `sentBy: "human"` e liga `Conversation.agentPaused`.
`runAgentTurn` checa `agentPaused` logo no início: se ligado, persiste a
mensagem do contato e retorna `status: "human_handling"` sem gerar resposta —
só nesta conversa, as outras do mesmo agente continuam normais. Diferente de
`Agent.enabled` (`agent_off`), que é a chave geral e cala o agente em todas as
conversas de cliente — mas não no chat de teste (`skipEnabledCheck`).
"Reativar agente" desliga `agentPaused` e `needsHuman`. Se o agente atribuído foi
removido, arquivado ou desligado, a conversa passa para o agente ativo padrão.
O webhook do WhatsApp e o widget usam o agente atribuído no próximo turno.
Se a última mensagem real ainda não tem resposta, a reativação pede ao próprio
agente para respondê-la, sem gravar a fala do contato de novo. O envio usa o
mesmo número da conversa e uma trava por mensagem; falha incerta não é
reenviada automaticamente. Conversa de teste e widget não fazem envio retroativo.

Mensagens `role: "assistant"` carregam `sentBy: "agent" | "human" | null`
(`Message.sentBy`) para diferenciar quem gerou a resposta — `role` continua
igual nos dois casos, então o histórico que `getRecentMessages` devolve para
o LLM não muda; `sentBy` é metadado só para UI/auditoria.

### Datas relativas e histórico de outro dia (`time-context.ts`)

O histórico vai ao LLM sem data. Um lembrete da véspera ("consulta amanhã às
10:45") continua lá na manhã seguinte, e o agente repetia "te esperamos
amanhã" no dia da consulta. Por isso, em **todo turno** (com ou sem
agendamento), `conversationTimeContext` põe no system prompt, logo depois da
persona: a data e hora de agora no fuso da agenda (padrão
`America/Sao_Paulo`), a regra de nunca copiar "hoje"/"amanhã" do histórico
nem dos exemplos da persona e, quando o histórico começa em outro dia, onde
fica essa fronteira. `leadAppointmentsContext` (também a tool
`list_appointments`) devolve cada consulta com o dia relativo **calculado no
servidor** ("é HOJE, às 10:45"). Um único `now` por turno alimenta os três.

- O aviso vai no system prompt, nunca como mensagem `system` no meio do
  histórico: o Gemini junta todas num bloco só e a posição se perde.
- Não prefixe data no conteúdo das mensagens do agente: o modelo imita o
  prefixo nas respostas. No follow-up com IA (`follow-up/compose.ts`) o
  prefixo é seguro porque a conversa vai como UMA mensagem de usuário.
- Texto do contato nunca é citado no aviso — só a nossa própria mensagem.

### Resumo da conversa (`summary.ts`)

`summarizeConversation(tenantId, conversationId)` gera um resumo em texto do
que foi conversado — "o que o cliente quer / onde parou / próximo passo", mais
uma linha "Atenção:" quando aparece orçamento, data, objeção ou reclamação.
Existe porque o painel só sabia mostrar a conversa inteira: resolve o caso de 6
mensagens e falha no de 60, onde saber se o cliente já visitou o imóvel exigia
reler tudo a cada vez que a conversa era reaberta.

Grava em três colunas de `Conversation`:

| coluna | o que é |
| --- | --- |
| `summary` | o texto. `null` = nunca resumida |
| `summaryAt` | quando foi gerado (a UI mostra "há X") |
| `summaryMsgCount` | quantas mensagens existiam na hora |

**Sob demanda, nunca automático.** Resumir dentro de `runAgentTurn` dobraria o
gasto de tokens de toda mensagem recebida — e esse consumo conta na cota do
plano (`modules/billing/usage.ts`) — para produzir um resumo que talvez
ninguém leia. Quem paga o resumo é quem clica em "Resumir conversa".

**`summaryMsgCount` é o que torna o cache honesto.** Comparado com a contagem
atual de mensagens, permite a interface dizer "4 mensagens novas desde este
resumo" sem gastar uma chamada para descobrir. A UI **não regera sozinha**
nesse caso: um resumo velho que se anuncia velho é melhor do que um custo
silencioso a cada abertura de conversa.

Outros detalhes que valem saber antes de mexer:

- **Sem tools** (`complete(messages, [])`): é leitura pura; passar os schemas
  de ação abriria espaço para o modelo tentar agendar reunião no meio de um
  resumo.
- **Máximo de 60 mensagens** no prompt (`MAX_MESSAGES_IN_PROMPT`), as mais
  recentes, mas reordenadas em ordem cronológica antes de ir ao modelo —
  mandar o histórico de trás para frente produzia resumo invertido.
- **Mínimo de 4 mensagens** (`MIN_MESSAGES_TO_SUMMARIZE`): abaixo disso ler é
  mais rápido, e o servidor recusa (o cliente espelha a constante só para
  esconder o botão).
- **A gravação usa `$executeRaw`, não `prisma.conversation.update`**, porque
  `updatedAt` tem `@updatedAt`: qualquer escrita pelo client o reescreveria, e
  essa coluna ordena a caixa de entrada — gerar um resumo não pode empurrar a
  conversa para o topo como se o cliente tivesse escrito. O `tenantId` continua
  no `WHERE`.
- **Fallback próprio** (Gemini → Grok → Groq), duplicando a ideia do
  orquestrador em vez de reusar a função dele: mantém o caminho quente do
  atendimento livre de parâmetros que só o resumo precisa. O uso de tokens é
  registrado com `recordUsage` no provider que de fato respondeu.

Onde aparece: `conversas/ConversationSummary.tsx` (bloco no `LeadPanel`, no
topo do `ConversationThread` em xl+ — ali dentro de um `<details>` **fechado
por padrão**, porque aberto comia um terço da altura do histórico, que é a
área que importa naquela coluna; o texto completo continua sempre visível na
coluna do cliente, então ali ele é atalho, não a via principal — e no
`<details>` mobile) e, como texto
pronto, nas linhas e cards de `/contatos` — lá o resumo substitui a prévia da
última mensagem quando existe, porque "ok, obrigado" não diz nada sobre o que
o cliente queria. A action é `generateConversationSummary` em
`conversas/actions.ts`.

### Transferir para humano e o grupo do WhatsApp (`handoff.ts`)

**O grupo é interno da clínica. O lead nunca é adicionado.** Ao entrar em
prioridade, a equipe recebe um aviso no grupo já configurado e depois contata o
lead pelo número de atendimento.

| caminho | onde | o que marca |
| --- | --- | --- |
| tool `handoff_human` | `tools.ts` (o LLM decide) | `needsHuman` |
| reação do atendente pelo número da empresa | webhook do WhatsApp | `needsHuman` + `agentPaused` |

A reação depende de `Agent.stopOnEmoji`, ligado por padrão. Reação do cliente
e mensagem só de emoji não pausam o agente. A tool usa `updateMany` condicional
por conversa + tenant + `needsHuman: false`: repetir a tool não repete o aviso.

A config vive em `TenantAction.config`, chave `handoff_human`, por agente:

```ts
type HandoffConfig = {
  notifyGroup: boolean;
  groupId: string | null;   // JID "...@g.us"
  groupName: string | null; // só exibição
  groupReason: string;     // quando avisar a equipe, nas palavras do dono
}
```

**Compatibilidade:** `parseHandoffConfig` lê `addToGroup` das configs antigas
como `notifyGroup`, preservando grupo, nome e motivo. Não autoriza convites.
Se ambas as chaves existem, `notifyGroup` prevalece, inclusive `false`. Ao
salvar, o formulário grava apenas a chave nova. Não requer mudança de schema.

`notifyHandoffGroup(tenantId, agentId, conversationId, options)` consulta a
conversa e o lead da conta e envia exatamente três linhas:

```text
Nome: Luciane Aparecida Dos Santos
Número: +55 14 99763-1563
Resumo: [o que o lead quer e por que é prioridade]
```

Reusa `Conversation.summary`, limitado a 600 caracteres em uma linha, e
acrescenta o motivo atual da tool (até 300 caracteres) se ainda não está no
resumo. Sem resumo salvo, usa as três últimas mensagens do contato em ordem
cronológica; sem dados, informa a ausência. Não gera uma segunda chamada de
IA nem grava o aviso como resposta ao lead.

**Envio:** `WhatsAppProvider.sendGroupMessage` →
`POST /message/sendText/{externalId}` com `{ number: groupId, text }` na
Evolution — sempre pela conexão do **QR**, mesmo que o contato tenha falado pela
Meta (que não tem grupos). O método só aceita JID de grupo. A operação de inclusão de
participantes foi removida do contrato e dos adapters. Nunca chamar
`/group/updateParticipant` no fluxo de prioridade.

Regras que precisam permanecer:

- A ação tem que estar `enabled`: quem age lê `getActiveHandoffConfig`,
  enquanto `getHandoffConfig` só preenche a tela, mesmo com a ação desligada.
- Config e conversa são consultadas com `tenantId`. `isTest` na conversa ou
  no lead impede o envio real, mesmo sem opção passada pelo chamador.
- `notifyGroup` nunca fica ligado sem `groupId`. O formulário recusa o ID
  inválido antes de normalizar, para não dizer "salvo" com a opção desligada.
- Desligar preserva grupo e motivo. Campos ficam escondidos, não desmontados.
- Banco, provider e rede ficam dentro do `try`: uma falha no aviso nunca
  desfaz o handoff nem causa 500 com reentrega em laço no webhook.
- A conexão precisa estar ativa e configurada. Na Meta este envio não existe:
  a transferência principal continua, sem tentar mandar o aviso a uma pessoa.

**Escolha do grupo:** `listWhatsAppGroups` nunca lança e busca sob demanda
`GET /group/fetchAllGroups?getParticipants=false`. A tela usa `SelectMenu`;
falha/desconexão oferecem tentar novamente ou colar o ID. Lista vazia orienta
criar um grupo; Meta só mostra a limitação. O grupo salvo que sumiu continua
como opção "não encontrado", evitando apagar a escolha sem pedido. O número
conectado precisa participar e poder enviar mensagens, sem exigir admin.
`normalizeGroupId` aceita JID completo ou dígitos, mas recusa JID de pessoa.

**Motivo na tool:** `handoffToolDescription` acrescenta "Use sempre que:
<motivo>" como gatilho adicional, sem proibir os demais motivos de transferência.
Só vale com aviso ligado; desligado, o motivo fica guardado e sem efeito.
A descrição informa que o contato nunca é adicionado ao grupo.

Regressões em `tests/handoff-grupo.test.ts`: config legada, formato, isolamento
por tenant, testes sem efeito externo, falhas e simulação tool → Evolution.
A simulação verifica uma única mensagem no grupo e participantes inalterados.

### Triagem de contatos (`disqualify.ts`, tool `disqualify_lead`)

A ação **"Triagem de contatos"** deixa o agente encerrar sozinho quem não é
cliente em potencial — vendedor, parceria, currículo, trote, engano, fora da
área atendida. Sem ela, todo contato desses ou vira fila para uma pessoa ou
some sem registro.

**Desqualificado não é perdido.** `Lead.disqualifiedAt` é "nunca foi cliente";
`Lead.status: "lost"` é "era cliente e não fechou" (quis, sumiu, escolheu
outro). Contar os dois juntos apagaria exatamente o que a clínica quer ver.
Por isso o carimbo é um campo próprio e não um status novo.

**O carimbo é sempre explícito**, nunca inferido do texto da conversa: ele vira
dinheiro na visão Financeira de /relatorios, e um palpite ali é um número que
o cliente confere contra a própria folha de pagamento e não bate.

Três detalhes do handler que não são acidentais:

- **`updateMany` com `tenantId` no filtro**, não `update` por id cru — o id vem
  do contexto do turno, e escrever por id sem o tenant é o tipo de caminho em
  que um id trocado atravessa conta sem ninguém perceber.
- **`disqualifiedAt: null` no filtro**: mantém o PRIMEIRO carimbo. O contato que
  volta e é desqualificado de novo não pode entrar no relatório de dois meses.
- **Não marca `needsHuman` e não encerra a conversa.** O ponto da triagem é
  justamente não ocupar uma pessoa; e se o contato responder de novo, o agente
  segue atendendo normalmente.

O motivo (`parseReason`) **nunca recusa** a desqualificação: valor fora da lista
vira `"outro"`. O valor está no carimbo, o motivo é o detalhe — perder a triagem
inteira porque o LLM inventou uma string seria trocar o dado pelo enfeite.

A conversão para tempo/dinheiro mora em `TenantAttendanceCost` (minutos por
atendimento × custo da hora), declarado pela clínica em /relatorios. Sem isso,
o relatório mostra só a contagem e convida a definir — nunca uma média do
sistema apresentada como fato.

### Duplicar, exportar, importar e replicar agentes

O formato portátil mora em `agent-package.ts`; leitura e criação ficam em
`transfer.ts`. O pacote `.fechai-agent.json` é versionado e contém persona,
prompt, comportamentos, ações com seus `config` e o texto integral dos
documentos do Cérebro.

Ao criar uma cópia, os documentos passam novamente por `ingestDocument`: os
chunks e embeddings precisam nascer com o novo `agentId`; copiar linhas cruas
misturaria o RAG dos agentes. A operação apaga a cópia incompleta se qualquer
etapa falhar.

Não entram conversas, contatos, agendamentos nem posição de agente principal.
A cópia sempre nasce desligada. Voz pronta do catálogo é portável; voz gravada
não é, porque compartilhar o mesmo modelo faria excluir/regravar em um agente
quebrar o outro e transferiria uma voz pessoal para outra empresa.

O cliente duplica e exporta em `/agentes/[id]`, importa em `/agentes`. O
superadmin replica entre tenants em `/admin/agentes`; o limite de agentes e de
ações do plano de destino continua valendo.

## O que NÃO faz

- Não fala com o WhatsApp — quem envia é o `whatsapp` provider (chamado pelo webhook, ou por `sendManualMessage` numa resposta manual).
- Não dispara follow-up no tempo — isso é o worker (`workers/follow-up-worker/scan.ts`). A tool `follow_up` só registra como o contato deixou a conversa (`followUpReason`: não quer agendar agora, ou pediu para parar), que decide a esteira.
- Não resume conversa sozinho: `summarizeConversation` só roda quando alguém pede pela interface (ver seção acima).
- Não decide sozinho quanto vale o tempo economizado pela triagem: a régua (minutos e custo/hora) é declarada pelo dono da conta em /relatorios.
