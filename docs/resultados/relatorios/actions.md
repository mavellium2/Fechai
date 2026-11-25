# Relatórios Operacional e Financeiro — Ações

| Ação | Comportamento |
| --- | --- |
| `saveLeadValue` | Salva o valor por lead em centavos. A correção preserva a vigência atual. Uma nova vigência registra a mudança de premissa a partir da data correspondente. |
| `saveAttendanceCost` | Salva minutos médios por atendimento e custo por hora em centavos para a estimativa de triagem. |

Os formulários ficam na visão Financeiro. As ações verificam propriedade e escopo da conta no servidor, validam os valores e revalidam a página. Mantêm feedback dentro do diálogo enquanto ele está aberto.

[Implementação das ações](../../../src/app/(dashboard)/relatorios/actions.ts) · [Convenção de feedback](../../../src/components/ui/toast/TOASTS.md)
