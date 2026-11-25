# Qualidade dos leads — Domínio

- `ConversationInsight` guarda um registro por conversa. Cidade, procedimento e motivo de perda refletem o último valor dito. A primeira dúvida real é gravada uma vez.
- `TenantServiceArea` guarda a cidade-base e os outros municípios atendidos. `classifyCity` devolve `in`, `out` ou `unknown`. Sem área cadastrada, o resultado é desconhecido.
- `LeadQuality` agrega a base atendida, cobertura de cidade, dúvidas, desfechos, motivos de perda e situação de aquisição. Município conhecido indica cobertura de cidade. A origem de aquisição requer evidência própria.
- `leadOutcome` prioriza agendou, transbordou, perdeu e em andamento, nessa ordem. Perdeu exige sinal explícito ou 72h sem resposta do contato. O motivo derivado por inatividade é `sumiu`.
- O quadro mensal de motivos de não agendar tem uma linha de classificação por lead sem avaliação agendada. A soma fecha em atendidos menos agendaram.

[Regras e tipos do módulo](../../../src/modules/lead-insights/README.md)
