# Logs de auditoria — Padrões

- Cadastre eventos em `events.ts` e use `recordChange` para guardar apenas o que mudou. `redact.ts` retira os campos sensíveis.
- Reversão de exclusão restaura a linha elegível com o mesmo id. Os filhos apagados e os recursos externos têm recuperação própria.
