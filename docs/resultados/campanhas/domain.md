# Campanhas — Domínio

- `Campaign` guarda janela, ativação, pausa, arquivamento, agente vinculado, investimento e configuração em `rules`. `status.ts` deriva o estado em cada leitura.
- `CampaignLead` vincula campanha e lead com origem e data. Um lead pode estar em várias campanhas. Se várias regras estiverem em vigor, a vinculação aplicável mais recente vence.
- `CampaignAd` vincula identificador ou código de anúncio. `LeadAdOrigin` guarda a primeira origem trazida pelo WhatsApp, para atribuição e análise histórica.
- `CampaignAsset` guarda mídia e finalidade (`agent`, `broadcast`, `both`). Cada ativo enviado pelo agente é registrado para aquele lead. `BroadcastCampaign.campaignId` vincula um disparo a uma campanha.
- `Campaign.rules` define datas, horários, capacidade por horário, lembretes, follow-up, Clinicorp, instruções e extensão do atendimento para quem já agendou. A marcação manual pela equipe pode passar fora da regra de vagas.
- O funil mede o estágio mais avançado observado até comparecimento. O custo combina investimento informado e custo por mensagem. Testes ficam fora.

[Contrato das regras](../../../src/modules/campaigns/README.md)
