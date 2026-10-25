# Módulo: admin

## O que faz

Gestão da plataforma pelo SUPERADMIN: **criar contas**, listar/inspecionar tenants, suspender/reativar e trocar plano manualmente (suporte). A trilha de auditoria (`/admin/logs`, incluindo desfazer alterações e exclusões) fica em `modules/audit/`.

## Excluir conta: quem pode ser excluído

`deleteTenantAccount` (server action em `(admin)/actions.ts`) exige a conta **suspensa** e recusa a conta do próprio admin logado. Conta de **admin também pode ser excluída** — antes eram todas recusadas em bloco, o que deixava admin desligado preso na lista para sempre e empurrava a limpeza para o banco à mão, sem rastro. A regra que importa não é "é admin?", é "sobra algum admin depois?": a action conta os `SUPERADMIN` fora do tenant alvo no momento do clique e recusa se o resultado for zero, porque sem nenhum o `/admin` fica inacessível pela interface (só `npm run db:admin` no servidor devolve). Toda exclusão é registrada em `AuditLog` **antes** do delete, com snapshot da conta — é irreversível, e o log é o que resta dela.

## Arquivos

- `service.ts`:
  - `listTenants(filters)` — tenants + status WhatsApp + papéis dos usuários + contagens. Sem filtro de situação ou de teste, **esconde suspensas e testes encerrados** (`hiddenByDefault`); escolher `status` ou `trial` mostra a lista como o filtro pede. Teste encerrado = plano de teste sem data futura (sem data conta). `countHiddenTenants()` diz quantas o padrão esconde.
  - `getTenantDetail(tenantId)` — usuários, contagens, etc.
  - `setTenantStatus(tenantId, "active"|"suspended")`.
  - `adminSetPlan(tenantId, planKey)`.
  - `adminCreateAccount({tenantName, email, password?, role, planKey})` — cria tenant + usuário com **qualquer papel e plano**. Sem `password`, gera uma provisória e a devolve em `tempPassword` (única vez que ela existe em texto). Delega o provisionamento a `createTenantWithOwner`.

## Contratos expostos

```ts
listTenants(search?) ; getTenantDetail(id)
setTenantStatus(id, status) ; adminSetPlan(id, planKey)
adminCreateAccount(input) -> { ok: true, tempPassword? } | { ok: false, error }
```

## Download dos dados de uma conta

Em Contas → Gerenciar, `TenantDownloadButton` baixa um JSON de diagnóstico por
`GET /api/admin/tenants/[id]/export`. A rota verifica a sessão real e exige
SUPERADMIN antes de ler a conta, incluindo quando há personificação ativa.
`tenant-export.ts` exporta todas as páginas (500 linhas por consulta), sem
cortar conversas, mensagens, configurações ou textos. O JSON termina com
contagens e `completed: true`; uma falha interrompe o download.

Credenciais e hashes são omitidos das consultas de usuários/integrações e
também filtrados recursivamente com a mesma regra da auditoria. Arquivos e
áudios ficam como URLs, embeddings e sessões ficam de fora. Não é backup
restaurável nem coleta de logs de servidor ou da agenda externa. A solicitação
é auditada em `admin.tenant_export_requested`, sem copiar o conteúdo do arquivo.

## Autorização das operações

**Todas** são cross-tenant e assumem SUPERADMIN. A checagem fica na rota `(admin)/` (`requireSuperadmin`) e nas server actions do painel — nunca exponha estas funções a rotas do cliente.

## Relatórios mensais de ROI

A conversa "Fazer com I.A" é guardada por cliente e competência em `MonthlyRoiAiChat`
(`reports/monthly-ai-chat.ts`, máx. 100 mensagens) e reaparece ao reabrir o painel; o
admin pode apagá-la. Guardar nunca derruba a resposta da IA.

O menu **Relatórios** abre `/admin/relatorios`, com clientes ativos que possuem
usuário `OWNER` que utiliza o produto. A listagem exibe Cliente, Data de entrada
do cliente (`Tenant.createdAt`, data de Brasília), Revisão e Ação, com
cabeçalhos centralizados e selo **Por clientes**, sem contador. Entrega e
reunião são registradas na revisão individual, não em colunas da listagem.

A revisão individual carrega dados e premissas existentes e permite correções
manuais dos indicadores atuais/anteriores antes do fechamento. Usa os
componentes do painel e exporta PDF preto/cinza com logos locais. Operação,
fórmulas, publicação no tenant, arquivos e limites estão no
[contrato P-79](../../../docs/P-79-relatorio-mensal-roi.md).
Também preenche mensalidade ausente pelo preço atual da conta, respeita o
mês do cadastro na primeira revisão e permite importar indicadores de um ou
mais agentes. Horários cadastrados são sugestões para conferir com a equipe;
o importador não altera o agente nem a agenda e mantém as correções manuais.
O botão **Fazer com I.A** abre ajuda contextual, com a cadeia configurada em
Admin → IA. Explica os campos e propõe preenchimentos a partir dos agregados
e da revisão atual. A pessoa aplica sugestões validadas e salva a revisão;
a IA não publica nem confirma presença. O servidor exige SUPERADMIN e valida
agentes do tenant também nesse caminho. Detalhes e limites no contrato P-79.

## Perguntas sem resposta (P-87)

O menu **Perguntas** abre `/admin/perguntas`: contas ativas com a quantidade
na fila e **Quem responde** (Clínica · Mavellium · As duas), salvo na hora por
`adminSetGapResponders` e auditado em `admin.gap_responders_changed`. Só o
superadmin define isso — é combinado com o cliente, e a clínica não pode
esconder a fila de quem foi contratado para responder. Padrão: Clínica.

Nas contas em que a Mavellium responde, *Abrir fila* mostra os mesmos cards da
clínica (`GapCard`), **sempre mascarados** (LGPD): iniciais, dois últimos
dígitos do telefone, pergunta e trecho da conversa sem nomes, números e
e-mails, e sem link para a conversa. As actions (`admin/perguntas/actions.ts`)
recebem o tenant por `.bind` e checam superadmin **e** `responders` a cada
chamada; a resposta fica registrada como "Mavellium". Personificar a conta
também mascara `/perguntas`. Resumo diário por e-mail em
`KNOWLEDGE_GAPS_ADMIN_EMAIL`, só com contagens. Contrato:
[P-87](../../../docs/P-87-perguntas-sem-resposta.md).

## O que NÃO faz

- Não faz billing real (trocar plano aqui é manual, não mexe na Stripe).
- Não edita persona/base de um tenant (isso é do próprio cliente).
