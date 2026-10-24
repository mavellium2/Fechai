# Módulo: agent-mcp

## O que faz

Servidor MCP (Model Context Protocol) do agente, em `POST /api/mcp`. Deixa uma
ferramenta de IA externa (Claude Code, por exemplo) **ler a configuração dos
agentes de uma conta** e, com a permissão de simulação, **conversar com eles em
modo de teste**, com um token emitido pelo superadmin. Parte A do plano: tokens,
rota e leitura. Parte B: simulação (`simulate`), ver "Simulação pelo MCP".
Propostas de mudança (`propose`) vêm na parte C; o escopo já existe no schema,
mas ainda não pode ser emitido.

## Arquivos

- `tokens.ts` — emitir, listar, revogar. `fch_mcp_` + 32 bytes aleatórios em base64url.
- `auth.ts` — `Authorization: Bearer`, busca por hash, recusa revogado/vencido, marca `lastUsedAt`.
- `rpc.ts` — JSON-RPC 2.0 mínimo, sem estado e sem dependência (`initialize`, `ping`, `tools/list`, `tools/call`). Também os limites e o teto do corpo.
- `tools.ts` — registro das ferramentas (`list_agents`, `get_agent_config`, `run_simulation`, `get_simulation`) e as `annotations` anunciadas em `tools/list`.
- `read.ts` — a leitura filtrada da configuração.
- `simulate.ts` — simulação de conversa (`run_simulation`, `get_simulation`), limite de turnos por token e máscara da saída.
- `errors.ts` — `McpToolError` (vira `isError: true`) e `McpRateLimitedError` (vira 429).
- Rota: `src/app/api/mcp/route.ts` (só POST, runtime Node). Admin: `src/app/(admin)/admin/agentes/mcp/`.
- Exemplo de cliente: `.mcp.json.example` na raiz (sem token; o valor vem da variável `FECHAI_MCP_TOKEN`).
- Testes: `tests/agent-mcp.test.ts`, `tests/agent-mcp-simulacao.test.ts` (parte B), mais `tests/autorizacao.test.ts` (rota com autenticação antes do corpo).

## Regras que não podem ser quebradas

- **A conta sai SÓ do token.** Nenhuma ferramenta tem `tenantId` no esquema, e o
  esquema é `.strict()`: um `tenantId` (ou qualquer argumento não declarado) volta
  como parâmetro inválido, nunca é ignorado. `agentId` é só um filtro dentro da
  conta; id de outra conta responde igual a id inexistente ("não encontrado").
- **Todo acesso ao banco leva o `tenantId` do token** (agente, ações e a consulta de
  documentos). A leitura (`read`) não consulta `Lead`, `Message`, `Conversation`,
  `Appointment` nem `Tenant`. A simulação (`simulate`) cria e lê **só** conversas
  de teste dela mesma (`isTest` e telefone `mcp:`), também com o `tenantId` do
  token. A autenticação lê só `Tenant.status`, pela relação do token, para recusar
  conta suspensa.
- **O token em claro existe em um lugar só:** o retorno de `issueMcpToken`, mostrado
  uma vez no admin. O banco guarda o sha256 (`tokenHash`, único) e 8 caracteres do
  trecho aleatório (`tokenPrefix`; o `fch_mcp_` é igual em todos e não ajudaria a
  reconhecer). Não grave nem logue o token; a auditoria registra id, prefixo,
  permissões e validade, nunca o token nem o hash. Sha256 sem sal é intencional:
  são 256 bits de entropia, não uma senha digitada.
- **Só header.** Token em query string não é aceito (URL vai para log e Referer).
- **Revogar vale na hora:** a autenticação lê `revokedAt` do banco a cada chamada,
  sem cache. Validade padrão de 30 dias (1 a 365). Conta suspensa recusa o token (403).
- **Códigos de erro e limites** estão na tabela "Erros e limites", abaixo. Não
  mude um status sem atualizar a tabela e o teste.
