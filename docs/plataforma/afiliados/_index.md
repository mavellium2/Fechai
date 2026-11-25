# Afiliados

Cuida dos links de indicação, comissões recorrentes e visão de resultados do programa de afiliados.

| Aspecto | Onde |
| --- | --- |
| Entrada | `/afiliados`, `/afiliado` e `/relatorios?visao=afiliados` |
| Acesso | Landing pública. Painel e visão de afiliados dependem do papel ativo na conta. |
| Código | [Módulo affiliates](../../../src/modules/affiliates) |

## Arquivos desta pasta

- [Modelos e regras de negócio](domain.md)
- [Rotas, componentes e operação](telas.md)
- [Leituras e filtros](queries.md)
- [Escritas e validação](actions.md)
- [Padrões de implementação](patterns.md)
- [Mudanças documentadas](changelog.md)

## Para mexer neste módulo, saiba que

- A indicação segue o primeiro vínculo. Cada conta indicada recebe um único `Referral`.
- Sair do programa preserva código, indicações e comissões. `OPTED_OUT` registra saída voluntária e `SUSPENDED` registra suspensão.

## Referências

- [Guia técnico](../../../src/modules/affiliates/README.md)
- [Configurações](../configuracoes/_index.md)
- [Planos e cobrança](../cobranca/_index.md)
