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
`parseOverrideRules`, que nunca lança). `rules` alimenta a agenda e o prompt (seção
"Agenda e lembretes").

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

## Agenda e lembretes (URG-02 e URG-03)

**Não há segunda trava.** `agent.ts` veste a regra de uma `LeadCampaign` sintética
(`OVERRIDE_CAMPAIGN_ID`: dias, um horário por dia, `capacity = capacityPerDay`, lembretes
`off`, `outside: "handoff"`, `description` = a linha de prompt do card + `offerText`) e
`findLeadCampaign` (`campaigns/active.ts`) cai nela quando o lead não está em nenhuma
`Campaign` real — **a real vence**. Daí `checkCampaignSlot`, `list_available_slots`,
`schedule_meeting`, `reschedule_meeting`, `createAppointment`, o prompt do turno e os
lembretes (`loadReminderOverrides`) valem sem mudar um chamador. Fim sem cron: depois de
19/11 23:59:59 (-03:00) `findLeadCampaign` devolve `null` e tudo volta ao normal.

- **Recusa**: data ou hora fora de 18/19 às 09:00 devolve ao agente "Para a campanha de
  implantes, só 18 ou 19/11 com chegada às 09h00. Ofereça essas opções." (`OVERRIDE_REFUSAL`).
  A equipe marcando à mão (`source: "manual"`) não passa pela trava, como nas campanhas.
- **Falha de leitura** da regra na agenda **lança** (`getCampaignOverrideForLeadStrict`): a tool
  devolve `Falha ao executar <tool>.` e nada é gravado — nunca libera horário. No prompt vira "sem campanha".
  Como `findLeadCampaign` consulta o override para todo lead sem `Campaign` real, se a leitura do override
  falhar as tools de agenda falham para **todos** os leads (lado seguro, decisão do projeto).
- **Vagas por dia** (um horário por dia, então vaga por horário = vaga por dia), no lugar do
  conflito de agenda. Esgotado um dia, a recusa já traz o outro; esgotados os dois, a conversa
  é transferida para a equipe (`transferToHuman`, não depende da IA pedir; a simulação não transfere).
  **Sem `capacityPerDay` a regra recusa marcar e transfere** (capacidade 0, lado seguro): defina com
  `scripts/campanha-override.ts --set-capacity N`. A contagem é a dos agendamentos `scheduled` naquele
  instante, de qualquer lead (como nas `Campaign`).
- **Corrida**: contar e criar/remarcar acontece numa `$transaction` com
  `pg_advisory_xact_lock(hashtext(conta|instante))` (`slot-lock.ts`), só nesta regra. Quem perde a
  vaga recebe a recusa e o outro dia. As `Campaign` reais seguem como no #28.
- **Clinicorp**: consulta nas vagas do evento **não é espelhada** (`createAppointment` e
  `rescheduleAppointment` devolvem `clinicorpSync: skipped`; a antiga é retirada na remarcação). Google e
  iCloud seguem. A recepção lança à mão: `campanha-implantes-reagendar.ts --evento` lista também as consultas
  dentro da regra (coluna "O que fazer": "Lançar no Clinicorp" / "Reagendar").
- **Lembretes**: consulta de lead da campanha nasce com `reminderOverride = []` e o `[]` **fica**
  (não volta a `null` depois do espelho). Na marcação manual e no script de limpeza o `[]` só vale até o
  fim da regra (19/11 23:59:59): consulta depois disso, por exemplo 10/12, segue com os lembretes normais. O worker (`reminders.ts`) pula pelo mesmo `remindersFor`
  (`loadReminderOverrides` inclui os leads da regra com `reminders: "off"`; falha de leitura espera a
  próxima volta). Consulta só do Clinicorp (sem `Appointment`) é achada pelo telefone do lead e pulada
  (`overrideSuppressesReminder`, motivo `campaign`, só se a consulta é até o fim da regra; falha de leitura
  também pula). O aviso do mesmo dia é o mesmo caminho (lembrete de poucas horas); não há outro.
  **Envio e marcação manual pela `/agenda` não saem para consulta local com `[]`**: `remindersFor` devolve
  `[]` antes de considerar o envio manual (`scanAndSendReminders`, `if (rules.length === 0) continue`), e a
  tela mostra "Não foi possível enviar…" (ou o motivo gravado no último disparo, "campanha implantes", nas
  consultas que o script limpou). A recepção confirma por fora (telefone ou WhatsApp). Consulta só do
  Clinicorp (sem `Appointment` local) passa pela confirmação manual, porque o manual pula a checagem da
  campanha em `sendClinicorpConfirmation`. Follow-up de quem não agendou não muda.
