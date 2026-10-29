# campaign-reports — Leituras

## loadCampaignSummary(tenantId, { from, to }, now?)
- **Retorno:** `CampaignSummary`. Leads **criados** em `[from, to)`, `isTest: false`, conversa real; `adOrigin` + `leadOutcome`. Só metadados.

## loadCampaignReport(tenantId, range, { previousFrom?, now? })
- **Retorno:** `{ current, previous, trackedSince }`; `trackedSince` = menor `firstAdAt` da conta (`null` = nunca registrou anúncio).
- **Uso:** página `/relatorios?visao=campanhas` (período do `RangePicker`; "tudo" = `new Date(0)`) e o envio semanal.

## formatCampaignMessage / rangeLabel (puros)
- Texto de WhatsApp (`*negrito*`): totais, até 10 anúncios (resto vira "e mais N"), link, rodapé sobre "sem anúncio identificado". Comparação com a semana anterior só se `trackedSince <= previousFrom + 1 dia`. Semana sem lead diz "Nenhum lead novo na semana.".
