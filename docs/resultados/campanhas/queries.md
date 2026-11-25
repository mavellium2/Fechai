# Campanhas — Consultas

| Função | Uso |
| --- | --- |
| `listCampaigns` e `getCampaign` | Lista por conta com filtros de status/período e busca um detalhe da conta. Campanha inexistente ou de outra conta retorna `null`. |
| `listRunningCampaigns` | Lista campanhas em vigor para visão geral e alertas de regra especial. |
| `loadCampaignResults` | Monta resultados de uma campanha com origem, etapa, agendamento, presença e gastos. |
| `listCapturedAds`, `listAvailableBroadcasts`, `listCampaignHistory` | Carregam os vínculos disponíveis e os eventos de auditoria do detalhe. Anúncios vêm das origens capturadas. |
| `findLeadCampaign` | Resolve campanha aplicável ao lead para o turno e para as regras de agenda. |
| `loadCampaignReport` | Consolida leads novos da conta por anúncio, com cobertura e comparação. |

Os filtros de status no banco reutilizam `statusWhere`. Ao comparar com o mensal, confira a competência e a coorte. O relatório por anúncio parte da criação do lead e o bloco opcional do mensal reconcilia a soma dos mesmos leads com anúncio.

[Consultas de campanha](../../../src/modules/campaigns/queries.ts) · [Resultados por campanha](../../../src/modules/campaigns/results.ts) · [Relatório por anúncio](../../../src/modules/campaign-reports/queries.ts)
