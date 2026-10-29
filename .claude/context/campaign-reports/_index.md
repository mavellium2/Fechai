# campaign-reports — Leads por anúncio e relatório semanal de campanhas

Guarda de qual anúncio (Click-to-WhatsApp) cada lead veio e mostra, por anúncio, o que aconteceu com os leads (`/relatorios?visao=campanhas`). O mesmo relatório sai toda semana, no dia e hora escolhidos, em um grupo do WhatsApp ou no número da própria pessoa. Código: `src/modules/campaign-reports/`.

| Aspecto | Onde |
| --- | --- |
| Domain | `whatsapp/ad-origin.ts`, `settings.ts`, `summary.ts`, schema → [domain.md](domain.md) |
| Actions (escrita) | `record.ts`, `send.ts`, `phone.ts`, `backfill.ts`, `history-import.ts`, `settings-store.ts`, `relatorios/actions.ts` → [actions.md](actions.md) |
| Queries (leitura) | `queries.ts`, `message.ts` → [queries.md](queries.md) |
| Copy-paste | [patterns.md](patterns.md) · Histórico: [changelog.md](changelog.md) |

Para usar, saiba:
- [ ] O código `[ADnn - Nome]` vem **dentro da mensagem do lead** (`contextInfo.externalAdReply.greetingMessageBody`), não como mensagem da clínica. O `sourceId` é o id do anúncio.
- [ ] Só é anúncio quando o WhatsApp marca (`sourceType: "ad"`, `ctwa_ad`, `FB_Ads`); pré-visualização de link também usa `externalAdReply`.
- [ ] O **primeiro** anúncio do lead vence (`leadId @unique`); gravar **nunca lança**.
- [ ] "Sem anúncio identificado" **não é orgânico**. `de anúncio + sem anúncio = leads`.
- [ ] Resultado do lead = `leadOutcome` (lead-insights), calculado na leitura.
- [ ] Envio: destino é **grupo** (o escolhido aqui ou, sem escolha, `KnowledgeGapSettings.groupId`) **ou número** (`phone`, só QR, nunca Meta); os dois ficam guardados. Sem canal **espera, nunca troca**; falha **nunca repete sozinha**; número bloqueado/"pare"/contato da Meta é `refused`.
- [ ] Passado: botão **Importar histórico** na aba (a tela só pede; o **worker** lê, uma por vez) ou `scripts/backfill-lead-ad-origin.ts` (simula por padrão). Só leads existentes. Meta não tem passado.
- [ ] Guia completo: `src/modules/campaign-reports/README.md`.