- **Consultas que já existiam**: `scripts/campanha-implantes-lembretes.ts --tenant ID` simula;
  `--apply --actor USER` grava `reminderOverride = []` nas consultas futuras de leads da campanha e passa os
  `ReminderDispatch` `queued` delas para `skipped` ("campanha implantes"). Auditoria
  (`campaign_override.reminders_cleared`) e terminal levam só contagens.

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

`scripts/campanha-implantes-reagendar.ts --tenant ID [--out caminho] [--actor USER] [--no-audit] [--evento]`
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
3. Criar a regra: `--create --apply --actor USER`. **`--create` põe a regra no ar na hora** (`startsAt`
   = agora). Sem código, disparo nem lead ela não afeta ninguém, mas assim que um desses entra, vale.
4. **Capacidade antes de tudo que coloca lead na regra**: `--set-capacity N --apply --actor USER` vem
   antes de `--set-codes`, `--set-broadcasts` e `--add-lead`. Sem capacidade a agenda recusa e transfere.
5. Depois: `--set-codes`, `--set-broadcasts`, `--set-offer` e `--add-lead` (comandos acima).
6. Consultas já marcadas de leads da campanha: `npx tsx scripts/campanha-implantes-lembretes.ts --tenant ID`
   simula (sem `--apply` não grava nada); com `--apply --actor USER` grava `[]` e dispensa os disparos
   pendentes. Só acha consultas enquanto a regra vale: depois de 19/11 23:59:59 não encontra mais nada.
7. Conferir com `--show`.

## Como testar

```
npx vitest run tests/campanha-implantes-*.test.ts
```

Cobrem ator, auditoria, lead, lista de reagendamento, agenda, vagas, prompt, lembretes, limpeza e
Clinicorp. O Prisma é mockado, então não precisam de banco. Em conta real, a simulação (sem `--apply`) e o `--show` não gravam nada.

## Limites

- Consulta marcada direto no Clinicorp para telefone que nunca virou lead não é
  identificável, então não entra na lista de reagendamento.
- Consulta sem lead vinculado (`leadId` nulo) também fica de fora.
- Consulta só do Clinicorp de paciente que nunca virou lead não é identificável: o worker não
  tem como saber que é da campanha e segue lembrando.
- Lead da campanha com consulta local e consulta só no Clinicorp: o lembrete do Clinicorp é pulado
  também enquanto a regra vale e a consulta é até 19/11 (suprime por lead, não por consulta).
- Marcação manual (`createAppointment`, `repository.ts`, ~l. 226) usa `getCampaignOverrideForLead`, que
  **nunca lança** e vira `null` em erro. Se a leitura do override falhar naquela hora, a consulta criada à
  mão **não ganha `[]`**. O automático segue barrado pela regra de campanha do worker (lembrete `off` do
  lead, que vale enquanto o worker lê a regra; sem leitura ele não envia). A diferença real é o botão manual
  da `/agenda`, que nessa consulta passa a enviar (escolha humana).

## Remoção (depois de 19/11/2026)

Apague este módulo, os scripts `scripts/campanha-override.ts`,
`scripts/campanha-implantes-reagendar.ts` e `scripts/campanha-implantes-lembretes.ts`, os testes
`tests/campanha-implantes-*`, as linhas `CampaignOverride` e os eventos `campaign_override.*` de
`src/modules/audit/events.ts`. Tire também os ganchos: `overrideAsLeadCampaign` e
`loadOverrideReminderRules` em `campaigns/active.ts`, `isOverrideCampaignId`/`OVERRIDE_REFUSAL` em
`campaigns/slots.ts`, `onNoSlots`/`campaignRefusalReply` em `campaigns/agent.ts`, o lock e o pulo do
Clinicorp em `scheduling/repository.ts` e `overrideSuppressesReminder` em
`workers/follow-up-worker/clinicorp-reminders.ts`. O model e a relação em `Tenant` saem do schema numa migração.
