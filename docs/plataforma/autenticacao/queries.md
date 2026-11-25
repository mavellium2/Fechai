# Autenticação — Consultas

- `requireTenant`, `requireOwner`, `requireSuperadmin` e `requireGuest` em `src/lib/session.ts` aplicam as guardas de sessão e papel.
- `resolveUsableResetToken(token)` lê a entrada válida, ainda dentro do prazo e sem consumo anterior.
- `loginBlockStatus(email)` consulta o freio sem incrementar tentativas.
