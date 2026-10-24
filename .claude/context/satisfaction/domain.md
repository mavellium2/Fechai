# satisfaction — Entidades e Domínio

## Entidade: SatisfactionSurveySettings (Prisma, 1 por conta)
- **Campos:** `tenantId @id`, `enabled` (false), `delayMinutes` (180, 30–1200), `windowStartHour`/`windowEndHour` (8/20), `timezone` (America/Sao_Paulo), `ratingText`/`lowText`/`highText`/`thanksText` (null = padrão `DEFAULT_SURVEY_TEXTS`).
- **Invariantes:** sem linha = desligada; `parseSurveySettings` nunca lança; fim da janela > início.

## Entidade: SatisfactionSurvey (Prisma, 1 por envio)
- **Campos:** `tenantId`, `conversationId` (Cascade), `agentId?` (SetNull), `provider` (evolution|meta), `isTest`, `status`, `textHash`, `sentAt`, `rating`, `ratedAt`, `comment`, `commentAudioUrl`, `commentAt`, ids `@unique` (`ratingMsgId`, `followMsgId`, `thanksMsgId`, `ratingInboundId`, `commentInboundId`), `topics[]`, `praiseTopics[]` (reservado), `classifiedBy` (ai|human), `reviewedAt`/`reviewedById`.
- **Status:** `sending → awaiting_rating → awaiting_comment → completed`; desvios `no_reply`, `unknown` (envio incerto), `expired` (passou do prazo), `failed` (reservado).
- **Invariantes:** nunca vira `Message`; `isTest` fora de painel, alerta, relatório, 30 dias e guarda do follow-up; correção humana de motivo não é sobrescrita pela IA.

## Regras (constantes)
- `SURVEY_WINDOW_HOURS = 24`, prazo `lastInboundAt + 24h − 60min` (`sendDeadline`).
- `SURVEY_COOLDOWN_DAYS = 30` (conta quem **recebeu**). `MIN_CONTACT_MESSAGES = 2`, `MIN_AGENT_REPLIES = 1`.
- Nota baixa = 1–3 (`isLowRating`); revisar = 1–2 (`needsReviewRating`). Média só com `MIN_ANSWERS_FOR_AVERAGE = 5`.

## Exclusões (`evaluateSurvey` → `SkipReason`)
Teste, agente desligado, `needsHuman`/`agentPaused`/transbordo no episódio, `followUpReason = "stop"`, número bloqueado, reativação (`isInReactivation`, P-88 ainda não existe), follow-up em andamento (exceto `declined`, que recebe), última fala automática, pesquisa aberta, pesquisa recebida em 30 dias, sem `whatsappProvider`.

## Interfaces/Types
- `SurveySettings` (efetivo, textos com padrão aplicado + `customized`), `SurveyCandidate`, `SurveyVerdict`.
- `SURVEY_TOPICS` (fechado): demora, não entendeu, informação errada, preço, queria pessoa, agendamento difícil, tom robótico, outro. `UNCLASSIFIED = "nao_classificado"`.
