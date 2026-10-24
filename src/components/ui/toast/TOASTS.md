# Notificações de salvamento (toast)

Pilha fixa no topo, centralizada, para todo retorno de "salvar": carregando,
sucesso, erro de validação, erro de servidor/rede, sessão expirada e
permissão. `PanelShell` monta o `ToastProvider` dentro da superfície escura;
páginas fora do painel (login, cadastro) não têm provider e mantêm o retorno
inline — `useActionToast` vira no-op ali, nunca lança.

| Arquivo | Papel |
| --- | --- |
| `types.ts` | `ToastKind`, `SaveStatus`, `ActionResult`, `SaveContext` |
| `messages.ts` | Textos puros: concordância, classificação, o que nunca vai à tela |
| `announce.ts` | Retorno → toast certo (mesmo `id` do "Salvando…") |
| `save-service.ts` | `requestSave` (fetch) e `errorToResult` (exceção) → `ActionResult` |
| `toast-provider.tsx` | Estado, `useToast()`, durações padrão |
| `toast-viewport.tsx` | Visual, animação, timers, ARIA |
| `use-save-feedback.ts` | `useActionToast` e `useSaveFeedback` |

## Uso

Formulário com `useActionState` (o padrão do produto) — uma linha:

```tsx
const [state, formAction, pending] = useActionState(saveClient, null);
useActionToast(state, pending, { entity: "cliente", action: "create" });
// "Criando cliente…" → "Cliente criado com sucesso!" (ou o erro certo, no mesmo lugar)
```

Envio imperativo (`fetch`, botão fora de `<form>`), com estado
`idle | loading | success | error`:

```tsx
const save = useSaveFeedback({ entity: "cliente" });
<Button loading={save.saving} onClick={() => save.run(() => requestSave("/api/clientes", { method: "POST", body }))} />
```

`run` nunca lança e o `finally` garante que "Salvando…" não fica órfão.
Redirects do Next (`digest: NEXT_*`) passam intactos.

## Personalizar mensagens

`SaveContext`: `entity` (minúsculas, sem artigo), `action` (`save` | `create` |
`update` | `delete`), `gender` (`m`/`f`), `plural`, `fieldLabels`
(`{ email: "e-mail" }`). A mensagem que a action devolve em `info` (ou `ok` como
texto) vence a genérica — a action sabe mais ("Perfil atualizado.").

## Regras

- **Retorno padrão** é o `{ ok, error, info }` que as actions já usam. Campos
  opcionais: `errors` (por campo → "Preencha os campos obrigatórios: nome,
  e-mail.") e `code` (`validation` | `auth` | `forbidden` | `network` |
  `server`, quando a action sabe).
- **Todo retorno finalizado some sozinho em 6 s** (sucesso, info, aviso, erro),
  com uma barra na base mostrando o tempo que falta. "Carregando" não tem prazo
  e fica até o resultado. Fechar antes é com X ou Esc; nova tentativa troca o
  toast pelo mesmo `id` e reinicia a contagem. Mouse ou foco pausam o timer e a
  barra juntos, retomando do ponto em que pararam.
- **Nunca expor detalhe técnico**: `sanitizeReason` descarta stack, SQL, códigos
  do Prisma, HTML e textos longos; sobra a frase genérica. Não repasse `error.message`
  cru de exceção — passe por `errorToResult`.
- **"Tentar novamente"** só em rede/servidor e só se o chamador passar `retry`
  (`useActionToast(..., { retry })`); nunca em dado inválido, sessão ou permissão.
  Sessão expirada oferece "Entrar" (`/login`, passando pelo guard de alterações
  não salvas — o que a pessoa digitou não se perde).
- **Diálogos modais**: o viewport é um `popover="manual"` (camada superior do
  navegador), então aparece acima de um `<dialog>` aberto, mas o `<dialog>`
  deixa o resto da página `inert` e o "X" fica inalcançável. Por isso formulários
  dentro de diálogo **mantêm o `FormFeedback` inline** além do toast.
- Ao reiniciar (`setState(null)` ao editar), o toast na tela **não** é apagado.
- **Alterações não salvas** ao sair da página continuam sendo do
  `UnsavedChangesProvider` (ver `../UNSAVED_CHANGES.md`); "Continuar e salvar"
  dispara o envio do formulário e, portanto, os toasts normais.
- Tela nova de salvar: use `useActionToast`/`useSaveFeedback`, não monte texto
  de sucesso/erro à mão nem um `<p className="text-danger">`.

Testes: `tests/toast-feedback.test.ts` (mensagens, classificação, sanitização,
serviço). O visual (animação, camada superior) é verificado no navegador.
