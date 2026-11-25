# Autenticação — Domínio

- `User` fornece identidade e papel. O callback JWT do Google relê o usuário pelo e-mail para usar o id interno.
- `PasswordResetToken` guarda o hash do token e a validade. A duração é definida em `PASSWORD_RESET_TTL_MINUTES`.
- `LoginAttempt` é a trilha de tentativas. `BlockedIp` guarda o bloqueio manual decidido pelo superadmin.