- **A saída é uma lista de permissões** (`read.ts`). Config de ação passa por
  `publicActionConfig`, que escreve campo a campo o que sai; campo novo numa config
  não aparece até alguém decidir. Nunca saem: `voiceId` (só `hasVoice`), JID e nome
  do grupo (só `hasGroup`), ids de Clinicorp, categorias e aceite de risco do QR,
  template da Meta, credenciais, `ownerNames`, valores de variáveis de conversa e
  o conteúdo dos documentos (só título, tamanho em caracteres e situação). Os
  resumos de uma linha (`summary`) também não citam o nome do grupo.
- Mudar o que uma ferramenta devolve exige atualizar `tests/agent-mcp.test.ts`, que
  usa valores-isca para provar o que não vaza.

## Ferramentas

| nome | escopo | entrada | saída |
| --- | --- | --- | --- |
| `list_agents` | `read` | nenhuma | `{ agents: [{ id, name, isPrimary, enabled }] }` |
| `get_agent_config` | `read` | `{ agentId }` | persona, `systemPrompt`, `behavior`, `variables`, `actions`, `knowledge` |
| `run_simulation` | `simulate` | `{ agentId, messages, variant? }` | `{ simulationId, runs: [{ variant, turns: [{ user, reply, toolsUsed, status }] }], dryRun: true }` |
| `get_simulation` | `simulate` | `{ simulationId }` | `{ simulationId, agentId, runs: [{ variant, turns: [{ user, reply }] }], dryRun: true }` |

As de `read` se anunciam com `readOnlyHint: true`; `run_simulation` com
`readOnlyHint: false` (grava uma conversa de teste e custa LLM), sempre
`destructiveHint: false` e `openWorldHint: false`. As duas famílias são
independentes: um token só com `simulate` não vê `list_agents`, então, para
descobrir os ids, emita `read` + `simulate`.

`get_agent_config` devolve: `persona` (nome do agente e da empresa, setor, tom,
estilo, oferta, objetivo, regras), `systemPrompt`, `behavior` (ouvir áudio, parar
com emoji, responder em voz, estilo da voz e `hasVoice`), `variables` (chave e
descrição, sem valores), `actions` (chave, nome, ligada, resumo e config pública de
cada habilidade) e `knowledge` (título, tamanho em caracteres e situação de cada
documento). O que não sai está na regra "A saída é uma lista de permissões", acima.

Falha esperada (agente não encontrado) volta como resultado com `isError: true`;
argumento inválido e ferramenta desconhecida, como erro JSON-RPC `-32602`.
Ferramenta chamada sem o escopo dela responde 403.

## Simulação pelo MCP

`run_simulation` roda o **mesmo motor do chat de teste** (`runAgentTurn`) e nada
mais. Regras:

- **Uma conversa nova por chamada**, `isTest: true` no lead e na conversa, com o
  telefone sintético `mcp:<agentId>:<simulationId>` (`simulationId` é um UUID
  novo). As `messages` (1 a 10, até 1000 caracteres cada) são as falas do contato,
  na ordem, na mesma conversa. Como é `isTest`, fica fora da cota, dos relatórios,
  dos lembretes, do follow-up, da pesquisa de satisfação, da fila de perguntas sem
  resposta, da qualidade dos leads e do aviso de transferência ao grupo — todos já
  filtram `isTest`. Aparece em `/conversas`, na aba de testes.
- **Cada turno liga as três travas do chat de teste:** `skipUsageCheck` (não
  conta na cota), `skipEnabledCheck` (responde com o agente desligado) e
  `dryRunScheduling` (marcar/remarcar/cancelar só descrevem o que aconteceria: sem
  `createAppointment`, sem Clinicorp, Google ou iCloud).
- **Nada fala com o WhatsApp.** Quem envia é o webhook e o worker; a simulação
  chama só `getOrCreateConversation` e `runAgentTurn`, e o orquestrador não envia
  (só grava a resposta). O teste prova isso com o turno real e os provedores,
  espelhos e `fetch` vigiados.
- **O agente é buscado com o `tenantId` do token** (`archived: false`); id de outra
  conta responde "Agente não encontrado nesta conta." antes de qualquer custo.
