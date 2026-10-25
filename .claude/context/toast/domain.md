# toast — Tipos e domínio

## Tipos (`types.ts`)
- **ToastKind:** `loading | success | error | warning | info`.
- **SaveStatus:** `idle | loading | success | error` (estado de qualquer salvamento).
- **ToastInput:** `{ id?, kind, title, description?, duration?: number|null, action?: { label, href?, onClick? } }`.
  Mesmo `id` = mesmo toast (troca no lugar; `Toast.revision` sobe e reinicia o timer).
- **ActionResult:** `{ ok?: boolean|string, error?, info?, errors?: Record<campo, string|string[]>, code?: FailureKind }`.
  Superconjunto do `{ ok, error, info }` das Server Actions — nenhuma action muda.
- **SaveContext:** `{ entity, action?: save|create|update|delete, gender?: m|f, plural?, fieldLabels? }`.
- **FailureKind:** `validation | auth | forbidden | network | server`.

## Invariantes
- Duração padrão (`DEFAULT_DURATION`): success/info/warning/error 6000 (somem com barra de tempo; mouse/foco pausa); `loading` = `null` (fica até o resultado).
- Máx. 3 toasts na tela (`MAX_VISIBLE`); o mais antigo sai.
- `entity` em minúsculas, sem artigo; concordância vem de `gender`/`plural`.
- Falha = `ok === false` **ou** `error` **ou** `code` **ou** `errors` não vazio. Sucesso = `ok`/`info` truthy sem falha.
- Detalhe técnico nunca vai à tela: `sanitizeReason` descarta stack, SQL, `P####`, `ECONN*`, HTML, `\n`, > 240 chars.

## Categorias de falha (`failureMessage`)
| Kind | Toast | Retry? |
| --- | --- | --- |
| validation | warning "Confira os campos" + campos/motivo | não |
| auth | error "Sua sessão expirou." + botão "Entrar" (`/login`) | não |
| forbidden | error "Você não tem permissão para …" | não |
| network | error "Sem conexão com o servidor." | sim |
| server | error "Não foi possível salvar o/a …" + motivo seguro | sim |
