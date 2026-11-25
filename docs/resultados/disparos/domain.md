# Disparos — Domínio

- `BroadcastCampaign` guarda remetente, template, variante sem nome, vínculo opcional de campanha, agenda, faixa diária, consentimento e referência ao disparo original quando é reenvio.
- `BroadcastRecipient` guarda conteúdo resolvido e estado de execução (`pending`, `sending`, `sent`, `failed`, `unknown`, `skipped`, `cancelled`). `sent` significa aceitação e id devolvido pela Meta.
- O estado `deliveryStatus` acompanha recibos. Lido prevalece sobre entregue, entrega sobre falha. Um recibo atrasado preserva a evolução já registrada.
- `BroadcastReceipt` guarda retorno autenticado e idempotente, inclusive quando chega antes de o worker persistir o id da mensagem. `WorkerHeartbeat` mede atividade do serviço.
- `isTest` está no destinatário. Testes são envios reais quando a Meta está conectada. Eles ficam fora da fila normal e das métricas de desempenho e não mudam a conversa existente para sandbox.
- Templates são aprovados e compatíveis com a Meta. Imagem, vídeo e documento usam o cabeçalho de mídia aprovado. Botões podem ser resposta rápida ou link. O botão explícito de parar registra opt-out.

[Estados, recibos e esquema](../../../src/modules/broadcasts/README.md)
