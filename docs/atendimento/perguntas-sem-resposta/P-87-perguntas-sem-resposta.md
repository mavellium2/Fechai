# P-87 — Perguntas sem resposta (fila de conhecimento)

Implementado em 28/09/2026, antes do Radar de Leads (P-86), como pedia a
prioridade. Base: o briefing colado na conversa de implementação. O documento
do Obsidian citado ("Produto/Fechai/Fechai - Inteligência de Conversas") não
estava disponível; onde o briefing deixava algo em aberto, a decisão está
registrada aqui e em [ADR-004](../../decisions/ADR-004-fila-perguntas-sem-resposta.md).

Detalhe técnico por arquivo: [`src/modules/knowledge-gaps/README.md`](../../../src/modules/knowledge-gaps/README.md).

## Problema

Leads fazem perguntas que o agente ainda não sabe responder. Antes, ele ficava
perdido (e podia completar com um palpite), e a pergunta não chegava a
ninguém: o evento `unanswered` só contava no relatório mensal.

## O que foi entregue

| Pedido no briefing | Como ficou |
| --- | --- |
| 1. Detectar que não há resposta na base ou que a confiança é baixa | O agente chama `report_unanswered({ question })` (ou `handoff_human` com `unanswered: true`). Quando a busca na base volta sem trecho ou com o mais próximo distante, o prompt ganha um aviso de "base fraca". |
| 2. Não inventar; dizer que vai confirmar; transbordar conforme a regra do cliente | Regra dura no prompt de todo turno + instrução no resultado da tool. Regra da conta: **continuar atendendo** (padrão) ou **passar para a equipe** (`needsHuman` + aviso no grupo da transferência). |
| 3. Fila no painel com trecho, cliente, data e repetições; parecidas agrupadas | `/perguntas`: um card por assunto, com trecho da conversa, quem perguntou, datas e quantos contatos diferentes perguntaram. Agrupamento por texto normalizado e por semelhança de vetor. |
| 4. Aviso por WhatsApp ou e-mail, com resumo diário | Worker: aviso a cada pergunta nova e resumo diário na hora escolhida, por e-mail e/ou grupo interno do WhatsApp. |
| 5. Equipe responde e aprova; a resposta entra na base | Responder, salvar rascunho, aprovar. Aprovar cria (ou reescreve) um documento na base de conhecimento do agente. |
| 6. Agente passa a responder sozinho; opcional retomar o lead | Vem da base (RAG). Retomar é uma opção explícita ao aprovar: manda a resposta a quem perguntou, uma vez por contato. |
| Métricas mensais | "Perguntas sem resposta" (já existia) com tendência de seis meses na tela; novo "Tempo médio para a equipe responder" no ROI mensal. |
| Regra dura: nunca inventar | `unansweredRule` em todo turno com agente. Garantia de prompt — ver limites. |
| Mascarar nome e telefone para quem não é da clínica | `/admin/perguntas` e personificação mostram iniciais, final do telefone e o texto da conversa mascarado. |
| Em aberto: quem responde a fila | Configuração por conta — Clínica, Mavellium ou As duas —, definida só pelo superadmin. Padrão: Clínica. |

## Fluxo ponta a ponta

```text
1. Contato: "vocês atendem pela Unimed?"
2. Agente: busca na base (RAG). Nada sobre convênio.
   └─ prompt tem <regra_sem_resposta> (+ aviso de base fraca)
3. Agente chama report_unanswered({ question: "Vocês aceitam o convênio Unimed?" })
   ├─ ReportEvent "unanswered"   (relatório mensal, como antes)
   ├─ registerKnowledgeGap       (fila; nunca lança)
   │    ├─ assunto aberto igual/parecido do mesmo agente? soma o contato
   │    └─ senão cria KnowledgeGap + KnowledgeGapOccurrence
   └─ regra da conta = handoff?  needsHuman + aviso no grupo da transferência
4. Tool responde ao modelo: "não responda nem dê palpite; diga que vai
   confirmar com a equipe". Contato recebe "Vou confirmar com a equipe e já te retorno."
5. Worker (a cada 2 min): aviso "pergunta nova" por e-mail/grupo, sem dado do contato.
   Na hora do resumo: o que está aberto e as mais repetidas.
6. Equipe em /perguntas: lê o trecho, escreve a resposta, aprova.
   ├─ documento "Pergunta respondida: …" na base do agente
   └─ (opcional) "Enviar a resposta a quem perguntou" → WhatsApp, uma vez por contato
7. Próximo contato com a mesma dúvida: o RAG acha o documento e o agente responde.
```

