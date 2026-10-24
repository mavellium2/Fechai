# satisfaction — Pesquisa de satisfação pós-conversa

Depois da conversa, o lead recebe uma nota de 1 a 5 e uma pergunta aberta. A nota alimenta o painel (`/relatorios?visao=satisfacao`), o alerta de notas baixas no `/inicio` e o relatório mensal. Código: `src/modules/satisfaction/`.

| Aspecto | Onde |
| --- | --- |
| Domain | `settings.ts`, `categories.ts`, `rating.ts`, `eligibility.ts`, schema → [domain.md](domain.md) |
| Actions (escrita) | `send.ts`, `capture.ts`, `test-send.ts`, `settings-store.ts`, `classify.ts`, `relatorios/actions.ts` → [actions.md](actions.md) |
| Queries (leitura) | `queries.ts`, `summary.ts`, `echo.ts`, `reports/monthly-satisfaction.ts` → [queries.md](queries.md) |
| Copy-paste | [patterns.md](patterns.md) · Histórico: [changelog.md](changelog.md) |

Para usar, saiba:
- [ ] A pesquisa **nunca vira `Message`**: mexer em `lastInboundAt` estragaria o relatório e o follow-up.
- [ ] Nota e comentário são capturados no webhook **antes** de `runAgentTurn`: sem LLM, sem cota.
- [ ] Claim `sending` antes do POST; erro vira `unknown` e **nunca repete**.
- [ ] Sai pelo canal da conversa e espera se ele cair (nunca troca). Meta = lista interativa, QR = texto numerado.
- [ ] Config é **da conta** (`SatisfactionSurveySettings`), não ação do catálogo. Sem aprovação no sistema.
- [ ] "cancelar" **não** é opt-out. O envio de teste nunca cria lead (o teste fica fora do painel, do alerta e do relatório).
- [ ] Guia completo: `src/modules/satisfaction/README.md`.
