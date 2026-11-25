# Pesquisa de satisfação

Pesquisa pós-conversa por WhatsApp com nota de 1 a 5 e comentário opcional.

| Aspecto | Detalhe |
|---|---|
| Menu e rota | Relatórios › Satisfação · `/relatorios?visao=satisfacao` |
| Acesso | Produto habilitado, dados da conta da sessão |
| Dados | `SatisfactionSurveySettings`, `SatisfactionSurvey` |
| Automação | [Worker de satisfação](../../../workers/follow-up-worker/satisfaction.ts) |

## Arquivos desta pasta

[Domínio](domain.md) · [Actions](actions.md) · [Queries](queries.md) · [Telas](telas.md) · [Padrões](patterns.md) · [Histórico](changelog.md)

## Para mexer neste módulo, saiba que

1. A configuração pertence à conta. Sem registro, a pesquisa fica desligada.
2. O worker envia pelo canal da conversa e reivindica a tentativa antes do envio.
3. As interações da pesquisa são capturadas antes do turno e armazenadas fora de `Message`.
4. Envio de teste exige conversa real recente e fica fora das métricas.

[Operação e elegibilidade](../../../src/modules/satisfaction/README.md)
