# campaign-override — Regra provisória da campanha de implantes

Quem é lead da campanha de implantes (18 e 19/11/2026) até o `Campaign` (CMP-04) assumir. **Expira em 19/11/2026 23:59:59 (-03:00).** Código: `src/modules/campaign-override/`.

| Aspecto | Onde |
| --- | --- |
| Domain | `config.ts`, `agent.ts`, `slot-lock.ts` → [domain.md](domain.md) |
| Actions | `repository.ts`, `clear-reminders.ts`, `scripts/` → [actions.md](actions.md) |
| Queries | `lead.ts`, `reschedule-list.ts` → [queries.md](queries.md) |
| Outros | [patterns.md](patterns.md) · [changelog.md](changelog.md) |

Para usar:
- [ ] Agenda, prompt e lembretes seguem a regra: só 18/19 às 09:00.
- [ ] Sem `capacityPerDay`, a agenda recusa e transfere.
- [ ] Consulta da regra não vai ao Clinicorp (`--evento` para a recepção).
- [ ] Já marcadas: `campanha-implantes-lembretes.ts` (simula por padrão).
- [ ] Gravar só por script. Planilha tem nome e telefone: só clínica.
- [ ] Sem schema novo. `isCampaignLead` nunca lança.
