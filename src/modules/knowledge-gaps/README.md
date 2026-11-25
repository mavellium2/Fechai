# Módulo: knowledge-gaps (perguntas sem resposta, P-87)

> Operação, telas, autorização e implantação: [`docs/atendimento/perguntas-sem-resposta/P-87-perguntas-sem-resposta.md`](../../../docs/atendimento/perguntas-sem-resposta/P-87-perguntas-sem-resposta.md).
> Por que foi feito assim: [ADR-004](../../../docs/decisions/ADR-004-fila-perguntas-sem-resposta.md).

## O que faz

Quando o agente não sabe responder, a pergunta não se perde: ela entra numa
fila no painel (`/perguntas`), agrupada com as parecidas, com o trecho da
conversa, quem perguntou e quantas vezes. A equipe responde e aprova, a
resposta vira documento na base de conhecimento do agente, e a partir daí ele
responde sozinho. Opcionalmente, quem ficou esperando recebe a resposta.

```text
contato pergunta ─► agente não acha na base ─► report_unanswered(question)
                                                 │
            "vou confirmar com a equipe" ◄───────┤ (nunca inventa)
                                                 ▼
                       KnowledgeGap (agrupado) + KnowledgeGapOccurrence
                                                 │
                 worker: aviso na hora / resumo diário (e-mail, grupo)
                                                 ▼
          /perguntas: responder ─► aprovar ─► documento na base do agente
                                                 └─► (opcional) retomar o contato
```

## Arquivos

- `settings.ts` — puro. Regra da conta (`GapSettings`), padrões, `parseGapSettings` (nunca lança), `clinicAnswers`/`mavelliumAnswers`, `describeGapNotices`.
- `settings-store.ts` — `gapSettingsFormSchema`, `saveGapSettings` (clínica) e `setGapResponders` (só superadmin).
- `text.ts` — puro. `cleanQuestion`, `normalizeQuestion`, `GROUP_MAX_DISTANCE`, `formatDuration`, título/conteúdo do documento, `formatGapTime(Short)` do relatório mensal.
- `mask.ts` — puro. `maskName`, `maskPhone`, `maskText` (LGPD).
- `register.ts` — `getGapSettings` e `registerKnowledgeGap` (chamado pelas tools, **nunca lança**).
- `queue.ts` — leitura: `listGaps` (com máscara), `countGaps`, `gapStats`.
- `answer.ts` — `saveGapDraft`, `approveGapAnswer`, `dismissGap`, `reopenGap`, `resumeAnsweredGap`.
- `resume.ts` — `resumeGapContacts`: manda a resposta aprovada a quem perguntou.
- `notify.ts` — `scanKnowledgeGaps` do worker: aviso na hora, resumo diário e resumo da Mavellium.

Telas: `src/app/(dashboard)/perguntas/` (clínica) e `src/app/(admin)/admin/perguntas/` (Mavellium). A regra do prompt mora em `agent-engine/unanswered-rule.ts`; as tools em `agent-engine/tools.ts`.

## Contratos expostos

```ts
// escrita pelo agente (tools) — nunca lança
registerKnowledgeGap({ tenantId, conversationId, agentId, question? })
  -> { status: "created" | "grouped" | "repeated" | "test" | "failed", gapId?, mode: "keep" | "handoff" }
getGapSettings(tenantId) -> GapSettings                       // nunca lança; sem linha = padrões

// leitura das telas
listGaps(tenantId, status, { masked, take? }) -> GapView[]    // masked = quem não é da clínica
countGaps(tenantId) -> { open, answered, dismissed }
gapStats(tenantId, timezone, now?) -> { open, avgAnswerSeconds, answered30d, months }

// ações da equipe (quem chama checa permissão; aqui só o tenant)
saveGapDraft(tenantId, gapId, draft) -> GapActionResult
approveGapAnswer({ tenantId, gapId, answer, actor, resumeMessage? }) -> GapActionResult  // + resume
dismissGap(tenantId, gapId) ; reopenGap(tenantId, gapId)
resumeAnsweredGap(tenantId, gapId, message) -> GapActionResult
resumeGapContacts(tenantId, gapId, message, now?) -> { sent, skipped, failed, blocked? }

// configuração
saveGapSettings(tenantId, form) ; setGapResponders(tenantId, "clinic" | "mavellium" | "both")

// worker
scanKnowledgeGaps(now?) -> { notices, digests, admin }

// puros
parseGapSettings(row) ; clinicAnswers(r) ; mavelliumAnswers(r) ; describeGapNotices(s)
maskName(name) ; maskPhone(phone) ; maskText(text, { names, phones })
cleanQuestion(raw) ; normalizeQuestion(text) ; formatDuration(seconds)
formatGapTime(metrics) ; formatGapTimeShort(metrics)
```