- **Saída mascarada:** a fala do contato e a resposta passam por `maskText`
  (`knowledge-gaps/mask.ts`: e-mail, telefone e documento viram `[e-mail oculto]`/
  `[número oculto]`). `toolsUsed` traz só os nomes das ferramentas, nunca
  argumentos ou resultados. Turno que lança vira `status: "error"`, sem detalhe
  técnico (vai ao log), e a simulação para ali; status diferente de `ok` também para.
- **Variantes:** só `current` (o agente como está). `proposal` e `both` já estão no
  esquema, para a API não mudar, mas respondem `isError` "Variante disponível após
  a aprovação de propostas." (parte C). Quando chegarem, a proposta entra pelo
  `systemPromptOverride` de `runAgentTurn` (ver `agent-engine/README.md`), que hoje
  nenhum chamador liga.
- **Limite próprio:** 30 turnos a cada 10 minutos por token (`SIMULATION_LIMIT`,
  `rateLimitReserve("mcp:simulate", tokenId, …, n)`), além das 120 chamadas/min
  gerais. O saldo do pedido inteiro (`n` = número de mensagens) é reservado numa
  operação só (`INCRBY n`) **antes** de criar a conversa. Se não cabe, as `n`
  voltam (`DECRBY n`), responde 429 com `Retry-After` e nenhum turno roda: um
  pedido recusado não consome o saldo, e o que sobrou serve a um pedido menor.
- **Pode demorar vários minutos.** Cada mensagem é uma chamada de LLM, em
  sequência, e o `simulationId` só volta no fim da chamada. Com 10 mensagens, o
  cliente MCP deve esperar a resposta (aumente o timeout dele); se desistir antes,
  o `simulationId` se perde, embora a conversa fique gravada como teste. Prefira
  poucas mensagens por chamada (3 a 5). Decisão documentada: o fluxo não muda
  (sem tarefa em segundo plano nem id devolvido antes).

`get_simulation` relê o transcript (falas e respostas, mascaradas) só de conversa
com `tenantId` do token, `isTest` no lead e na conversa, e telefone exatamente
`mcp:<agente>:<simulationId>`. Conversa real, chat de teste do painel
(`sandbox:`) e simulação de outra conta respondem "Simulação não encontrada nesta
conta.". Não traz `toolsUsed` nem `status` (o banco não guarda por turno) e não
gasta o limite de turnos.

## Como emitir e revogar

**Quem:** só superadmin. Entrada: `/admin/agentes`, botão "Acesso MCP" (ou direto
em `/admin/agentes/mcp`). As actions (`issueMcpTokenAction`,
`revokeMcpTokenAction`) chamam `requireSuperadmin` a cada chamada: esconder a tela
não autoriza.

**Emitir:** escolha a conta, o nome (até 80 caracteres), as permissões e a
validade (de 1 a 365 dias; padrão 30). O token aparece uma vez, com botão de
copiar. Fechou a tela, não há como vê-lo de novo: emita outro e revogue o antigo.
Emissão tem teto de 10 por minuto por superadmin.

**Escopos `read` e `simulate` na emissão.** A tela lista os três escopos; "Ler a
configuração do agente" e "Simular conversas (sem enviar nada)" estão
habilitados, `propose` aparece desabilitado e `validateIssueInput` o recusa na
action. A lista é `EMITTABLE_MCP_SCOPES` em `tokens.ts`: `MCP_SCOPES` mantém os
três porque a autenticação e o schema já os conhecem (parte C). Liberar um escopo
é ampliar `EMITTABLE_MCP_SCOPES`, e só faz sentido junto da ferramenta que o usa
(`simulate` foi liberado na parte B, com `run_simulation`/`get_simulation`).

**Lista:** nome, conta, prefixo, permissões, situação (ativo, revogado ou vencido;
revogado vence vencido), vencimento e último uso. Nunca mostra o hash.

**Revogar:** pede confirmação e vale na próxima chamada. Não tem desfazer.

**Auditoria:** `mcp.token_issued` e `mcp.token_revoked`, no grupo `admin`, visíveis
em `/admin/logs`. Os dois são não revertíveis (revogar não se desfaz; o token em
claro não existe para ser regravado).

