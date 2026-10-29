# campaign-reports — Padrões de Código

## Gancho no webhook — `process-incoming.ts`
```typescript
if (incoming.adOrigin && !incoming.isGroup && !lead.isTest) {
  await recordLeadAdOrigin({ tenantId, leadId: lead.id, origin: incoming.adOrigin,
    at: incoming.occurredAt ?? new Date(), via: "webhook" });
}
```

## Extrair o anúncio de uma mensagem da Evolution (webhook ou histórico, mesma forma)
```typescript
import { extractEvolutionAdOrigin } from "@/modules/whatsapp/ad-origin";
const origin = extractEvolutionAdOrigin(data); // null se não for anúncio
```

## Enviar ao grupo interno (perguntas e relatório compartilham)
```typescript
import { sendToInternalGroup } from "@/modules/knowledge-gaps/group";
const sent = await sendToInternalGroup(tenantId, groupId, text); // false = sem canal; lança se o envio falhou
```

## Enviar a um número (QR, nunca Meta; quem chama checa `isPhoneRefused` antes)
```typescript
import { sendToInternalPhone } from "@/modules/knowledge-gaps/group";
import { isPhoneRefused } from "@/modules/campaign-reports/phone";
if (await isPhoneRefused(tenantId, phone)) return "refused";
const sent = await sendToInternalPhone(tenantId, phone, text); // false = sem QR; lança se o envio falhou
```

## Backfill do passado
```bash
npx tsx scripts/backfill-lead-ad-origin.ts --tenant <id> --desde 2026-09-01          # simula
npx tsx scripts/backfill-lead-ad-origin.ts --tenant <id> --desde 2026-09-01 --apply  # grava
```
