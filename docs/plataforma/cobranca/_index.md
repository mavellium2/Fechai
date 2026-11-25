# Planos e cobrança

Reúne os planos, o checkout da Stripe e o cálculo de uso e prazo do período de teste.

| Aspecto | Onde |
| --- | --- |
| Entrada | `/planos`, `/configuracoes` e controles em `/admin/contas` |
| Acesso | Conta com papel de cliente para assinatura. Ajustes administrativos exigem superadmin. |
| Código | [Módulo billing](../../../src/modules/billing) |

## Arquivos desta pasta

- [Modelos e regras de negócio](domain.md)
- [Rotas, componentes e operação](telas.md)
- [Leituras e filtros](queries.md)
- [Escritas e validação](actions.md)
- [Padrões de implementação](patterns.md)
- [Mudanças documentadas](changelog.md)

## Para mexer neste módulo, saiba que

- `plans.ts` é a fonte dos preços e limites exibidos.
- A cota mede respostas da IA em conversas reais. O prazo de teste e a cota podem interromper a IA enquanto o painel e o atendimento manual continuam disponíveis.

## Referências

- [Guia técnico](../../../src/modules/billing/README.md)
- [ADR do preço inline](../../decisions/ADR-002-stripe-inline-price.md)
- [Gestão de contas](../../administracao/contas/_index.md)
