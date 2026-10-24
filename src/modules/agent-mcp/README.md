# Módulo: agent-mcp

## O que faz

Servidor MCP (Model Context Protocol) do agente, em `POST /api/mcp`. Deixa uma
ferramenta de IA externa (Claude Code, por exemplo) **ler a configuração dos
agentes de uma conta**, com um token emitido pelo superadmin. Parte A do plano:
tokens, rota e leitura. Simulação (`simulate`) e propostas de mudança
(`propose`) vêm nas partes B e C; os escopos já existem no schema, mas ainda
não podem ser emitidos.

## Arquivos

- `tokens.ts` — emitir, listar, revogar. `fch_mcp_` + 32 bytes aleatórios em base64url.
- `auth.ts` — `Authorization: Bearer`, busca por hash, recusa revogado/vencido, marca `lastUsedAt`.
- `rpc.ts` — JSON-RPC 2.0 mínimo, sem estado e sem dependência (`initialize`, `ping`, `tools/list`, `tools/call`). Também os limites e o teto do corpo.
- `tools.ts` — registro das ferramentas (`list_agents`, `get_agent_config`).
- `read.ts` — a leitura filtrada da configuração.
- Rota: `src/app/api/mcp/route.ts` (só POST, runtime Node). Admin: `src/app/(admin)/admin/agentes/mcp/`.
- Exemplo de cliente: `.mcp.json.example` na raiz (sem token; o valor vem da variável `FECHAI_MCP_TOKEN`).
- Testes: `tests/agent-mcp.test.ts`, mais `tests/autorizacao.test.ts` (rota com autenticação antes do corpo).

## Regras que não podem ser quebradas

- **A conta sai SÓ do token.** Nenhuma ferramenta tem `tenantId` no esquema, e o
  esquema é `.strict()`: um `tenantId` (ou qualquer argumento não declarado) volta
  como parâmetro inválido, nunca é ignorado. `agentId` é só um filtro dentro da
  conta; id de outra conta responde igual a id inexistente ("não encontrado").
- **Todo acesso ao banco leva o `tenantId` do token** (agente, ações e a consulta de
  documentos). Esta leitura não consulta `Lead`, `Message`, `Conversation`,
  `Appointment` nem `Tenant`. A autenticação lê só `Tenant.status`, pela relação do
  token, para recusar conta suspensa.
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

`get_agent_config` devolve: `persona` (nome do agente e da empresa, setor, tom,
estilo, oferta, objetivo, regras), `systemPrompt`, `behavior` (ouvir áudio, parar
com emoji, responder em voz, estilo da voz e `hasVoice`), `variables` (chave e
descrição, sem valores), `actions` (chave, nome, ligada, resumo e config pública de
cada habilidade) e `knowledge` (título, tamanho em caracteres e situação de cada
documento). O que não sai está na regra "A saída é uma lista de permissões", acima.

Falha esperada (agente não encontrado) volta como resultado com `isError: true`;
argumento inválido e ferramenta desconhecida, como erro JSON-RPC `-32602`.
Ferramenta chamada sem o escopo dela responde 403.

## Como emitir e revogar

**Quem:** só superadmin. Entrada: `/admin/agentes`, botão "Acesso MCP" (ou direto
em `/admin/agentes/mcp`). As actions (`issueMcpTokenAction`,
`revokeMcpTokenAction`) chamam `requireSuperadmin` a cada chamada: esconder a tela
não autoriza.

**Emitir:** escolha a conta, o nome (até 80 caracteres), as permissões e a
validade (de 1 a 365 dias; padrão 30). O token aparece uma vez, com botão de
copiar. Fechou a tela, não há como vê-lo de novo: emita outro e revogue o antigo.
Emissão tem teto de 10 por minuto por superadmin.

**Escopo `read` apenas na emissão.** A tela lista os três escopos, mas só "Ler a
configuração do agente" está habilitada; `simulate` e `propose` aparecem
desabilitados e `validateIssueInput` os recusa na action. A lista é
`EMITTABLE_MCP_SCOPES` em `tokens.ts`: `MCP_SCOPES` mantém os três porque a
autenticação e o schema já os conhecem (parte C). Liberar um escopo é ampliar
`EMITTABLE_MCP_SCOPES`, e só faz sentido junto da ferramenta que o usa.

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
npx vitest run tests/agent-mcp.test.ts tests/autorizacao.test.ts
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

- `tools/list` mostra só `list_agents` e `get_agent_config`.
- Sem o header `Authorization`: 401 com `WWW-Authenticate`.
- `list_agents` com `arguments: {"tenantId": "..."}`: `-32602`.
- `get_agent_config` com `agentId` de outra conta: `isError: true`, "Agente não encontrado nesta conta."
- Corpo acima de 64 KB (um JSON com um campo de 70 KB, por exemplo): 413, antes de qualquer parse.
- Revogar o token em `/admin/agentes/mcp`: a chamada seguinte responde 401 na hora.

## Riscos conhecidos

Registrados, não corrigidos (comportamento atual de propósito até haver decisão):

- **Limites falham aberto.** Os dois limites (falhas por IP em `mcp:auth-fail` e
  chamadas por token em `mcp:token`) usam `rateLimit`, que libera tudo se o Redis
  cair. Sem Redis não há freio a tentativa de token nem a carga por token. O token
  tem 256 bits, então adivinhar não é o risco, e sim a carga na rota.
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
  emitir outro.

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

- Não simula conversa nem grava nada (partes B e C). Quando a simulação chegar,
  deve ligar `dryRunScheduling`, como o chat de teste (ver `agent-engine/README.md`).
- Não tem sessão, SSE nem lote JSON-RPC: GET devolve 405.
