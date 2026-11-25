# Gestão de contas

Permite ao superadmin criar, gerenciar e inspecionar contas, ajustar recursos e exportar dados para suporte.

| Aspecto | Onde |
| --- | --- |
| Entrada | `/admin/contas` e `GET /api/admin/tenants/[id]/export` |
| Acesso | Superadmin. O download confere a sessão real mesmo durante personificação. |
| Código | [Serviço](../../../src/modules/admin/service.ts), [ações](../../../src/app/(admin)/actions.ts) |

## Arquivos desta pasta

- [Modelos e regras de negócio](domain.md)
- [Rotas, componentes e operação](telas.md)
- [Leituras e filtros](queries.md)
- [Escritas e validação](actions.md)
- [Padrões de implementação](patterns.md)
- [Mudanças documentadas](changelog.md)

## Para mexer neste módulo, saiba que

- A listagem padrão oculta suspensas e testes encerrados. Os filtros mostram esses casos quando selecionados.
- Exclusão definitiva exige suspensão, conta diferente da conta atual e pelo menos um superadmin remanescente.
- A liberação do [CRM](../../painel/crm/_index.md) prepara a base de leads da conta antes de disponibilizar a rota.

## Referências

- [Guia técnico](../../../src/modules/admin/README.md)
- [Ambiente de testes](../../plataforma/ambientes/_index.md)
- [CRM](../../painel/crm/_index.md)
