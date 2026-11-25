# Disparos — Padrões

- Use `requireBroadcastAccess` ou `requireBroadcastActor` para páginas e ações e `getBroadcastConnection` para resolver a Meta ativa da conta. A Meta pode coexistir com o QR, que mantém seu próprio canal de atendimento.
- A fila durável busca campanhas no banco e distribui vagas entre tenants. Use reserva condicional por destinatário. Cheque conexão, horário e bloqueios antes de chamar a Meta.
- Timeout, falha de gravação depois da chamada e reserva expirada são tratados como `unknown`. Recibo pode chegar depois. Reenvio explícito inclui apenas falha confirmada e elegível, com nova conferência do original no worker.
- Recibos autenticados são idempotentes e reconciliados por tenant, remetente, destinatário e id da mensagem. Recibo atualiza entrega e preserva o estado da fila.
- Use `checkBroadcastMedia` e `templatesStillApproved` para variantes e mídias. O corpo usa o template aprovado. Envio aceito entra no histórico como `sentBy: "human"`, sem acionar o modelo do agente.
- Use `scheduling/time.ts` para os horários. Para reproduzir fluxo local sem mensagens externas, o módulo documenta a Meta simulada.

[Fila, recibos e diagnóstico](../../../src/modules/broadcasts/README.md)
