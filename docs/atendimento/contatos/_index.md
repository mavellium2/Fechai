# Contatos

Lista os leads da conta, permite cadastrar um telefone e iniciar ou continuar conversas pelo WhatsApp.

| Aspecto | Onde |
| --- | --- |
| Entrada | `/contatos` |
| Acesso | Conta com o papel de cliente do produto. As ações obtêm a conta da sessão. |
| Código | [Página e ações](../../../src/app/\(dashboard\)/contatos) |

## Arquivos desta pasta

- [Modelos e regras de negócio](domain.md)
- [Rotas, componentes e operação](telas.md)
- [Leituras e filtros](queries.md)
- [Escritas e validação](actions.md)
- [Padrões de implementação](patterns.md)
- [Mudanças documentadas](changelog.md)

## Para mexer neste módulo, saiba que

- Nome e telefone pertencem ao `Lead`. O mesmo telefone pode existir em contas diferentes.
- O envio manual usa o canal atribuído à conversa e pausa a IA naquela conversa.

## Referências

- [Conversas](../conversas/_index.md)
- [WhatsApp](../../operacao/whatsapp/_index.md)
- [CRM](../../painel/crm/_index.md)
