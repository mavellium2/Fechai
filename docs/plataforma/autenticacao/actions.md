# Autenticação — Ações

- `startGoogleSignIn()` começa o fluxo OAuth.
- `requestPasswordReset(prev, formData)` aplica limite próprio e emite o link por e-mail quando há conta elegível.
- `resetPassword(prev, formData)` valida o token e a senha, atualiza a credencial e consome o token.
