# Conversas — Padrões de código

O botão de assumir reaproveita a action de pausa e o feedback compartilhado. Trecho de `AssumeConversationButton.tsx`.

```tsx
const save = useSaveFeedback({ entity: "atendimento" });
return <Button disabled={paused || save.saving} loading={save.saving} onClick={() => save.run(() => setConversationAgentPaused(id, true))}>{paused ? "Atendimento assumido" : "Assumir conversa"}</Button>;
```

- Para responder pelo painel, reaproveite `sendManualReply`. O módulo valida a conversa, escolhe o canal registrado e aplica a pausa humana.
- Responsável não se grava à mão: assumir é `assumeConversation`, transferir é `transferCrmConversation` e devolver é `returnToAiAndReply` (`crm/assignments.ts`, `crm/handoff-panel.ts`). Elas fazem a troca condicional, o histórico, a espera e o aviso no grupo juntos.
- Use `needsHuman` para a fila e `agentPaused` para a pausa. Aplicar a mesma ação aos dois campos muda o comportamento de **Resolver**.
- Uma conversa recuperada por histórico preserva os timestamps. Use o caminho de recuperação descrito em WhatsApp para manter os turnos ao vivo isolados.

[Envio e pausa](../../../src/modules/agent-engine/README.md) · [WhatsApp](../../../src/modules/whatsapp/README.md)
