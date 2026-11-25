# WhatsApp — Padrões de código

## Envio e recebimento

- Responda pelo provedor do webhook que iniciou o turno. Resposta manual, follow-up, lembretes e retomada consultam `Conversation.whatsappProvider` com `listWhatsappChannels` e `pickWhatsappChannel`. Se o canal registrado cair, aguarde.
- Com Meta só para Disparos, filtre entrada da Meta antes de importar mídia, gravar canal ou pausar o agente. Preserve recibos e o botão de parar. Disparos usam a Meta e respostas de campanha recebidas pelo QR conservam a regra de atribuição.
- O webhook Meta confere assinatura no corpo bruto e valida o telefone remetente da conexão antes do atendimento. Na Evolution, dê `200 ignored` quando a conta estiver com QR bloqueado.

## Saúde e recuperação

- Abra incidente depois de queda confirmada pelo provedor. Silêncio e estado indeterminado ficam fora. O monitor pode detectar queda da Meta, mas a reconexão depende do painel.
- Recuperação insere apenas IDs ausentes e preserva data de origem. Saída de autoria desconhecida usa `sentBy: "history"`. Novas conversas ficam pausadas. A recuperação preserva canal, pausa e prioridade das existentes e não dispara atendimento.
- Se alterar o schema, aplique `db push` e `generate` no web e no worker.

[Contrato das conexões e recuperação](../../../src/modules/whatsapp/README.md) · [Testes de canais](../../../tests/whatsapp-canais.test.ts)
