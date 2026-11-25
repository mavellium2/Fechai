# Qualidade dos leads

Mede cidades, dúvidas iniciais, motivos de perda e desfechos dos contatos atendidos no período.

| Aspecto | Detalhe |
| --- | --- |
| Relatório | `/relatorios?visao=leads` |
| Configuração | `/configuracoes`, card Área de atendimento |
| Modelos | `ConversationInsight`, `TenantServiceArea` |
| Servidor | `src/modules/lead-insights/` |

## Arquivos desta pasta

[Domínio](domain.md) · [Telas](telas.md) · [Consultas](queries.md) · [Ações](actions.md) · [Padrões](patterns.md) · [Histórico](changelog.md)

## Antes de alterar

- Registre só o que o contato disse. Cidade, área e desfecho têm contratos diferentes.
- O raio usa cidades cadastradas. Área ausente deixa o estado desconhecido.
- Testes ficam fora. No relatório mensal, a leitura aprovada fica congelada.

[Contrato de inteligência de conversas](inteligencia-de-conversas.md)
