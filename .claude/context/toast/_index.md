# toast — Notificações de salvamento

Toast fixo no topo para todo retorno de "salvar" (carregando, sucesso, validação, rede/servidor, sessão, permissão). Código: `src/components/ui/toast/`.

| Aspecto | Onde |
| --- | --- |
| Domain | `types.ts`, `messages.ts` → [domain.md](domain.md) |
| Actions (disparam toast) | `use-save-feedback.ts`, `announce.ts`, `save-service.ts` → [actions.md](actions.md) |
| Queries (leitura/classificação) | `readResult`, `classifyFailure`, `useOptionalToast` → [queries.md](queries.md) |
| Visual | `toast-provider.tsx`, `toast-viewport.tsx` |
| Copy-paste | [patterns.md](patterns.md) · Histórico: [changelog.md](changelog.md) |

Para usar, saiba:
- [ ] Form com `useActionState` → `useActionToast`; `fetch`/botão solto → `useSaveFeedback` + `requestSave`.
- [ ] Todo retorno finalizado (sucesso, erro, aviso, info) some sozinho em 6 s com barra de tempo; mouse/foco pausa. Só "carregando" fica (até o resultado).
- [ ] Dentro de `<dialog>` modal, mantenha o `FormFeedback` inline (o toast fica `inert`).
- [ ] Nunca repasse `error.message` cru: use `errorToResult`/`sanitizeReason`.
- [ ] Guia completo: `src/components/ui/toast/TOASTS.md`. Testes: `tests/toast-feedback.test.ts`.
