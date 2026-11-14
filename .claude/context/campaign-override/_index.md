# campaign-override — Regra provisória da campanha de implantes

Diz quais leads são da campanha de implantes (18 e 19/11/2026) até o modelo `Campaign` (CMP-04) assumir. **Expira em 19/11/2026 23:59:59 (-03:00).** Código: `src/modules/campaign-override/`. Guia: `src/modules/campaign-override/README.md`.

| Aspecto | Onde |
| --- | --- |
| Domain | `config.ts`, `update.ts`, model `CampaignOverride` → [domain.md](domain.md) |
| Actions (script) | `scripts/campanha-override.ts` → [actions.md](actions.md) |
| Queries | `lead.ts`, `reschedule-list.ts` → [queries.md](queries.md) |
| Copy-paste | [patterns.md](patterns.md) · [changelog.md](changelog.md) |

Para usar, saiba:
- [ ] Ainda não muda agente, agenda nem lembretes (PR-2).
- [ ] `isCampaignLead` nunca lança; erro vira `false`.
- [ ] Regra só é gravada por script, com `--apply --actor`.
- [ ] Planilha de reagendamento tem nome e telefone: só para a clínica.
- [ ] `db push` + `generate` em web e worker.
