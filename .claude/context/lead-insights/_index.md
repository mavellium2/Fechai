# lead-insights — Inteligência de conversas

Mede a qualidade dos leads do tráfego pago: cidade, dentro/fora do raio, primeira dúvida, motivo de perda, resultado. Código: `src/modules/lead-insights/`.

| Aspecto | Onde |
| --- | --- |
| Domain | `categories.ts`, `city.ts`, `service-area.ts` → [domain.md](domain.md) |
| Actions (escrita) | `record.ts`, `tool.ts`, `service-area-store.ts`, `configuracoes/actions.ts` → [actions.md](actions.md) |
| Queries (leitura) | `queries.ts`, `summary.ts` → [queries.md](queries.md) |
| Copy-paste | [patterns.md](patterns.md) · Histórico: [changelog.md](changelog.md) |

Para usar, saiba:
- [ ] O agente só registra o que o contato **disse** (`record_lead_insight`); nada é inferido.
- [ ] Dentro/fora do raio e resultado são **calculados na leitura**, nunca gravados.
- [ ] Raio = lista de cidades por nome (`TenantServiceArea`); sem ela o veredito é `unknown`.
- [ ] Sugestões de tráfego são regra (não IA), só com 10+ leads com cidade, sempre "sugestão, não promessa".
- [ ] Relatório mensal: `MonthlyReport.leadQuality` no snapshot; PDF ganha 2ª página só com leads.
- [ ] Guia completo: `src/modules/lead-insights/README.md` e `docs/resultados/qualidade-dos-leads/inteligencia-de-conversas.md`.
