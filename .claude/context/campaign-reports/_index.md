# campaign-reports — Leads por anúncio e relatório semanal de campanhas

Guarda de qual anúncio (Click-to-WhatsApp) cada lead veio e mostra, por anúncio, o que aconteceu com os leads (`/relatorios?visao=campanhas`). O mesmo relatório sai toda semana no grupo do WhatsApp das perguntas sem resposta, no dia e hora escolhidos. Código: `src/modules/campaign-reports/`.

| Aspecto | Onde |
| --- | --- |
| Domain | `whatsapp/ad-origin.ts`, `settings.ts`, `summary.ts`, schema → [domain.md](domain.md) |
| Actions (escrita) | `record.ts`, `send.ts`, `backfill.ts`, `settings-store.ts`, `relatorios/actions.ts` → [actions.md](actions.md) |
| Queries (leitura) | `queries.ts`, `message.ts` → [queries.md](queries.md) |
| Copy-paste | [patterns.md](patterns.md) · Histórico: [changelog.md](changelog.md) |

Para usar, saiba:
- [ ] O código `[ADnn - Nome]` vem **dentro da mensagem do lead** (`contextInfo.externalAdReply.greetingMessageBody`), não como mensagem da clínica. O `sourceId` é o id do anúncio.
- [ ] Só é anúncio quando o WhatsApp marca (`sourceType: "ad"`, `ctwa_ad`, `FB_Ads`); pré-visualização de link também usa `externalAdReply`.
- [ ] O **primeiro** anúncio do lead vence (`leadId @unique`); gravar **nunca lança**.
- [ ] "Sem anúncio identificado" **não é orgânico**. `de anúncio + sem anúncio = leads`.
- [ ] Resultado do lead = `leadOutcome` (lead-insights), calculado na leitura.
- [ ] Envio: mesmo grupo de `KnowledgeGapSettings.groupId`; só por QR; sem canal **espera, nunca troca**; falha **nunca repete sozinha**.
- [ ] Passado: `scripts/backfill-lead-ad-origin.ts` (simula por padrão), só leads existentes. Meta não tem passado.
- [ ] Guia completo: `src/modules/campaign-reports/README.md`.
