# Configurações

Gerencia os dados da conta, senha, papéis, uso do plano, cidades da área de atendimento e o WhatsApp pessoal de quem atende pelo grupo de transbordo.

| Aspecto | Onde |
| --- | --- |
| Entrada | `/configuracoes` |
| Acesso | Sessão da conta. Os painéis de produto dependem do papel de cliente. |
| Código | [Página e ações](../../../src/app/(dashboard)/configuracoes) |

## Arquivos desta pasta

- [Modelos e regras de negócio](domain.md)
- [Rotas, componentes e operação](telas.md)
- [Leituras e filtros](queries.md)
- [Escritas e validação](actions.md)
- [Padrões de implementação](patterns.md)
- [Mudanças documentadas](changelog.md)

## Para mexer neste módulo, saiba que

- Mantenha pelo menos um papel ativo na conta.
- A área de atendimento é uma lista de cidades cadastradas. A classificação dos leads usa essa lista no momento da leitura.
- O WhatsApp da equipe só vale confirmado. A pessoa confirma mandando `#vincular CÓDIGO` do próprio celular para o número da clínica (QR), no privado ou no grupo. O Fechai nunca manda o código nem responde no privado.

## Referências

- [Autenticação](../autenticacao/_index.md)
- [Afiliados](../afiliados/_index.md)
- [Planos e cobrança](../cobranca/_index.md)
- [Qualidade dos leads](../../resultados/qualidade-dos-leads/_index.md)