## Operação

### Clínica — menu **Perguntas** (`/perguntas`)

- **Topo:** na fila (abertas), tempo médio para responder (últimos 30 dias),
  respondidas (últimos 30 dias) e o gráfico "Perguntas sem resposta por mês"
  dos últimos seis meses (o mês atual aparece como parcial; a frase de
  tendência compara os dois últimos meses completos).
- **Abas:** Na fila · Respondidas · Descartadas, com contagem.
- **Card da pergunta:** a pergunta como o agente registrou; "N contatos";
  primeira e última vez; agente; selo de rascunho. Recolhíveis:
  - *Trecho da conversa* — até 5 falas antes da pergunta e 2 depois (é ali que
    se vê se o agente segurou a regra de não inventar);
  - *Quem perguntou* — nome, telefone, data, situação da retomada e link
    "Abrir conversa" (os 8 mais recentes).
- **Ações:** *Aprovar e ensinar o agente* · *Salvar rascunho* (não vai para a
  base) · *Descartar* (não é pergunta do negócio). Na aprovação, a opção
  *Enviar a resposta a quem perguntou (N)* abre uma mensagem editável
  (padrão: "Olá! Voltando à sua pergunta: …"). Respondidas podem ser editadas
  (reescreve o mesmo documento) e retomar quem ainda está pendente.
  Descartadas voltam para a fila com *Voltar para a fila*.
- **Regra e avisos** (recolhível no fim da página): o que fazer com a conversa
  e os avisos — e-mail, grupo do WhatsApp (escolhido como na transferência),
  a cada pergunta nova, resumo diário com horário e fuso. A linha fechada
  resume a configuração atual.
- Se a conta é respondida só pela Mavellium, a clínica vê a fila e as
  respostas, sem os botões.

### Mavellium — Admin › **Perguntas** (`/admin/perguntas`)

- Tabela de contas ativas: na fila, **Quem responde** (Clínica · Mavellium ·
  As duas, salvo na hora) e *Abrir fila* quando a Mavellium responde.
  Ordenação: contas em que a Mavellium responde, depois as com mais perguntas.
- Fila da conta com as mesmas ações da clínica, **sempre mascarada**: nome em
  iniciais, telefone só com os dois últimos dígitos, texto da pergunta e do
  trecho sem nomes, números e e-mails. Sem link para a conversa. A resposta
  fica registrada como "Mavellium".
- Personificando a conta (entrar como o cliente), `/perguntas` também mascara
  e só deixa responder se a conta incluiu a Mavellium.
- Resumo diário por e-mail às 8h (Brasília) para `KNOWLEDGE_GAPS_ADMIN_EMAIL`,
  só com o nome das contas e a quantidade na fila.

### Agente

- `report_unanswered` continua sem ocupar vaga de habilidade do plano.
- Conversa de teste (sandbox) não entra na fila; a tool avisa isso ao modelo e
  mantém a regra, para o dono ver no teste o comportamento real.

## Regras

1. **Nunca inventar.** Preço, procedimento, convênio, prazo, política,
   endereço, horário e se um serviço existe só podem ser afirmados se estiverem
   nas instruções, na base ou no resultado de uma ferramenta.
2. **Detecção explícita.** A fila só recebe o que o agente registrou; nada é
   inferido do texto da resposta.
3. **Registrar nunca derruba o turno.** Falha de banco ou embedding vira log;
   a regra da conta ainda é aplicada.
4. **Agrupar só assunto aberto do mesmo agente**, primeiro por texto
   normalizado e depois por vetor (distância de cosseno ≤ 0,15). O mesmo
   contato perguntando de novo não conta como outro.
5. **Aprovar ensina, não duplica.** Um documento por assunto; editar reescreve
   o mesmo. `answeredAt` é a primeira aprovação.
6. **Retomar é explícito e nunca repete.** Claim por contato; falha vira "sem
   confirmação" sem nova tentativa. Fora: teste, bloqueado, pediu para parar,
   já respondido por alguém da equipe, fora da janela (24h Meta, 7 dias QR).
   Não pausa o agente e não gasta cota.
7. **Quem responde** é definido pelo superadmin e checado em toda action.
8. **LGPD.** Quem não é da clínica vê dados mascarados; avisos nunca levam
   nome ou telefone de paciente.
9. **Teste fica fora** da fila, dos avisos, da retomada e das métricas.

## Estados

