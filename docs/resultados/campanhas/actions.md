# Campanhas — Ações

| Grupo | Funções principais |
| --- | --- |
| Dados e situação | `createCampaign`, `updateCampaign`, `activateCampaign`, `pauseCampaign`, `resumeCampaign`, `finishCampaign`, `archiveCampaign` e `unarchiveCampaign`. Ativar exige início e fim. Encerrar antecipa o fim. |
| Configuração | `saveCampaignRules`, `saveCampaignKeywords`, `linkCampaignAd`, `linkCampaignBroadcast` e suas desvinculações. |
| Leads e mídia | `addLeadToCampaign`, `removeLeadFromCampaign`, `linkTestLeadToCampaign`, `uploadCampaignAsset`, `updateCampaignAsset` e `removeCampaignAsset`. |
| Agente e aprendizado | `setCampaignAgent`, `copyAgentForCampaign` e `mergeCampaignLearning`. A cópia nasce não principal. O retorno de conhecimento transfere só documentos marcados, uma vez. |

Escritas usam conta e ator da sessão, checam `canEdit` e registram auditoria. O fluxo automático chama `attributeByAd`, `attributeByBroadcast` ou `attributeByKeyword` e preserva o turno em caso de falha de atribuição.

[Ações da campanha](../../../src/app/(dashboard)/campanhas/actions.ts) · [Ações de configuração](../../../src/app/(dashboard)/campanhas/setup-actions.ts)
