# Agentes — Padrões de código

Faça a verificação de posse antes de consultar ou operar sobre o id vindo da URL. Trecho da página de edição em `src/app/(dashboard)/agentes/[id]/page.tsx`.

```ts
const agent = await getAgentOwned(tenantId, id);
if (!agent) notFound();
```

- Use o catálogo e `TenantAction.config` para habilidades. Reuse o par `parse*` e `describe*` para recuperar configurações legadas e renderizar o resumo fechado.
- Use `getActiveHandoffConfig` no atendimento. `getHandoffConfig` existe para preencher o formulário inclusive com a habilidade desligada.
- Preserve o isolamento do sandbox. Inspeção, rascunho e histórico substituído exigem conversa de teste da conta e agenda em `dryRunScheduling`.
- Formulários com `useActionState` usam `useActionToast`. Formulários em diálogo modal usam `FormFeedback` inline.

[Transferência e sandbox](../../../src/modules/agent-engine/README.md) · [Toasts](../../../src/components/ui/toast/TOASTS.md)
