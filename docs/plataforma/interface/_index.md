# Interface e navegação

Reúne a navegação, aparência e feedback de salvamento que as telas do cliente e do admin compartilham.

| Aspecto | Onde |
| --- | --- |
| Casca do painel | [PanelShell](../../../src/components/shell/PanelShell.tsx) |
| Navegação | [ShellNav](../../../src/components/shell/ShellNav.tsx) |
| Convenções de interface | [CONVENTIONS.md](../../../CONVENTIONS.md) |
| Estado de rascunho | [Proteção de alterações não salvas](../../../src/components/ui/UNSAVED_CHANGES.md) |

## Regras que afetam várias telas

- Os layouts escolhem os itens de menu pelo papel e as liberações da conta. Os guards no servidor autorizam o acesso direto.
- A barra lateral no desktop e a gaveta no celular usam a navegação do painel. Tema e preferências têm contexto próprio no admin e no tenant.
- O `ToastProvider` de `PanelShell` exibe feedback de salvamento. Use `useActionToast` com `useActionState` e `useSaveFeedback` com `requestSave` nos envios por fetch.
- Em `<dialog>` modal, mantenha `FormFeedback` inline. O diálogo torna o toast externo inalcançável. [Contrato dos toasts](../../../src/components/ui/toast/TOASTS.md)
- Respeite a preferência por movimento reduzido. [Animações e bibliotecas](animations.md)

## Histórico

- 2026-10-26 — Tema, menu e legibilidade foram revistos para os dois painéis. [Contexto técnico](../../../.claude/context/painel/_index.md)
