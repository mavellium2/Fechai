# satisfaction — Padrões de Código

## Ler a config (nunca lança)
```typescript
import { getSurveySettings } from "@/modules/satisfaction/settings-store";
const settings = await getSurveySettings(tenantId); // padrão quando não há linha
if (!settings.enabled) return;
```

## Gancho no webhook (antes do turno do agente) — `process-incoming.ts`
```typescript
const survey = await handleSurveyReply({
  tenantId,
  conversationId: conversation.id,
  phone: incoming.fromPhone,
  externalId: incoming.instanceExternalId,
  provider,
  text: userMessage,
  replyId: incoming.replyId,
  messageKeyId: incoming.messageKeyId,
  hasAudio: incoming.hasAudio,
  audioUrl: received?.audioUrl,
});
if (survey.handled) return ok({ ok: true, silent: "pesquisa de satisfação" });
```

## Eco da Evolution (ramo fromMe, antes da pausa manual)
```typescript
if (await isSurveyOutbound(tenantId, conversation.id, incoming.messageKeyId, incoming.text)) {
  return ok({ ok: true, silent: "pesquisa de satisfação" });
}
```

## Ler a nota
```typescript
import { parseRating } from "@/modules/satisfaction/rating";
parseRating("⭐️⭐️⭐️⭐️⭐️"); // 5 (U+FE0F removido)
parseRating("", "rating_4"); // 4 (list_reply da Meta)
parseRating("quero remarcar"); // null → segue ao agente
```

## Formulário (toast) — `SurveySettingsForm.tsx`
```typescript
const [state, action, pending] = useActionState(saveSurveySettingsAction, null);
useActionToast(state, pending, { entity: "pesquisa de satisfação", gender: "f" });
```
