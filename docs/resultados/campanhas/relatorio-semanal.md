# Campanhas — Relatório semanal por anúncio

Em **Relatórios → Campanhas → Anúncios**, o painel consolida leads criados na janela e o que aconteceu com eles. O gráfico mostra os 10 maiores anúncios, um grupo para os demais e “Sem anúncio identificado”. A tabela mantém a base completa. `trackedSince` sinaliza o início da captura.

## Captura e histórico

- A Evolution fornece `externalAdReply` e a Meta, `referral`. Só eventos identificados pelo provedor como anúncio alimentam `LeadAdOrigin`.
- O primeiro anúncio do lead vence. Quando o mesmo identificador volta com um código antes ausente, o registro pode ser completado. O agrupamento usa código quando houver.
- **Importar histórico** pede ao worker para ler a Evolution em fatias, resolver o contato e preencher a origem de leads existentes. A importação é idempotente. A Meta só fornece os eventos que chegam ao webhook.

## Entrega

- **Configurar relatório semanal** salva destino, dia, hora e fuso em `CampaignReportSettings`. A configuração começa desligada. Por padrão, a semana cobre sete dias fechados.
- Prévia e envio usam `buildCampaignDocument`. A entrega usa apenas QR, ao grupo configurado ou ao número aceito pelo fluxo. Bloqueio, pedido para parar ou contato vinculado à Meta impedem envio ao número.
- O worker reserva a janela antes de enviar. Resultado incerto aguarda conferência humana para evitar duplicação. Situações sem tentativa podem devolver a reserva até o fim da tolerância.
- As ações `saveCampaignSettingsAction`, `sendCampaignReportNowAction` e `requestCampaignHistoryImportAction` ficam em `relatorios/actions.ts`.

[Contrato de captura, envio e operação](../../../src/modules/campaign-reports/README.md) · [Relatório mensal](../relatorio-mensal/_index.md)
