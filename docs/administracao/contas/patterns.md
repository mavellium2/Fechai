# Gestão de contas — Padrões

- Use `requireSuperadmin` em operações entre contas e confirme a sessão real para exportação.
- A exportação filtra credenciais e hashes e registra a solicitação em auditoria. Para restauração integral utilize os [backups](../../../deploy/BACKUP_SERVICE.md).