**Feedback:** emitir e revogar usam `useSaveFeedback(...).run(...)` (toast:
carregando, erro, sucesso; ver `components/ui/toast/TOASTS.md`). Só o token
mostrado uma vez fica inline, porque é conteúdo.

## Como o cliente conecta

- Transporte: Streamable HTTP sem estado. Cada `POST` é completo e se autentica
  sozinho com `Authorization: Bearer fch_mcp_...`. `GET` responde 405 (sem SSE).
- Versões de protocolo aceitas no `initialize`: `2025-06-18`, `2025-03-26` e
  `2024-11-05`. Versão desconhecida recebe `2025-06-18`. Lote (array) não é aceito.
- Configuração: copie `.mcp.json.example` para `.mcp.json` na raiz (o `.mcp.json`
  está no `.gitignore`; só o exemplo é versionado) e exporte `FECHAI_MCP_TOKEN`. O
  exemplo lê o token de `${FECHAI_MCP_TOKEN}` no header `Authorization`, sem token
  gravado no arquivo. `FECHAI_MCP_URL` é opcional: sem ela, vale a URL de produção.
  Fora de produção, aponte a URL do ambiente de teste.

## Erros e limites

| situação | HTTP | código JSON-RPC | cabeçalho extra |
| --- | --- | --- | --- |
| Sem header, formato errado, token inexistente, revogado ou vencido | 401 | `-32001` | `WWW-Authenticate: Bearer realm="fechai-mcp"` |
| Mais de 30 tentativas inválidas por IP em 5 min (a 31ª responde 429) | 429 | `-32029` | `Retry-After` |
| Conta suspensa pelo admin | 403 | `-32003` | |
| Token sem o escopo da ferramenta | 403 | `-32003` | |
| Mais de 120 chamadas por minuto com o mesmo token | 429 | `-32029` | `Retry-After` |
| Corpo acima de 64 KB | 413 | `-32600` | |
| Corpo ilegível, JSON inválido, não é JSON-RPC 2.0, `id` inválido | 400 | `-32700` ou `-32600` | |
| Método desconhecido | 200 | `-32601` | |
| Ferramenta desconhecida, nome ausente, argumento inválido (inclui `tenantId`) | 200 | `-32602` | |
| Agente de outra conta ou inexistente | 200 | resultado com `isError: true` | |
| `run_simulation` com mais de 10 mensagens, mensagem vazia ou acima de 1000 caracteres | 200 | `-32602` | |
| `run_simulation` com `variant` `proposal` ou `both` (parte C) | 200 | resultado com `isError: true` | |
| Mais de 30 turnos de simulação em 10 min com o mesmo token | 429 | `-32029` | `Retry-After` |
| `get_simulation` de outra conta, de conversa real ou do chat de teste do painel | 200 | resultado com `isError: true` | |
| Notificação (sem `id`) | 202 | sem corpo | |
| `GET` | 405 | sem corpo | `Allow: POST` |
| Erro inesperado (detalhe vai só ao log) | 500 | `-32603` | |

O limite de falhas por IP só é contado nas respostas 401; o limite por token só
roda depois de autenticar. Um IP bloqueado por falhas não derruba um token válido.

## Corpo da requisição

Teto de 64 KB (`MAX_MCP_BODY_BYTES`), aplicado **antes** de ler: `Content-Length`
acima do teto responde 413 sem tocar no corpo, e sem ele (chunked) o stream é lido
em pedaços e cancelado ao passar do limite (`readBodyWithinLimit`).

## Como testar

Automático (sem banco nem Redis reais: `prisma` e `rate-limit` são simulados):

```
npx vitest run tests/agent-mcp.test.ts tests/agent-mcp-simulacao.test.ts tests/autorizacao.test.ts
```

Manual, contra um ambiente com token emitido (`FECHAI_MCP_TOKEN` exportado):

```
URL="${FECHAI_MCP_URL:-https://fechai.januscms.com.br/api/mcp}"
curl -s -X POST "$URL" -H "Authorization: Bearer $FECHAI_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
curl -s -X POST "$URL" -H "Authorization: Bearer $FECHAI_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_agents","arguments":{}}}'
```

Confira:

