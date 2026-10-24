# satisfaction — Escritas

## Server Actions (`src/app/(dashboard)/relatorios/actions.ts`)
Todas: `requireProductAccess()` + `tenantId` da sessão em toda escrita; retorno `{ ok, info? , error? }`.
- **saveSurveySettingsAction(prev, formData)** — zod `surveySettingsFormSchema` → `saveSurveySettings` (upsert) → auditoria `survey.settings_updated` (antes/depois) → `revalidatePath("/relatorios")`.
- **sendSurveyTestAction(prev, formData)** — `sendSurveyTest(tenantId, phone)` → auditoria `survey.test_sent`. Erro comum: número sem conversa recente → `TEST_NEEDS_MESSAGE`.
- **setSurveyTopicAction(surveyId, topic)** — correção humana: `topics = [topic]` ou `[]`, `classifiedBy: "human"`. Topic fora de `SURVEY_TOPICS` → "Motivo inválido.".
- **markSurveyReviewedAction(surveyId)** — grava `reviewedAt`/`reviewedById`; tira do alerta do `/inicio`.

## Módulo
- **sendSurvey({ tenantId, conversationId, settings, isTest? })** (`send.ts`) — cria linha `sending` (claim) → envia pelo canal da conversa (`sendRatingPrompt` na Meta, texto numerado no QR) → `awaiting_rating`. Erro/timeout → `unknown`, sem reenvio. Recusa conversa sem `whatsappProvider`; checa bloqueio e "pare" também no teste.
- **handleSurveyReply(input)** (`capture.ts`) — nunca lança; devolve `{ handled }`. Nota reconhecida → texto baixo/alto → `awaiting_comment`; 1ª mensagem depois → comentário + agradecimento → `completed`; não é nota → `no_reply` e `handled: false` (segue ao agente); "pare" → `followUpReason = "stop"` + `STOP_CONFIRMATION`. Idempotente por `*InboundId`.
- **sendSurveyTest(tenantId, phone)** (`test-send.ts`) — só conversa real com `whatsappProvider` e `lastInboundAt` < 24h; nunca cria Lead/Conversa.
- **classifyPendingSurveys(now)** (`classify.ts`) — worker; IA em segundo plano devolve só chaves (`completeBackgroundText`, fora da cota de mensagens).

## Worker
- `scanSatisfactionSurveys()` (`workers/follow-up-worker/satisfaction.ts`), fila `satisfaction-surveys` a cada `SATISFACTION_SCAN_EVERY_MINUTES` (5), concorrência 1. `closeStaleSurveys` fecha `sending` > 10 min como `unknown` e nota sem comentário em 24h como `completed`.
