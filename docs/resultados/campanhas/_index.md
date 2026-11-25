# Campanhas

Organiza iniciativas de marketing, vincula leads e define o atendimento do agente durante a campanha.

| Aspecto | Detalhe |
| --- | --- |
| Rotas | `/campanhas`, `/campanhas/[id]`, `/relatorios?visao=campanhas&secao=anuncios` |
| Acesso | Produto e conta da sessão, com `requireCampaignActor` e `canEdit` |
| Modelos | `Campaign`, `CampaignLead`, `CampaignAd`, `CampaignAsset`, `LeadAdOrigin` |
| Servidor | `src/modules/campaigns/`, `src/modules/campaign-reports/` |

## Arquivos desta pasta

[Domínio](domain.md) · [Telas](telas.md) · [Consultas](queries.md) · [Ações](actions.md) · [Padrões](patterns.md) · [Histórico](changelog.md)

## Antes de alterar

- Datas definem a janela. A ação **Ativar** libera as regras para os leads.
- O vínculo pode vir de anúncio, resposta a disparo, palavra-chave ou ação manual. A primeira origem do vínculo é preservada.
- O agente da campanha roteia o turno durante a vigência e preserva o agente associado à conversa.

[Relatório semanal por anúncio](relatorio-semanal.md) · [Disparos](../disparos/_index.md)