```text
KnowledgeGap.status
  open ──aprovar──► answered ──aprovar de novo──► answered (edita o documento)
   │  ▲
   │  └──voltar para a fila── dismissed
   └──descartar──► dismissed

KnowledgeGapOccurrence.resumeStatus
  null ──(sem condição)──► skipped   (motivo em resumeNote)
  null ──claim──► sending ──ok──► sent
                          └─erro─► failed (nunca reenviado)
```

## Avisos

| | Na hora | Resumo diário | Mavellium |
| --- | --- | --- | --- |
| Quando | varredura a cada 2 min, perguntas **novas** | na hora local escolhida (padrão 8h) | 8h de Brasília |
| Conteúdo | até 5 perguntas + link | total aberto, novas em 24h, a mais antiga, top 5 por contatos, link | contas e quantidades |
| Canais | e-mail dos usuários da conta e/ou grupo interno | idem | `KNOWLEDGE_GAPS_ADMIN_EMAIL` |
| Idempotência | `KnowledgeGap.notifiedAt` | `KnowledgeGapSettings.lastDigestAt` | `WorkerHeartbeat` `knowledge-gaps:admin-digest` |
| Não sai quando | aviso desligado, clínica não responde, sem canal, pergunta vista com mais de 6h | resumo desligado, clínica não responde, sem canal, fora da hora (pula o dia) | sem env, sem conta com fila |

Repetições não geram aviso na hora; aparecem no resumo. O link usa
`AUTH_URL`/`NEXTAUTH_URL`; sem elas, o texto aponta para "Perguntas, no painel".

## Métricas

- **Perguntas sem resposta por mês** — `ReportEvent` `unanswered` (a mesma
  fonte do relatório mensal, deduplicada por mensagem do contato). A tendência
  aparece na tela (seis meses) e no comparativo com o mês anterior do ROI.
- **Tempo médio para a equipe responder** — média de
  `answeredAt − firstAskedAt` das perguntas **aprovadas no mês**, respeitando
  os agentes selecionados no relatório. Campos `gapAnswerSeconds` e
  `gapsAnswered` em `MonthlyMetrics`, opcionais: relatório fechado antes desta
  entrega mostra "Sem registro"; mês sem aprovação mostra "Nenhuma aprovada".
  Na tela do ROI é uma linha própria; no PDF entra na célula de perguntas sem
  resposta ("12 · 3h"), para não aumentar a página única.
- Na tela `/perguntas`, o tempo médio usa os últimos 30 dias (operacional);
  no relatório, o mês da aprovação (competência).

## Autorização

| Ação | Clínica (sessão normal) | Mavellium (admin ou personificação) |
| --- | --- | --- |
| Ver a fila | sempre, sem máscara | sempre mascarada |
| Responder, rascunho, aprovar, descartar, retomar | se "Clínica" ou "As duas" | se "Mavellium" ou "As duas" |
| Regra e avisos | sim | na personificação, sim |
| Quem responde | não | só superadmin em `/admin/perguntas` |

Todas as actions repetem a checagem (produto + tenant da sessão, ou
superadmin + tenant válido), e o que parte das telas consulta e grava com
`tenantId`; só a varredura do worker lê várias contas, como os lembretes. Aprovar,
descartar, devolver, retomar, mudar a regra e mudar quem responde entram na
auditoria (`knowledge.gap_*`, `admin.gap_responders_changed`).

## Dados

- **`KnowledgeGap`** — um assunto: `question`, `normalized`, `embedding`
  (pgvector, SQL cru), `status`, `askedCount` (contatos distintos),
  `firstAskedAt`/`lastAskedAt`, `draftAnswer`, `answer`, `answeredAt`
  (primeira aprovação), `answerUpdatedAt`, `answeredBy*`, `documentId`
  (sem FK), `dismissedAt`, `notifiedAt`. `agentId` com `SetNull`.
- **`KnowledgeGapOccurrence`** — uma conversa que perguntou: única por
  `gapId + conversationId`; `messageId` (ponta do trecho), `question`,
  `askedAt`, `resumeStatus`/`resumeNote`/`resumedAt`. Apagar a conversa
  apaga a ocorrência.
- **`KnowledgeGapSettings`** — por conta (`tenantId` é a chave):
  `onUnanswered`, `notifyEmail`, `notifyWhatsapp`, `groupId`, `groupName`,
  `immediate`, `dailyDigest`, `digestHour`, `timezone`, `responders`,
  `lastDigestAt`. Sem linha = padrões.

## Configuração

Padrões de uma conta sem configuração salva: continuar atendendo; e-mail
ligado; grupo desligado; aviso na hora ligado; resumo diário às 8h de
Brasília; quem responde = Clínica.

