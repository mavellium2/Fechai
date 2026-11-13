# Regra provisória da campanha de implantes (`campaign-override`)

**Provisória e com prazo.** Diz quais leads são "da campanha de implantes" do
Instituto do Sorriso (evento em 18 e 19/11/2026) até o modelo de campanhas
(`Campaign`, CMP-04) assumir esse papel. **Expira em 19/11/2026 23:59:59
(-03:00)**, corte rígido: um segundo depois ninguém mais é lead da campanha, sem
carência. Depois do evento, apague este módulo e as linhas `CampaignOverride`.

## Modelo

`CampaignOverride` (uma linha por conta e `key`, hoje `implantes-2026-11`):
`adCodes` (códigos do gestor, "AD27"), `adSourceIds` (ids de anúncio da Meta),
`broadcastCampaignIds` (disparos), `leadIds` (marcados à mão), `startsAt`,
`endsAt` e `rules` Json (`{ dates, time, capacityPerDay?, offerText? }`, lido por
`parseOverrideRules`, que nunca lança). O PR-2 usa `rules`; aqui só se guarda.

## Quem é lead da campanha (`lead.ts`)

`isCampaignLead(tenantId, leadId, now)` — **nunca lança**, erro é `false`. Vale
só dentro de `startsAt..endsAt` e quando o lead:

1. está em `leadIds` (vale também para lead de teste, para validar no sandbox); ou
2. tem `LeadAdOrigin` com `code` (sem diferença de maiúsculas) em `adCodes` ou
   `sourceId` em `adSourceIds`; ou
3. é destinatário real (não teste, enviado ou incerto) de um disparo da lista,
   ligado pela conversa do envio ou pelo telefone.

Sem regra da conta, fora do prazo ou sem sinal, é `false`. `campaignLeadOrigin`
diz a origem sem dado pessoal ("anúncio AD27", "disparo", "manual"; anúncio vence
disparo, que vence manual) e `getCampaignOverrideForLead` devolve a regra.

## Como configurar (sem deploy)

`scripts/campanha-override.ts` simula por padrão; grava só com `--apply --actor <userId>`
e registra auditoria (`campaign_override.created/updated`, só ids e quantidades):

```
npx tsx scripts/campanha-override.ts --tenant ID --create --apply --actor USER
npx tsx scripts/campanha-override.ts --tenant ID --set-codes AD27,AD31 --apply --actor USER
npx tsx scripts/campanha-override.ts --tenant ID --set-capacity 12 --set-offer "texto" --apply --actor USER
npx tsx scripts/campanha-override.ts --tenant ID --add-lead LEADID --apply --actor USER
npx tsx scripts/campanha-override.ts --tenant ID --show
```

`--create` põe `startsAt` em agora e `endsAt` em 2026-11-20T02:59:59Z.
`--show` imprime só contagens e códigos/ids de anúncio, nunca dado de lead.

## Lista para a recepção (URG-04)

`scripts/campanha-implantes-reagendar.ts --tenant ID [--out caminho] [--actor USER] [--no-audit]`
gera uma planilha (por padrão em `out/`, ignorada pelo git) com as consultas
futuras (`status: "scheduled"`) de leads da campanha cujo dia local não é
18 ou 19/11 ou cuja hora local não é 09:00. **Só leitura**: nada é alterado. A
planilha tem nome e telefone e é só para a clínica; o terminal mostra a
quantidade e o caminho. A auditoria (`campaign_override.reschedule_list_generated`)
leva só a quantidade. "Lembrete agendado" é uma linha `ReminderDispatch` em
`queued` para aquele horário: a linha só existe depois que o worker a toca, então
"não" significa que ainda não há fila, não que nenhum lembrete sairá.
