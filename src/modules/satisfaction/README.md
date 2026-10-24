# Módulo: satisfaction (pesquisa de satisfação pós-conversa)

Depois da conversa, o agente pergunta ao contato uma nota de 1 a 5 e uma frase
sobre o atendimento. A nota alimenta o painel (`/relatorios?visao=satisfacao`),
o alerta de notas baixas no `/inicio` e o relatório mensal.

## Fluxo

1. **Fim da conversa**: a última fala é do agente e o contato ficou calado por
   `delayMinutes` (padrão 3h, de 30 min a 20h). Só dentro da faixa de horas da
   conta (padrão 8h–20h, no fuso dela) e antes de `lastInboundAt + 24h − 60 min`:
   depois disso a pesquisa **expira sem enviar** (linha `expired`).
2. **Pergunta da nota**: pela Meta, lista interativa com 5 linhas ("1 ⭐" a
   "5 ⭐⭐⭐⭐⭐", botão "Avaliar"); pelo QR (Evolution), texto numerado — o QR não
   tem botões nem lista. Sempre dentro das 24h, sem template.
3. **Nota** → texto baixo (1–3: "o que poderia melhorar?") ou alto (4–5).
4. **Comentário** → só a **primeira** mensagem depois da pergunta; agradece e
   encerra ("se precisar de algo é só mandar mensagem"). Não insiste.

## Regras que não se quebram

- **Nunca vira `Message`.** O relatório conta "contato atendido" por mensagem, e
  uma mensagem do contato move `lastInboundAt` (zera o "perdeu por 72h" e reinicia
  o follow-up). Tudo mora em `SatisfactionSurvey`; `/conversas` mostra um cartão.
- **Fora do turno do agente**: `capture.ts` roda no webhook antes de
  `runAgentTurn`. Sem LLM, sem cota, sem `sentBy: "agent"`. Quem escreve outra
  coisa no lugar da nota **não é capturado** (a pesquisa vira `no_reply`) e a
  mensagem segue o atendimento normal.
- **Eco da Evolution**: o que a pesquisa envia volta como `fromMe` e sem
  `Message.whatsappMessageId` pausaria o agente ("manual pelo WhatsApp").
  `echo.ts` reconhece pelos ids guardados e, na corrida eco-antes-do-id, por
  texto idêntico numa janela de 60 s.
- **Claim antes do POST, nunca repete** (`send.ts`): a linha `sending` nasce antes
  do envio; erro ou timeout vira `unknown` e **não é reenviado** (pode ter saído).
- **Canal do contato**: sai pelo número em que ele escreveu
  (`Conversation.whatsappProvider`). Com esse número fora do ar o envio **espera,
  nunca troca para o outro**. O agente precisa responder naquele número
  (`agentRepliesOn`); QR desligado pelo admin fica fora (`listWhatsappChannels`).
- **Config da conta**, não ação do catálogo (`SatisfactionSurveySettings`, padrão
  de `KnowledgeGapSettings`): não come vaga do plano. Sem linha = desligada.
- **Sem aprovação no sistema.** A clínica aprovar o texto é processo da
  Mavellium, fora do produto. Ligada, a pesquisa sai.
- **Pare/sair** durante a pesquisa grava `followUpReason = "stop"` (regra
  existente) e manda só uma confirmação curta.

## Quem recebe (`eligibility.ts`, regra pura)

Conversou de verdade (≥ 2 mensagens do contato e ≥ 1 resposta do agente no
episódio; sem `whatsappProvider`, site/widget, fica fora). **Não recebe**: teste,
agente desligado, transferido para a equipe/prioridade (`needsHuman`,
`agentPaused` ou transbordo no episódio, mesmo devolvido ao agente), pediu para
parar, número bloqueado (rechecado antes de cada envio), reativação (P-88 não
existe: ponto de extensão `isInReactivation`), follow-up em andamento (etapa
pendente ou já enviada), última fala do agente que foi Disparo/lembrete/follow-up,
pesquisa aberta, quem **recebeu** pesquisa nos últimos 30 dias.

O follow-up tem prioridade e nunca sai depois da pesquisa
(`FollowUpCandidate.lastSurveySentAt`).

## Classificação (`classify.ts`)

`SURVEY_TOPICS` é fechado (demora, não entendeu, informação errada, preço, queria
pessoa, agendamento difícil, tom robótico, outro). A IA em segundo plano
(`completeBackgroundText`, fora da cota de mensagens, uso em `AiUsageDaily`) só
devolve **chaves**. Correção humana (`classifiedBy: "human"`) nunca é sobrescrita.
`praiseTopics` está no schema reservado para elogios; hoje nada o preenche.

## Painel, alerta e relatório

- Média, distribuição, pontos de melhoria e respostas com link para a conversa.
  Para quem não é da clínica, o comentário passa por `knowledge-gaps/mask.ts`.
- Alerta: notas 1 e 2 sem `reviewedAt` aparecem no `/inicio`.
- Relatório mensal: `MonthlyReportData.satisfaction?` (opcional, congelado no
  snapshot). Nota pelo mês da **nota** (`ratedAt`), envio pelo mês do envio, teste
  fora, escopo de agentes da revisão. **O texto do comentário nunca entra** em
  `data`, evidência, ferramentas da IA nem PDF. Média só com 5+ respostas.
  Ver `src/app/(dashboard)/relatorios/README.md`.

## Arquivos

`settings.ts`/`settings-store.ts` (config), `rating.ts` (`parseRating`),
`eligibility.ts`, `send.ts`, `capture.ts`, `echo.ts`, `test-send.ts` (envio de
teste), `categories.ts`, `classify.ts`, `summary.ts` (agregados puros, também
usados pelo relatório), `queries.ts`. Worker: `workers/follow-up-worker/satisfaction.ts`
(fila `satisfaction-surveys`, a cada 5 min). Testes: `tests/pesquisa-satisfacao*.test.ts`.

## Schema

`SatisfactionSurveySettings` e `SatisfactionSurvey` (só tabelas novas). `db push` +
`generate` nos dois processos (web e worker).
