# Módulo: campaign-reports (leads por anúncio + relatório semanal)

> Card: "Relatório semanal de campanhas: leads por anúncio e andamento das conversas, enviado toda sexta" (Operum, sprint 1.5).
> Origem: pedido de um cliente que quer receber toda semana o nome do anúncio de cada conversa e se a campanha está dando resultado.

## O que faz

Guarda de qual anúncio (Click-to-WhatsApp, Instagram/Facebook) cada lead veio e
mostra, por anúncio, o que aconteceu com os leads. O mesmo relatório sai toda
semana, no dia e hora que a clínica escolher, em **um grupo do WhatsApp** ou **no
número da própria pessoa**.

```text
mensagem do lead (Evolution: contextInfo.externalAdReply | Meta: referral)
        │  extractEvolutionAdOrigin / extractMetaAdOrigin  (whatsapp/ad-origin.ts)
        ▼
IncomingMessage.adOrigin ─► process-incoming ─► recordLeadAdOrigin ─► LeadAdOrigin (1 por lead)
                                                         ▲
histórico da Evolution ─► backfillAdOrigins ─────────────┘   (só leads que já existem)
   ▲  botão "Importar histórico" ─► fila (CampaignReportSettings) ─► worker (history-import.ts)
   └─ ou script scripts/backfill-lead-ad-origin.ts

LeadAdOrigin + Lead + leadOutcome ─► summarizeCampaigns ─► /relatorios?visao=campanhas
                                       └─► formatCampaignMessage ─► grupo | número (worker, semanal)
```

## Arquivos

- `../whatsapp/ad-origin.ts` — puro. `parseAdCode`, `extractEvolutionAdOrigin`, `extractMetaAdOrigin` (nunca lançam; o que não é anúncio vira `null`).
- `record.ts` — `recordLeadAdOrigin` (**nunca lança**; primeiro anúncio vence).
- `summary.ts` — puro. `summarizeCampaigns`, `percent`.
- `queries.ts` — `loadCampaignSummary`, `loadCampaignReport` (com semana anterior e `trackedSince`). Só metadados.
- `settings.ts` / `settings-store.ts` — destino (grupo ou número), dia, hora e fuso do envio (`CampaignReportSettings`); `currentSlot`, `weekWindow`, `destinationProblem`, estado da importação do histórico.
- `message.ts` — puro. `formatCampaignMessage`, `rangeLabel`.
- `send.ts` — `deliverCampaignReport` (monta e envia ao destino) e `scanCampaignReports` (volta do worker).
- `phone.ts` — `isPhoneRefused`: o número digitado pode receber pelo QR? (bloqueado, "pare", contato da Meta: não).
- `backfill.ts` — `backfillAdOrigins`, usado pelo script e pela importação da tela.
- `history-import.ts` — `requestHistoryImport` (a tela pede) e `runPendingHistoryImports` (o worker lê, uma por vez).
- `../knowledge-gaps/group.ts` — `sendToInternalGroup` (compartilhado com as perguntas) e `sendToInternalPhone`.
- `../whatsapp/contact-phone.ts` — `normalizeBrazilianPhone`, a regra do número digitado (a mesma do envio de teste da satisfação).

Telas: `(dashboard)/relatorios/CampaignView.tsx` (aba **Campanhas**) e
`CampaignSettingsForm.tsx` (destino, dia, hora, "Enviar agora", "Importar
histórico"); ações em `relatorios/actions.ts`.

## Regras que não podem quebrar

**O anúncio vem do dado do WhatsApp, não do texto da conversa.** Conferido em
produção (29/10/2026): a saudação automática do WhatsApp Business **não chega
como mensagem separada**. O código da campanha (`[AD37 - Prótese Protocolo]`)
vem dentro da mensagem do próprio lead, em `contextInfo.externalAdReply`
(`greetingMessageBody`), junto de `sourceId` (id do anúncio), `sourceUrl` e
`sourceType: "ad"`. Só vale como anúncio quando o próprio WhatsApp o marca
(`sourceType: "ad"`, `ctwa_ad` ou `FB_Ads`): `externalAdReply` também aparece em
pré-visualização de link. Mensagem enviada pela clínica nunca carrega anúncio.
Na Meta é o `referral` (`source_type: "post"` não é anúncio) e não há saudação,
então o código só existe se o gestor o escreveu no título.

**`ctwaClid` e a miniatura são ignorados** de propósito: o relatório não precisa
deles e o clique identifica a pessoa na Meta.

**O primeiro anúncio do lead vence** (`LeadAdOrigin.leadId @unique`,
`createMany skipDuplicates`). Clicar em outro depois não troca a campanha da
semana já relatada. Só se completa o que faltava (código ausente) quando o
**mesmo** `sourceId` volta com ele. Gravar nunca lança e nunca derruba o turno;
conversa de teste e grupo ficam de fora.

**O agrupamento é pelo código** (`AD37`), e o `sourceId` só quando não há
código. O mesmo código com ids diferentes (o gestor duplicou o conjunto de
anúncios) é uma linha só; o nome mais frequente vence. Lead com anúncio mas sem
código aparece como "Anúncio sem código (final NNNN)", nunca com código
inventado.

**A unidade é o lead criado na janela** (`Lead.createdAt`, `isTest: false`), com
ou sem anúncio, então `de anúncio + sem anúncio identificado = leads` sempre.
"Sem anúncio identificado" **não é orgânico**: é "a mensagem não trazia
anúncio" (inclui contato de antes da captura). O resultado (agendou,
transbordou, perdeu, em andamento) é o `leadOutcome` da inteligência de
conversas, calculado na leitura e nunca gravado; agendamento conta até agora.
`trackedSince` (primeiro anúncio da conta) vai ao lado: antes dele, "sem
anúncio" é falta de registro. A comparação com a semana anterior só aparece
quando essa semana já tinha captura. Nenhuma consulta devolve nome, telefone ou
texto de conversa.

