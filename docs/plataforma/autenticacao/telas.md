# Autenticação — Telas

- `LoginForm` usa credenciais e consulta o freio. O botão do Google depende de `isGoogleAuthConfigured`.
- `/esqueci-senha` retorna mensagem genérica para qualquer e-mail. `/redefinir-senha/[token]` trata token inválido, vencido e usado com a mesma mensagem.
