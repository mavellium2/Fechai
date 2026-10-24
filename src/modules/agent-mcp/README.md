# Módulo: agent-mcp

## O que faz

Servidor MCP (Model Context Protocol) do agente, em `POST /api/mcp`. Deixa uma
ferramenta de IA externa (Claude Code, por exemplo) **ler a configuração dos
agentes de uma conta**, com um token emitido pelo superadmin. Parte A do plano:
tokens, rota e leitura. Simulação (`simulate`) e propostas de mudança
(`propose`) vêm nas partes B e C; os escopos já existem no schema.

## Arquivos

- `tokens.ts` — emitir, listar, revogar. `fch_mcp_` + 32 bytes aleatórios em base64url.
- `auth.ts` — `Authorization: Bearer`, busca por hash, recusa revogado/vencido, marca `lastUsedAt`.
- `rpc.ts` — JSON-RPC 2.0 mínimo, sem estado e sem dependência (`initialize`, `ping`, `tools/list`, `tools/call`).
- `tools.ts` — registro das ferramentas (`list_agents`, `get_agent_config`).
- `read.ts` — a leitura filtrada da configuração.
- Rota: `src/app/api/mcp/route.ts` (só POST, runtime Node). Admin: `src/app/(admin)/admin/agentes/mcp/`.
- Exemplo de cliente: `.mcp.json.example` na raiz (sem token; o valor vem da variável `FECHAI_MCP_TOKEN`).

## Regras que não podem ser quebradas

- **A conta sai SÓ do token.** Nenhuma ferramenta tem `tenantId` no esquema, e o
  esquema é `.strict()`: um `tenantId` (ou qualquer argumento não declarado) volta
  como parâmetro inválido, nunca é ignorado. `agentId` é só um filtro dentro da
  conta; id de outra conta responde igual a id inexistente ("não encontrado").
- **Todo acesso ao banco leva o `tenantId` do token** (agente, ações e a consulta de
  documentos). Esta leitura não consulta `Lead`, `Message`, `Conversation`,
  `Appointment` nem `Tenant`.
- **O token em claro existe em um lugar só:** o retorno de `issueMcpToken`, mostrado
  uma vez no admin. O banco guarda o sha256 (`tokenHash`, único) e 8 caracteres do
  trecho aleatório (`tokenPrefix`; o `fch_mcp_` é igual em todos e não ajudaria a
  reconhecer). Não grave nem logue o token; a auditoria registra id, prefixo,
  permissões e validade, nunca o token nem o hash. Sha256 sem sal é intencional:
  são 256 bits de entropia, não uma senha digitada.
- **Só header.** Token em query string não é aceito (URL vai para log e Referer).
- **Revogar vale na hora:** a autenticação lê `revokedAt` do banco a cada chamada,
  sem cache. Validade padrão de 30 dias (1 a 365). Conta suspensa recusa o token (403).
- **Erros:** sem header, malformado, inexistente, revogado ou vencido = 401 (mesma
  mensagem para todos, sem dizer qual); escopo faltando = 403. Falhas de
  autenticação repetidas por IP viram 429, e há um teto por token (`rateLimit`).
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

Falha esperada (agente não encontrado) volta como resultado com `isError: true`;
argumento inválido e ferramenta desconhecida, como erro JSON-RPC `-32602`.

## Emitir e revogar

`/admin/agentes/mcp` (superadmin): escolhe a conta, o nome, as permissões e a
validade. O token aparece uma vez com botão de copiar. As actions
(`issueMcpTokenAction`, `revokeMcpTokenAction`) chamam `requireSuperadmin` a cada
chamada e gravam `mcp.token_issued` / `mcp.token_revoked` na auditoria (não
revertíveis).

**Só `read` é emitível** (`EMITTABLE_MCP_SCOPES` em `tokens.ts`): `MCP_SCOPES`
mantém os três para a parte C, mas `validateIssueInput` recusa na emissão
`simulate`/`propose` ("ainda não pode ser emitida"). A validação de escopo na
autenticação segue sobre `MCP_SCOPES`. Liberar um escopo é ampliar aquela lista.

**Feedback no admin:** emitir e revogar usam `useSaveFeedback(...).run(...)`
(toast: carregando, erro, sucesso; ver `components/ui/toast/TOASTS.md`). Só o
token mostrado uma vez fica inline, porque é conteúdo. `.mcp.json` está no
`.gitignore`; só o `.mcp.json.example` é versionado.

Uso no cliente: copie `.mcp.json.example` para `.mcp.json` e exporte
`FECHAI_MCP_TOKEN` (e, fora de produção, `FECHAI_MCP_URL`).

## Corpo da requisição

Teto de 64 KB (`MAX_MCP_BODY_BYTES`), aplicado **antes** de ler: `Content-Length`
acima do teto responde 413 sem tocar no corpo, e sem ele (chunked) o stream é lido
em pedaços e cancelado ao passar do limite (`readBodyWithinLimit`).

## Riscos conhecidos

Registrados, não corrigidos (comportamento atual de propósito até haver decisão):

- **Limite de falhas por IP falha aberto.** `rateLimit("mcp:auth-fail", ip, ...)`
  libera tudo se o Redis cair; sem Redis não há freio a tentativa de token. O
  token tem 256 bits, então adivinhar não é o risco, e sim a carga na rota.
- **O banco é consultado antes do limite.** `authenticateMcp` busca o token por
  hash antes de o limite de falhas ser conferido (ele só é contado depois da
  falha), então um IP bloqueado ainda custa uma consulta por requisição. Um
  freio antes da consulta exigiria contar por IP também nas tentativas, não só nas
  falhas.

## Schema

`McpToken` (cascade com `Tenant`, `@@index([tenantId])`). Mudança de schema pede
`db push` + `generate` nos dois processos (web e worker).

## O que NÃO faz (ainda)

- Não simula conversa nem grava nada (partes B e C). Quando a simulação chegar,
  deve ligar `dryRunScheduling`, como o chat de teste (ver `agent-engine/README.md`).
- Não tem sessão, SSE nem lote JSON-RPC: GET devolve 405.