- `tools/list` com `read` mostra só `list_agents` e `get_agent_config`; com `simulate`, também `run_simulation` e `get_simulation`.
- `run_simulation` com `{"agentId":"...","messages":["Oi","Quero marcar sexta às 14h"]}`: resposta com `dryRun: true`, nada novo em `/agenda`, nenhuma mensagem no WhatsApp, e a conversa na aba de testes de `/conversas`.
- `run_simulation` com `variant: "proposal"`: `isError: true`.
- Sem o header `Authorization`: 401 com `WWW-Authenticate`.
- `list_agents` com `arguments: {"tenantId": "..."}`: `-32602`.
- `get_agent_config` com `agentId` de outra conta: `isError: true`, "Agente não encontrado nesta conta."
- Corpo acima de 64 KB (um JSON com um campo de 70 KB, por exemplo): 413, antes de qualquer parse.
- Revogar o token em `/admin/agentes/mcp`: a chamada seguinte responde 401 na hora.

## Riscos conhecidos

Registrados, não corrigidos (comportamento atual de propósito até haver decisão):

- **Limites falham aberto.** Os três limites (falhas por IP em `mcp:auth-fail`,
  chamadas por token em `mcp:token` e turnos de simulação em `mcp:simulate`) usam
  `rateLimit`/`rateLimitReserve`, que liberam tudo se o Redis cair. Sem Redis não há
  freio a tentativa de token nem a carga por token. O token tem 256 bits, então
  adivinhar não é o risco, e sim a carga na rota. **Custo:** sem Redis,
  `mcp:simulate` deixa de valer e um token com `simulate` roda turnos sem teto, cada
  um uma chamada de LLM paga pela plataforma. Decisão do time: o comportamento fica
  assim; o remédio é monitorar o Redis e revogar o token em caso de abuso.
- **O banco é consultado antes do limite de falhas.** `authenticateMcp` busca o
  token por hash antes de o limite de falhas ser conferido (ele só é contado depois
  da falha), então um IP bloqueado ainda custa uma consulta por requisição. Um
  freio antes da consulta exigiria contar por IP também nas tentativas, não só nas
  falhas.
- **IP vem do primeiro item de `X-Forwarded-For`**, como no resto do app
  (`modules/auth/attempts.ts`, widget, cadastro). Atrás de um proxy que sobrescreve
  o header, é o IP real. Se o proxy só acrescenta, o cliente gira o valor e contorna
  o limite por IP.
- **Token é bearer, sem restrição de IP.** Quem tiver o token lê a configuração
  dos agentes (prompt, persona, regras, config das ações, títulos dos documentos)
  até revogar ou até vencer. Padrão de 30 dias, teto de 365. O remédio é revogar e
  emitir outro. Com `simulate`, também gasta LLM da plataforma (até 30 turnos a
  cada 10 min) e grava conversas de teste na conta.
- **Conversas de simulação acumulam.** Cada `run_simulation` cria um lead/conversa
  de teste novo; não há limpeza automática.

## Schema

`McpToken` (cascade com `Tenant`, `@@index([tenantId])`): `tokenHash` único,
`tokenPrefix`, `scopes`, `expiresAt`, `revokedAt`, `lastUsedAt` e quem emitiu e
revogou (`createdById`/`createdByEmail`, `revokedById`).

**Passo pendente de deploy:** a tabela é nova. Antes de subir o código, rode
`npm run db:push` (ou `npx prisma db push`) e `npx prisma generate` **nos dois
processos** (web e worker). A rota lê `prisma.mcpToken` a cada chamada, então sem o
client novo ela falha. Se o deploy recusar um índice único, não use
`--accept-data-loss` (libera outras mudanças destrutivas do diff); confira o SQL
com `npx prisma migrate diff`. Se `generate` falhar com `EPERM` no Windows, pare o
dev server e rode de novo.

## O que NÃO faz (ainda)

- Não grava nada no agente nem propõe mudança (parte C). A simulação só grava a
  própria conversa de teste.
- Não roda a variante `proposal`/`both` da simulação (parte C).
- Não tem sessão, SSE nem lote JSON-RPC: GET devolve 405.
