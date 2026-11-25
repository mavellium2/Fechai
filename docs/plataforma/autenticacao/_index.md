# Autenticação

Gerencia entrada por credenciais ou Google, sessão e redefinição de senha.

| Aspecto | Onde |
| --- | --- |
| Entrada | `/login`, `/esqueci-senha` e `/redefinir-senha/[token]` |
| Acesso | As telas de convidado redirecionam sessões ativas. O link de redefinição fica acessível fora desse grupo. |
| Código | [Auth.js](../../../src/auth.ts), [guards de sessão](../../../src/lib/session.ts) |

## Arquivos desta pasta

- [Modelos e regras de negócio](domain.md)
- [Rotas, componentes e operação](telas.md)
- [Leituras e filtros](queries.md)
- [Escritas e validação](actions.md)
- [Padrões de implementação](patterns.md)
- [Mudanças documentadas](changelog.md)

## Para mexer neste módulo, saiba que

- A conta é provisionada pelo cadastro. O Google autentica e-mail verificado que corresponda a usuário existente.
- A trilha de tentativas, o freio automático no Redis e o bloqueio manual de IP têm contratos próprios.

## Referências

- [Guia técnico](../../../src/modules/auth/README.md)
- [Contas e onboarding](../contas/_index.md)
- [Logs de auditoria](../../administracao/logs/_index.md)
