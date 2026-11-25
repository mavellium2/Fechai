# Início

A página inicial acompanha a configuração da conta, o atendimento e os itens que pedem atenção.

| Aspecto | Onde |
| --- | --- |
| Entrada | `/inicio` |
| Acesso | Conta com o papel de cliente do produto. |
| Código | [InicioPage](../../../src/app/\(dashboard\)/inicio/page.tsx), [computeHomeSummary](../../../src/modules/reports/service.ts) |

## Arquivos desta pasta

- [Modelos e regras de negócio](domain.md)
- [Rotas, componentes e operação](telas.md)
- [Leituras e filtros](queries.md)
- [Escritas e validação](actions.md)
- [Padrões de implementação](patterns.md)
- [Mudanças documentadas](changelog.md)

## Para mexer neste módulo, saiba que

- A lista de configuração é derivada do banco e determina quando o resumo de atendimento fica disponível.
- O filtro de dias controla a atividade do período. Leads quentes e conversas que precisam da equipe retratam o estado atual.

## Referências

- [Contas e onboarding](../../plataforma/contas/_index.md)
- [Relatórios operacionais](../../resultados/relatorios/_index.md)
- [Conversas](../../atendimento/conversas/_index.md)
