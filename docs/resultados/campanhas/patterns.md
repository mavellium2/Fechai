# Campanhas — Padrões

- Parseie `Campaign.rules` com `parseCampaignRules` para preservar defaults das linhas antigas. A prévia e o turno usam `campaignRulesPrompt`. As travas de agenda são verificadas pelo servidor com `checkCampaignSlot`.
- Preserve o roteamento com `findLeadCampaign`. Se o agente vinculado não estiver disponível, segue o agente original. A conversa mantém seu `agentId`. No chat de teste, o agente é escolhido no próprio chat.
- Lembretes da consulta têm precedência sobre a regra da campanha. A opção de pausa geral da conta vale entre início e fim, sem extensão. As duas filas releem essa pausa antes do envio. Ações manuais da Agenda seguem seu próprio fluxo.
- `clinicorp.mode: "off"` impede espelho novo e alterações no Clinicorp ao remarcar pelo agente. Follow-up desligado pula a etapa durante a vigência, sem marcá-la como enviada.
- Preserve a origem pelo metadado da mensagem do WhatsApp. Um anúncio sem código continua visível com o identificador abreviado. “Sem anúncio identificado” significa origem ainda desconhecida.
- A compatibilidade da campanha temporária de implantes permanece documentada no módulo de override, com escopo, prazo e procedimentos separados da funcionalidade geral.

[Regras completas](../../../src/modules/campaigns/README.md) · [Override temporário](../../../src/modules/campaign-override/README.md)
