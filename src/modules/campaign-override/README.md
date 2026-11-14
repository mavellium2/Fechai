# Regra provisória da campanha de implantes (`campaign-override`)

**Provisória e com prazo.** Diz quais leads são "da campanha de implantes" do
Instituto do Sorriso (evento em 18 e 19/11/2026) até o modelo de campanhas
(`Campaign`, CMP-04) assumir esse papel. **Expira em 19/11/2026 23:59:59
(-03:00)**, corte rígido: um segundo depois ninguém mais é lead da campanha, sem
carência. Depois do evento, siga a seção "Remoção" no fim deste arquivo.

## Modelo

`CampaignOverride` (uma linha por conta e `key`, hoje `implantes-2026-11`):
`adCodes` (códigos do gestor, "AD27"), `adSourceIds` (ids de anúncio da Meta),
`broadcastCampaignIds` (disparos), `leadIds` (marcados à mão), `startsAt`,
`endsAt` e `rules` Json (`{ dates, time, capacityPerDay?, offerText? }`, lido por
`parseOverrideRules`, que nunca lança). O PR-2 usa `rules`; aqui só se guarda.

## Quem é lead da campanha (`lead.ts`)

`isCampaignLead(tenantId, leadId, now)` — **nunca lança**, erro é `false`. Vale
só dentro de `startsAt..endsAt` e quando o lead:

1. está em `leadIds` (vale também para lead de teste, para validar no sandbox); ou
2. tem `LeadAdOrigin` com `code` em `adCodes` (sem diferença de maiúsculas nem de
   espaços) ou `sourceId` em `adSourceIds`; ou
3. é destinatário real (não teste, enviado ou incerto) de um disparo da lista,
   ligado pela conversa do envio ou pelo telefone.

Sem regra da conta, fora do prazo ou sem sinal, é `false`. `campaignLeadOrigin`
diz a origem sem dado pessoal ("anúncio AD27", "disparo", "manual"; anúncio vence
disparo, que vence manual) e `getCampaignOverrideForLead` devolve a regra.

## Como configurar (sem deploy)

`scripts/campanha-override.ts` simula por padrão; grava só com `--apply --actor <userId>`
e registra auditoria (`campaign_override.created/updated`: códigos, ids de anúncio e de
disparo, vagas, texto da oferta e quantidade de leads marcados; nunca um lead):

```
npx tsx scripts/campanha-override.ts --tenant ID --create --apply --actor USER
npx tsx scripts/campanha-override.ts --tenant ID --set-codes AD27,AD31 --apply --actor USER
npx tsx scripts/campanha-override.ts --tenant ID --set-capacity 12 --set-offer "texto" --apply --actor USER
npx tsx scripts/campanha-override.ts --tenant ID --add-lead LEADID --apply --actor USER
npx tsx scripts/campanha-override.ts --tenant ID --show
```

`--create` põe `startsAt` em agora e `endsAt` em 2026-11-20T02:59:59Z.
`--show` imprime só contagens e códigos/ids de anúncio, nunca dado de lead.

Outras opções: `--set-source-ids` (ids de anúncio) e `--set-broadcasts` (ids de disparo),
que trocam a lista inteira; `--remove-lead ID`. `--add-lead` e `--remove-lead` aceitam
vários ids (repetidos ou separados por vírgula). Só `--add-lead` confere no banco que
o lead é desta conta. Sem `--apply`, o script mostra o antes e o depois e não grava.

## Lista para a recepção (URG-04)

`scripts/campanha-implantes-reagendar.ts --tenant ID [--out caminho] [--actor USER] [--no-audit]`
gera uma planilha (por padrão em `out/`, ignorada pelo git) com as consultas
futuras (`status: "scheduled"`) de leads da campanha cujo dia local não é
18 ou 19/11 ou cuja hora local não é 09:00. Só entram consultas com lead vinculado e
leads que não são de teste. **Só leitura**: nada é alterado. A
planilha tem nome e telefone e é só para a clínica; o terminal mostra a
quantidade e o caminho. A auditoria (`campaign_override.reschedule_list_generated`)
leva só a quantidade. O nome da planilha é o do **paciente da consulta**
(`patientName`; sem ele, o do contato) e o telefone é o do contato.

**"Lembrete agendado"** usa a mesma regra do worker, sem duplicá-la
(`remindersFor`, `staleReminders` e `loadAccountScheduleConfigs` de
`workers/follow-up-worker/reminders.ts`): lembretes da consulta, senão os da
campanha em vigor, senão os gerais da conta (agente principal com
`schedule_meeting` ligada, respeitando o público), menos `remindersSent` e menos
os que já perderam a janela. Sobrou algum: "sim (N pendentes)"; senão "não".
Falha ao ler a config da conta ou as campanhas vira "não sei", nunca "não".

## Quem assina (`--actor`)

`--actor` precisa ser superadmin ou usuário da conta de `--tenant` (`actor.ts`).
Em `campanha-override.ts` é obrigatório com `--apply`. Em `campanha-implantes-reagendar.ts`
é opcional: sem ele a planilha sai, mas sem registro na auditoria. Com ele (e sem
`--no-audit`), um ator inválido é recusado antes de gerar o arquivo.

## Como ativar

1. Schema (tabela nova, só aditiva): `npx prisma db push` e `npx prisma generate` nos
   dois processos (web e worker). Não use `--accept-data-loss`; se o Prisma pedir essa
   flag, pare e confira o SQL do diff.
2. Sem variável de ambiente nova e sem feature flag.
3. Criar a regra e configurar a conta (comandos acima): `--create --apply --actor USER`,
   depois `--set-codes`, `--set-broadcasts`, `--set-capacity`, `--set-offer` e `--add-lead`.
4. Conferir com `--show`.

## Como testar

```
npx vitest run tests/campanha-implantes-*.test.ts
```

São 33 testes (ator, auditoria, lead e lista de reagendamento). O Prisma é mockado, então
não precisam de banco. Em conta real, a simulação (sem `--apply`) e o `--show` não gravam nada.

## Limites

- Consulta marcada direto no Clinicorp para telefone que nunca virou lead não é
  identificável, então não entra na lista de reagendamento.
- Consulta sem lead vinculado (`leadId` nulo) também fica de fora.
- O agente, a trava de agenda (URG-02) e os lembretes (URG-03) ainda não usam esta regra:
  isso vem no PR-2. Aqui `capacityPerDay` e `offerText` só são guardados.

## Remoção (depois de 19/11/2026)

Apague este módulo, os scripts `scripts/campanha-override.ts` e
`scripts/campanha-implantes-reagendar.ts`, os testes `tests/campanha-implantes-*`, as
linhas `CampaignOverride` e os três eventos `campaign_override.*` de
`src/modules/audit/events.ts`. O model e a relação em `Tenant` saem do schema numa migração.