`GapActor = { id, label, role: "clinic" | "mavellium" }` é quem aprovou: a
clínica grava o e-mail de quem clicou; a Mavellium grava "Mavellium".

## Regras que não podem quebrar

**O agente nunca inventa.** `unansweredRule` vai no prompt de todo turno com
agente: preço, procedimento, convênio, prazo, política, endereço, horário e
se um serviço existe só podem ser afirmados se estiverem nas instruções, na
base ou no resultado de uma ferramenta. Quando a busca da base volta sem
trecho ou com o mais próximo acima de `LOW_CONFIDENCE_DISTANCE`, entra um aviso
extra de "base fraca". É só aviso: a regra vale com ou sem ele, e a distância
depende do modelo de embedding (calibrada para OpenAI; no Gemini quase nunca
dispara). O resultado da tool repete a instrução ("não responda nem dê
palpite; diga que vai confirmar com a equipe"), porque é ali que o modelo
decide o texto. Não existe verificador depois da resposta: a garantia é de
prompt, e o trecho da conversa na fila mostra à equipe se o agente segurou.

**Detecção explícita, nunca inferida.** A fila só recebe o que o agente
registrou (`report_unanswered` ou `handoff_human` com `unanswered: true`),
como os outros eventos do relatório (`ReportEvent`). O parâmetro `question` é
a pergunta reescrita, curta e sem dado pessoal; sem ele, vale a última fala do
contato. Registrar **nunca lança** e nunca derruba o turno.

**Transbordo conforme a regra da conta** (`onUnanswered`):
`keep` (padrão — o comportamento antigo de `report_unanswered`) segue
atendendo; `handoff` também marca `needsHuman`, registra o transbordo e avisa
o grupo da transferência se ele estiver ligado — o mesmo caminho de
`handoff_human` (`transferToHuman` em `tools.ts`), com o aviso só na transição.

**Agrupamento.** Um `KnowledgeGap` é um assunto; cada conversa que perguntou é
uma `KnowledgeGapOccurrence`, única por assunto + conversa — o mesmo contato
perguntando de novo não vira "2 contatos". Junta-se só com assunto **aberto**
do **mesmo agente** (a base é por agente): primeiro pelo texto normalizado,
depois pelo vetor (`GROUP_MAX_DISTANCE = 0.15`, conservador — juntar
"implante" com "clareamento" some com uma pergunta; separar paráfrases custa
só um item a mais). Respondido ou descartado não recebe pergunta nova: se o
agente ainda não soube, a base não cobriu, e isso precisa aparecer.

**Conversa de teste fica fora** da fila, dos avisos e do relatório. No
sandbox a tool avisa que não entrou na fila, mas mantém a regra de não inventar.

**Aprovar ensina o agente.** A aprovação cria um `KnowledgeDocument`
("Pergunta respondida: …", pergunta + resposta no mesmo trecho) na base do
agente da pergunta — ou do principal, se ele foi apagado — via
`ingestDocument`. Aprovar de novo **edita**: reescreve o mesmo documento
(`updateDocument`), sem duplicar trecho. `answeredAt` guarda a **primeira**
aprovação: é dela que sai o tempo de resposta. O documento aparece em
/agentes e pode ser apagado lá; `documentId` não tem FK, e a próxima aprovação
recria. Rascunho (`draftAnswer`) não vai para a base.

**Retomar o contato é opcional, explícito e nunca repete.** Só quando quem
aprova liga "Enviar a resposta a quem perguntou" (ou depois, em uma já
respondida). Cada ocorrência é reivindicada (`resumeStatus` null → sending);
envio sem confirmação vira `failed` e **não** é tentado de novo — o WhatsApp
pode ter entregado antes do erro. Ficam de fora (`skipped`, com o motivo na
tela): teste, número bloqueado, `followUpReason: "stop"`, quem já recebeu
resposta humana depois da pergunta, e quem saiu da janela
(`RESUME_WINDOW_HOURS`: 24h na Meta, que só aceita template depois disso; 7
dias no número por QR, para não virar mensagem de desconhecido). WhatsApp
desconectado não consome ninguém. A mensagem sai com `sentBy: "human"` (não
gasta cota) e **não pausa o agente**.

**Quem responde a fila** (`responders`: `clinic` | `mavellium` | `both`) é
decisão da Mavellium com o cliente — só o superadmin muda, em
`/admin/perguntas`. Padrão: clínica. As actions checam a cada chamada:
a clínica (sessão normal) só aprova com `clinic`/`both`; a Mavellium
(`/admin/perguntas` ou personificando a conta) só com `mavellium`/`both`.
Quem não responde vê a fila só para leitura.

**LGPD: dado do paciente mascarado para quem não é da clínica.** Em
`/admin/perguntas` sempre, e em `/perguntas` quando é o superadmin
personificando. `listGaps({ masked: true })` troca nome por iniciais e
telefone pelos dois últimos dígitos, e passa pergunta e trecho da conversa por
`maskText` com os nomes e números de **todos** os contatos do assunto (a Maria
pode ser citada na conversa do João), além de e-mails e sequências de 8+
dígitos. Não há link para a conversa. Avisos por e-mail e grupo nunca levam
nome ou telefone — só a pergunta e o link; o resumo da Mavellium leva só
contagens por conta.

**Avisos** (worker, `notify.ts`, nunca no turno): na hora, um aviso por
varredura e por conta com as perguntas **novas** (repetição só no resumo),
claim por `notifiedAt`; pergunta com mais de 6h quando o worker a vê não gera
aviso "na hora". Resumo diário na hora local escolhida (`digestHour`,
`timezone`), claim por `lastDigestAt`; worker parado nessa hora pula o dia.
Canais: e-mail dos usuários da conta e/ou o grupo interno do WhatsApp
(escolhido como na transferência). Só saem quando a clínica responde a fila.
Mavellium: e-mail diário às 8h para `KNOWLEDGE_GAPS_ADMIN_EMAIL`, claim em
`WorkerHeartbeat` (`knowledge-gaps:admin-digest`).

## Métricas

- **Perguntas sem resposta por mês**: continua sendo o `ReportEvent`
  `unanswered` (a tool registra os dois). A tela mostra seis meses com o atual
  marcado como parcial; o relatório mensal compara com o mês anterior.
- **Tempo médio para a equipe responder**: `answeredAt − firstAskedAt` das
  perguntas aprovadas no mês (`MonthlyMetrics.gapAnswerSeconds`/`gapsAnswered`,
  opcionais — relatório fechado antes da fila mostra "Sem registro"). No PDF
  vai dentro da célula de perguntas sem resposta, para não mudar a altura da
  página única.

## Schema

`KnowledgeGap` (com `embedding vector(1536)`, gravado por SQL cru como
`KnowledgeChunk`), `KnowledgeGapOccurrence`, `KnowledgeGapSettings`. Mudança
de schema pede `prisma db push` + `prisma generate` nos dois processos (web e
worker).

## O que NÃO faz

- Não infere desconhecimento do texto da resposta nem roda um segundo LLM
  para verificar — seria custo em toda mensagem e contaria na cota.
- Não junta nem separa assuntos à mão (ainda). Paráfrase que ficou separada é
  respondida duas vezes; a aprovação da segunda reescreve só o próprio documento.
- Não retoma contato sozinho, nem por template da Meta fora das 24h.
