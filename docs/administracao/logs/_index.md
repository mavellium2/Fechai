# Logs de auditoria

Mostra a trilha de ações da plataforma e permite reverter eventos elegíveis e gerenciar bloqueios de IP.

| Aspecto | Onde |
| --- | --- |
| Entrada | `/admin/logs` |
| Acesso | Leitura, reversão e bloqueio de IP pelo superadmin. |
| Código | [Módulo audit](../../../src/modules/audit), [tela](../../../src/app/(admin)/admin/logs) |

## Arquivos desta pasta

- [Modelos e regras de negócio](domain.md)
- [Rotas, componentes e operação](telas.md)
- [Leituras e filtros](queries.md)
- [Escritas e validação](actions.md)
- [Padrões de implementação](patterns.md)
- [Mudanças documentadas](changelog.md)

## Para mexer neste módulo, saiba que

- Auditoria registra ator, alvo e estado alterado. A gravação normal é best effort.
- Reversão usa a lista de modelos e campos permitidos e registra um novo evento.

## Referências

- [Guia técnico](../../../src/modules/audit/README.md)
- [Autenticação](../../plataforma/autenticacao/_index.md)
