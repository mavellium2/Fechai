# Qualidade dos leads — Ações

| Ação | Comportamento |
| --- | --- |
| `record_lead_insight` | Ferramenta interna do turno, sem vaga de habilidade. Recebe cidade, procedimento, primeira dúvida real e motivo explícito de perda. |
| `recordLeadInsight` | Persiste por conversa e tenant. Devolve `saved`, `empty`, `test` ou `failed` e sempre preserva o turno em caso de falha. A primeira dúvida usa escrita condicional. |
| `saveServiceAreaAction` | Valida e salva cidade-base e municípios atendidos para a conta da sessão. |

O agente registra dados quando o contato os informa. Campos livres são higienizados antes de gravar. O veredito da área de atendimento e o desfecho são calculados a cada leitura.

[Registro da ferramenta](../../../src/modules/lead-insights/record.ts) · [Ação de configurações](../../../src/app/(dashboard)/configuracoes/actions.ts)