| Variável | Padrão | Uso |
| --- | --- | --- |
| `KNOWLEDGE_GAP_SCAN_EVERY_MINUTES` | 2 | intervalo da varredura de avisos no worker |
| `KNOWLEDGE_GAPS_ADMIN_EMAIL` | vazio | destino do resumo diário da Mavellium |
| `RESEND_API_KEY`, `MAIL_FROM` | — | envio de e-mail (já existentes) |
| `AUTH_URL`/`NEXTAUTH_URL` | — | link nos avisos |

## Implantação

1. `prisma db push` (três tabelas novas; aditivo) e `prisma generate`.
2. Reiniciar **web e worker** — o worker ganha a fila `knowledge-gaps`.
3. Opcional: `KNOWLEDGE_GAPS_ADMIN_EMAIL`.
4. Definir em `/admin/perguntas` quem responde cada conta atendida pela Mavellium.

Efeito imediato nas contas existentes: o agente passa a seguir a regra de não
inventar, e a primeira pergunta nova sem resposta gera e-mail para os usuários
da conta (avisos nascem ligados). O histórico anterior não é reconstruído: a
fila começa vazia, e os `ReportEvent` antigos continuam só na contagem.

## Arquivos

- `src/modules/knowledge-gaps/` — `settings`, `settings-store`, `text`,
  `mask`, `register`, `queue`, `answer`, `resume`, `notify`, README.
- `src/modules/agent-engine/unanswered-rule.ts` — regra do prompt.
- `src/modules/agent-engine/orchestrator.ts` — injeta a regra; `retrieveContext`
  devolve a distância do trecho mais próximo.
- `src/modules/agent-engine/tools.ts` — `report_unanswered({ question })`,
  `handoff_human.question`, `transferToHuman`, texto do resultado.
- `src/app/(dashboard)/perguntas/` — página, `GapCard`, `GapTrend`,
  `GapSettingsForm`, actions, layout com `requireProductAccess`.
- `src/app/(admin)/admin/perguntas/` — página, `RespondersControl`, actions.
- `src/app/(dashboard)/agentes/HandoffSettings.tsx` — `GroupPicker` exportado.
- `src/modules/reports/monthly.ts`, `monthly-pdf.ts`,
  `src/app/(dashboard)/relatorios/MonthlyView.tsx` — tempo médio.
- `src/modules/audit/events.ts` — eventos novos.
- `workers/follow-up-worker/index.ts` — fila `knowledge-gaps`.
- Navegação: `src/app/(dashboard)/layout.tsx`, `src/app/(admin)/layout.tsx`,
  `src/components/shell/ShellNav.tsx` (ícone `CircleHelp`).
- `prisma/schema.prisma`, `.env.example`.

## Testes

`tests/perguntas-sem-resposta.test.ts` (31 casos): máscara (nome, telefone,
e-mail, acento, palavra inteira, números curtos preservados); texto e
formatação de tempo; padrões e valores inválidos da regra; quem pode aprovar;
registro (novo, fala do contato como fallback, vetor gravado, agrupamento por
texto e por vetor com limite, mesmo contato não conta duas vezes, teste fora,
falha sem lançar); a regra no prompt e o aviso de base fraca; a tool nos dois
modos e no teste; `handoff_human` com `unanswered`; aprovar cria/reescreve o
documento e preserva a primeira data; retomada (condições de exclusão, janela
da Meta, falha sem repetir, desconectado sem consumir); avisos (conteúdo sem
dado de contato, claim, só a clínica que responde, pergunta velha); tempo
médio no mês da aprovação. `tests/relatorio-mensal-access.test.ts` ganhou o
mock da consulta nova.

## Limites e pendências

- **"Nunca inventar" é garantia de prompt**, reforçada no resultado da tool.
  Não há verificador depois da resposta (custaria uma chamada por mensagem e
  contaria na cota). O trecho na fila é o controle humano.
- **Base fraca** usa distância calibrada para embeddings da OpenAI; no Gemini
  o aviso quase não aparece (a regra continua valendo).
- **Agrupamento conservador:** paráfrases podem ficar em cards separados. Não
  há juntar/separar à mão.
- **Documento apagado em /agentes** deixa a pergunta como respondida sem
  conteúdo na base; aprovar de novo recria.
- **Retomar pela Meta fora de 24h** exigiria template aprovado — não feito.
- **Aviso na hora só por grupo ou e-mail**; não há envio para o celular de um
  atendente (mensagem a número que nunca falou com a clínica arrisca bloqueio).
- **Não verificado em navegador** na entrega: o banco local estava fora do ar,
  e o `db push` ficou para a implantação. Typecheck, lint e testes passaram.