**O passado vem do histórico da Evolution, só dos leads que já existem.**
`backfillAdOrigins` lê `/chat/findMessages` em fatias de 7 dias (uma fatia pode
ter milhares de mensagens; um limite silencioso entregaria contagem pela
metade), do mais antigo ao mais recente, e liga ao lead pelo telefone resolvido
pela mesma leitura do histórico do sistema (`readHistoryMessage`, que resolve
`@lid`). Mensagem sem telefone resolvido é contada e descartada, nunca ligada
por palpite; **nunca cria lead, mensagem ou conversa**; repetir não duplica. A
Evolution grava a mesma mensagem mais de uma vez (`@lid` e telefone), então
conta-se por pessoa, não por mensagem. Meta não tem passado: ela não guarda os
webhooks.

**O destino é um grupo ou um número** (`CampaignReportSettings.destination`).
Os dois ficam guardados: trocar de um para o outro não apaga o outro.
- **Grupo:** o escolhido na própria aba (`groupId`, mesmo seletor de Perguntas) ou,
  sem escolha, o dos avisos de Perguntas (`KnowledgeGapSettings.groupId`, único
  destino da primeira versão). Grupo é do número por QR code (a Meta não tem grupos).
- **Número** (`phone`, só dígitos com 55, validado por `normalizeBrazilianPhone`): a
  própria pessoa recebe numa conversa com o número da clínica. Sai **só pelo QR
  code** e **nunca pela Meta** (texto livre fora das 24h é recusado lá). É primeiro
  contato pelo QR, que é o que leva ao bloqueio do número da clínica; por isso a
  tela pede para a pessoa mandar um "oi" desse número antes do primeiro envio, e
  `isPhoneRefused` barra o número de quem a clínica não pode procurar por aqui:
  **bloqueado, pediu para parar ou fala pela Meta** (status `refused`, que nunca
  repete sozinho). Lê com cautela: na dúvida de leitura recusa.
- Sem QR conectado o envio **espera, nunca troca de número**. Ligar o envio exige
  destino completo (`destinationProblem`); desligado salva como rascunho.

Desligado por padrão (`CampaignReportSettings.enabled`). Padrão sexta 8h, fuso da
conta; a semana cobre os 7 dias até a meia-noite de hoje (hoje fica de fora).

**Envio semanal**, `scanCampaignReports` na volta de 2 min do worker de
perguntas: dentro do dia e da hora (`currentSlot`, com tolerância de 6 h que não
atravessa a meia-noite), reivindica `lastSentAt` antes de enviar — dois workers
não mandam duas vezes. **Falha de envio nunca repete sozinha** (timeout pode ter
entregado; repetir duplica no grupo): o painel mostra o estado e "Enviar agora"
repete por decisão de uma pessoa. O que **não foi tentado** (sem grupo, sem
número, sem QR, conta sem nenhum anúncio) devolve o horário e a volta seguinte
tenta de novo até a tolerância acabar. Conta que nunca registrou anúncio não recebe
"0 leads" toda sexta. "Enviar agora" pode repetir o que o horário marcado manda
depois, no mesmo dia.

## Schema

`LeadAdOrigin` (uma por lead, cascata) e `CampaignReportSettings` (uma por
conta; destino, grupo, número e estado da importação do histórico). Mudança de
schema pede `prisma db push` + `prisma generate` **nos dois processos** (web e
worker). As colunas novas são todas opcionais ou com padrão: `db push` não pede
`--accept-data-loss`.

## Importar o histórico (uma vez por conta)

A aba só se preenche sozinha com contatos **novos**. Quem já tinha chegado de
anúncio entra depois de ler o que a Evolution guardou, e isso se pede de dois
jeitos (o mesmo `backfillAdOrigins`, sempre só em leads que já existem):

**Pela tela** (botão "Importar histórico", na aba Campanhas): a requisição só marca
`historyImportStatus = requested`; **quem lê é o worker** (`runPendingHistoryImports`,
na volta de 2 min), porque a leitura leva minutos. Uma importação por vez em todo o
worker, em segundo plano (não segura os avisos nem o envio semanal). Lê os últimos
60 dias (`HISTORY_IMPORT_DAYS`). A página se atualiza sozinha enquanto há uma
importação em andamento; `running` há mais de 30 min (worker que caiu) libera pedir
de novo. O resumo guardado (`historyImportSummary`) só tem contagens.

**Pelo script** (dentro do container do worker, que leva `scripts/` e `tsx`):

```bash
docker compose exec worker npx tsx scripts/backfill-lead-ad-origin.ts --tenant <id> --desde 2026-09-01          # simula
docker compose exec worker npx tsx scripts/backfill-lead-ad-origin.ts --tenant <id> --desde 2026-09-01 --apply  # grava
```

A saída só tem contagens. Antes de gravar, confira "sem telefone identificado" e
"sem lead no Fechai".

## O que NÃO faz

- Não entra no relatório mensal em PDF (ver card "Relatórios: gráfico de leads por anúncio de origem").
- Não mede custo por lead nem investimento: o Fechai não conhece a verba da campanha.
- Não atribui por palpite: sem anúncio no dado do WhatsApp, o lead fica "sem anúncio identificado".
- Não recupera o passado de contas pela Meta oficial.
