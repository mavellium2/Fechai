# Worker: follow-up-worker

## O que faz

Processo separado (BullMQ + Redis) que roda periodicamente e faz **duas
varreduras independentes** — as mensagens que o produto manda por conta do
relógio, não por uma resposta do contato:

| varredura | reage a | para quem |
| --- | --- | --- |
| **follow-up** | silêncio do lead sem consulta atual/futura | tenants com a ação `follow_up` ativa |
| **lembretes** | consultas chegando | tenants com `schedule_meeting` ativa **e** lembrete configurado |
| **lembretes do Clinicorp** | consultas marcadas direto no Clinicorp | os mesmos, com Clinicorp ligado e canal permitido (ver abaixo) |
| **envio ao Clinicorp** | consulta local sem criação externa confirmada | contas ativas com o espelho ligado |
| **perguntas sem resposta** | pergunta nova na fila / hora do resumo | a equipe da conta (e-mail, grupo) e a Mavellium — ver [`src/modules/knowledge-gaps/README.md`](../../src/modules/knowledge-gaps/README.md) |

Cada varredura tem sua própria fila: follow-up roda a cada 15 minutos e
lembretes a cada minuto por padrão. Assim um lembrete configurado para 23h
não espera o próximo ciclo do follow-up. As falhas de uma fila não param a outra.

A fila `clinicorp-appointment-sync` roda a cada 30 s, com concorrência global 1.
Os envios e claims ficam no banco (`ClinicorpAppointmentSync`), não no Redis:
reiniciar os processos não perde uma tentativa. O núcleo é
`src/modules/scheduling/clinicorp-sync.ts`; cada retry confere a agenda sem cache
antes de criar. Também recupera consultas futuras que ficaram sem envio antes
da fila existir. Não manda mensagens ao paciente. Lembretes locais aguardam o
envio concluir. Exige `db push` + client gerado nos processos web e worker.

A fila `icloud-calendar` (Calendário da Apple) roda a cada `ICLOUD_SCAN_EVERY_SECONDS`
(padrão 60, mínimo 15), com concorrência global 1, e faz duas coisas em ordem:
`scanIcloudSync()` (`src/modules/scheduling/icloud-sync.ts`) primeiro apaga o evento
de consulta **cancelada** que sobrou no iPhone (o DELETE falhou na hora), e depois
envia ao iCloud as consultas **futuras** sem evento — inclusive as que já existiam
quando a conta ligou o iCloud. Consulta criada há menos de 2 min fica de fora, para
não disputar com o envio na hora da marcação. Teto de 10 por conta e 50 por rodada;
recuo de 2 a 60 min entre tentativas, sem limite de tentativas. Depois vem
`scanIcloudHealth()` (`icloud-health.ts`), que confere a senha de app e o calendário
a cada 30 min por conta (máximo de 20 contas por rodada). Os lembretes **não esperam**
o iCloud. O log só tem contagens, nunca credencial:
`[icloud] contas= enviados= removidos= falhas= senha_revogada= calendario_sumiu= checadas=`.

A fila `bitrix-crm-sync` roda a cada 30 s, com concorrência global 1 e fila durável
em `BitrixSyncJob`. Envia contatos, leads/negócios e reuniões de cada conta ao seu
portal Bitrix24. Não manda mensagens ao paciente nem participa da reserva local.
Leia [`src/modules/bitrix/README.md`](../../src/modules/bitrix/README.md) para as
regras de reconexão, incerteza e cancelamento. Schema novo exige `db push` e client
gerado tanto no web quanto no worker.

## Arquivos

A fila `whatsapp-history-recovery` chama `scanWhatsappHistoryRecovery` a cada
10 s, com concorrência global 1. Recuperação solicitada pelo admin fica em
`WhatsappHistoryRecovery`, com cursor/lease e registros únicos de leitura em
`WhatsappHistoryRecoveryItem`. Processa uma página por conta/rodada, sem IA nem
envio. Reinício retoma a página não concluída; falha mostra resultado parcial e
permite nova reconciliação idempotente. Requer schema/client novos nos dois
processos. Mensagens importadas não avançam relógios de automação.

A página **Disparos** usa também este processo, em uma fila independente
`whatsapp-broadcasts` a cada 10 segundos. O núcleo fica em
[`src/modules/broadcasts/worker.ts`](../../src/modules/broadcasts/worker.ts).
Importação, autorização, proteção contra duplicação e estados estão no
[README de broadcasts](../../src/modules/broadcasts/README.md). Exige as tabelas
novas aplicadas com `prisma db push`; não depende das ações follow-up/lembrete.
Usa concorrência **global** 1 no BullMQ e uma campanha por tenant/ciclo, com
recuo nas consultas que falham. Agenda e faixa diária são verificadas antes de
cada contato. Desconexão pausa preservando pendentes. Um sinal independente a
cada 15 segundos (`WorkerHeartbeat`) expira na tela após 60 segundos sem notícia;
o serviço só anuncia saúde após consultar o Redis. Entrega/leitura vêm dos
recibos assinados da Meta, reconciliados também nesta varredura.

- `scan.ts` — follow-up em esteira (testável; ver seção abaixo):
  - `nextFollowUp(conv, cfg)` — regra pura: qual etapa vem agora e quando vence (null sem esteira, com consulta, `needsHuman` ou última msg do contato).
  - `stepsSentInRun(conv)` — quantas etapas desta esteira já saíram (`followUpStep`, só enquanto `followUpSentAt >= lastInboundAt`).
  - `isWithinFollowUpWindow(now, window, tz)` e `isStale(dueAt, now)` — janela de horas locais e etapa velha demais.
  - `scanAndSendFollowUps(now?)` — varre, compõe (IA quando a etapa pede), envia e marca `followUpSentAt` + `followUpStep`. Retorna `{ scanned, sent }`.
- `reminders.ts` — lembretes pré-consulta (ver seção abaixo):
  - `dueReminders(appt, reminders, now)` — regra pura: quais disparos venceram.
  - `staleReminders(appt, reminders, now)` — quais perderam a janela e são fechados sem envio.
  - `remindersFor(appt, cfg)` — os da consulta, ou os do agente.
  - `scanAndSendReminders(now?)` — varre consultas próximas e marca `Appointment.remindersSent`.
- `clinicorp-reminders.ts` — lembretes das consultas marcadas direto no Clinicorp:
  - `scanAndSendClinicorpReminders(now?)` — relê a agenda de cada conta, decide o canal e marca `ClinicorpReminder`.
  - `clinicorpWhatsappPhone(raw)` — telefone digitado na recepção → formato do WhatsApp.
- `index.ts` — cria as filas, agenda os jobs repetíveis (`upsertJobScheduler`) e roda os workers.
  A fila `knowledge-gaps` (a cada `KNOWLEDGE_GAP_SCAN_EVERY_MINUTES`, padrão 2)
  chama `scanKnowledgeGaps` de `src/modules/knowledge-gaps/notify.ts`.

## Lembretes de consulta (`reminders.ts`)

A antecedência e o texto de cada lembrete são configurados por agente, dentro
da ação "Agendar horário" (`TenantAction.config` da chave `schedule_meeting` —
ver `src/modules/scheduling/README.md`), e uma consulta pode ter os seus
próprios (`Appointment.reminderOverride`).

Regras que não são óbvias:

- **A config geral é da conta, não do `agentId` da consulta.** Vale a do
  agente principal (o que atende o WhatsApp, mesma ordem de `resolveAgent`),
  que é a que `/agenda` mostra como "Do agente". Ler pelo `agentId` gravado
  fazia consulta marcada antes de trocar o agente do WhatsApp — ou de agente
  apagado, com `agentId` null — seguir outra config (ou nenhuma), e ela só
  disparava depois de alguém salvar lembretes próprios. Só o override muda o
  que uma consulta recebe.

- **`Appointment.remindersSent` é uma lista, não um booleano.** Uma consulta
  tem vários disparos ("1 semana antes", "1 dia antes", "2 horas antes") e
  cada um é marcado sozinho — um booleano calaria todos depois do primeiro. E
  fica em `Appointment`, não em `Conversation` como o follow-up, porque o
  lembrete é **por consulta**: o mesmo paciente volta no mês seguinte.
- **Vários disparos vencidos de uma vez mandam UM só: o mais próximo da
  consulta.** Acontece quando o worker fica fora do ar, ou quando dois
  lembretes estão muito perto um do outro. Mandar os dois faria chegarem
  juntas "falta uma semana" e "é amanhã" — a primeira já mentindo. Os outros
  são fechados sem envio.
- **Consulta que já passou não recebe lembrete.** Worker parado por duas horas
  não pode acordar e avisar "sua consulta é amanhã" para quem já foi atendido.
  Os disparos pendentes dela são marcados **sem enviar nada**, senão seriam
  reavaliados em todo ciclo para sempre.
- **Lembrete de dias/semanas só sai no dia local previsto.** Antecedências de
  1 dia ou mais expiram no fim do dia de `reminderDueAt`, no fuso da agenda.
  Marcar/remarcar para hoje não dispara a confirmação de ontem, e reiniciar o
  worker hoje não a recupera. São fechadas sem mensagem e sem `reminderSentAt`.
  Vale também no Clinicorp e em "Enviar confirmação agora" (que ainda pode
  antecipar a hora dentro do dia correto). "Já enviei pelo WhatsApp" só registra
  o atendimento da equipe e continua disponível. Lembretes menores que 1 dia
  preservam a janela até a consulta.
- **`reminderSentAt` só é gravado quando uma mensagem saiu.** A tela mostra
  "lembrete enviado há X" a partir dele; um disparo fechado sem envio (consulta
  passada, contato sem telefone) faria essa frase mentir. `remindersSent` é
  quem controla o que falta.
- **A busca tem teto**: a maior antecedência configurada entre os agentes com
  lembrete ligado. Sem ele, a varredura carregaria a agenda do ano inteiro para
  descartar quase tudo em memória. Consultas com lembretes próprios entram por
  um `OR`, porque a antecedência delas pode passar desse teto. Lembretes com
  horário fixo acrescentam até um dia de margem, pois a manhã da véspera pode
  ficar mais de 24 horas antes de uma consulta noturna.
- **A mensagem entra na conversa** (`role: "assistant"`). É isso que faz a
  resposta do paciente cair no `runAgentTurn` normal — "não vou poder" vira
  reagendamento pelo fluxo que já existe, em vez de chegar como conversa nova.
- **Conversa de teste fica de fora** (`lead.isTest`), como no follow-up: o
  telefone do sandbox é sintético.
- **Número bloqueado não recebe lembrete.** Os disparos vencidos são fechados
  em `remindersSent`, sem mensagem e sem `reminderSentAt`, para não voltarem
  depois de desbloquear o contato nem aparecerem como enviados na agenda.
- **Falha ou desconexão do WhatsApp não marca como enviado.** A varredura tenta
  novamente enquanto a consulta ainda não começou. Depois dela, os disparos
  pendentes são fechados sem enviar mensagem atrasada.

Regressões: `tests/agendamento-lembrete.test.ts`.

## Perguntas sem resposta (`knowledge-gaps`)

A fila `knowledge-gaps` roda `scanKnowledgeGaps`
([`src/modules/knowledge-gaps/notify.ts`](../../src/modules/knowledge-gaps/notify.ts))
a cada `KNOWLEDGE_GAP_SCAN_EVERY_MINUTES` (padrão 2). Três partes, cada uma
com o próprio `catch`:

- **Aviso na hora** — perguntas abertas com `notifiedAt` null, reivindicadas
  uma a uma (`updateMany ... notifiedAt: null`) e enviadas num aviso só por
  conta. É reivindicada mesmo quando não sai (aviso desligado, clínica não
  responde a fila, sem canal, ou vista com mais de 6h): senão voltaria a cada
  volta.
- **Resumo diário** — só na hora local `digestHour` da conta; claim por
  `KnowledgeGapSettings.lastDigestAt` antes do início do dia local. Worker
  parado nessa hora pula o dia.
- **Resumo da Mavellium** — às 8h de Brasília para `KNOWLEDGE_GAPS_ADMIN_EMAIL`,
  claim em `WorkerHeartbeat` (`knowledge-gaps:admin-digest`).

Canais da clínica: e-mail dos usuários `OWNER` que usam o produto e/ou o grupo
interno do WhatsApp escolhido em `/perguntas`. Nenhum aviso leva nome ou
telefone de paciente. A retomada do contato com a resposta **não** passa pelo
worker: é a pedido de quem aprova, na action (`resume.ts`).

## Pesquisa de satisfação (`satisfaction.ts`)

Fila `satisfaction-surveys`, a cada 5 min (`SATISFACTION_SCAN_EVERY_MINUTES`),
concorrência global 1: duas varreduras ao mesmo tempo poderiam perguntar a nota
duas vezes. Para cada conta com a pesquisa ligada, olha as conversas com mensagem
do contato nas últimas 24h e pergunta a `evaluateSurvey` (regra pura em
`modules/satisfaction/eligibility.ts`): `send` → `sendSurvey` (claim antes do POST,
nunca repete), `expire` → grava `expired` sem enviar. Até 20 envios por conta por
volta. Também fecha o que ficou aberto (sem nota em 24h → `no_reply`; nota sem
comentário em 24h → `completed`; `sending` há 10 min → `unknown`) e classifica os
comentários novos (IA em segundo plano, só chaves). **Follow-up tem prioridade**: a
pesquisa não vai a quem tem esteira em andamento, e `nextFollowUp` devolve `null`
quando o contato recebeu a pesquisa depois da última mensagem dele
(`lastSurveySentAt`). Detalhes em `src/modules/satisfaction/README.md`.

## Lembretes do Clinicorp (`clinicorp-reminders.ts`)

O público escolhido na conta (`reminderAudience` / `reminderTypes`) vale para
as duas filas de lembretes e também para overrides locais. No Clinicorp,
categoria explícita por id/descrição; desconhecida fica de fora. Não inferir
tipo pelas notas. `tipo_excluido` e `tipo_desconhecido` são contadores agregados.

Fila própria (`clinicorp-reminders`), a cada `CLINICORP_REMINDER_SCAN_EVERY_MINUTES`
(padrão 5): cada volta relê a agenda do Clinicorp de cada conta, e a cada
minuto seriam 1.440 chamadas por dia por clínica. Mesmas regras de tempo de
`dueReminders`, com a lista de lembretes da conta.

O canal é o que muda, porque esse paciente quase nunca falou com o número:

- **Meta**: template aprovado de `metaReminderTemplate`, mantendo o canal.
  O mesmo template atende o lembrete comum (`reminders.ts`) de contato Meta
  fora das 24h; dentro da janela sai o texto livre.
- **Evolution**: histórico anterior ou opção QR específica, categoria por ID e
  declaração da clínica. Sem canal não envia, mas lê a agenda para registrar o
  impedimento. Aceite com ID precede histórico; incerto nunca repete.

Pula consultas espelhadas (fila local), bloqueados, pedido para parar e testes.
`ReminderDispatch` garante claim/duplicação; `ClinicorpReminder` mantém o legado.
Regras completas em `src/modules/scheduling/README.md`; regressões em
`tests/clinicorp-lembrete.test.ts` e `tests/reminder-dispatch.test.ts`.

## Como rodar

```bash
npm run db:up        # Redis precisa estar de pé
npm run worker       # tsx workers/follow-up-worker/index.ts
```

Env: `REDIS_URL`, `FOLLOWUP_SCAN_EVERY_MINUTES` (intervalo da varredura, padrão 15),
`CLINICORP_REMINDER_SCAN_EVERY_MINUTES` (lembretes do Clinicorp, padrão 5),
`ICLOUD_SCAN_EVERY_SECONDS` (envio e saúde do Calendário da Apple, padrão 60).

## Follow-up em esteira (`scan.ts`)

Configurado por agente em `/agentes/[id]` → Ações → Follow-up automático
(`TenantAction.config` da chave `follow_up`, ver `src/modules/follow-up/config.ts`).
São **duas esteiras** de mensagens espaçadas, mais uma janela de envio:

- `noReply` — o contato parou de responder. Padrão: 10 mensagens em ~29 dias,
  a primeira em 30 minutos.
- `declined` — o contato disse que não quer agendar agora. Padrão: 1, 4, 11 e
  26 dias. Quem põe a conversa aqui é o agente, pela tool `follow_up`
  (`Conversation.followUpReason = "declined"`); `"stop"` (pediu para parar)
  não recebe esteira nenhuma.

Regras que não são óbvias:

- **Não há coluna de "esteira ativa".** A esteira é o silêncio: começa na
  última fala do agente sem resposta, avança uma etapa por envio
  (`followUpStep`, com `followUpSentAt` no último) e acaba quando o contato
  escreve — `followUpStep` só vale enquanto `followUpSentAt >= lastInboundAt`,
  então a próxima esteira recomeça da etapa 1 sem ninguém zerar nada.
- **A espera da primeira etapa conta da última fala do agente**, não da
  mensagem do contato: quando quem respondeu foi um humano dias depois, contar
  do contato faria a etapa já nascer velha. As seguintes contam do envio
  anterior, para que duas etapas atrasadas pela janela não saiam juntas.
- **Janela de envio** (`window`, horas locais no fuso da agenda do agente,
  padrão 6h–22h): fora dela a etapa espera.
- **Etapa vencida há mais de `FOLLOWUP_STALE_AFTER_MINUTES` (26h) não sai**, e
  a esteira para ali até o contato escrever. Cobre o worker parado e a conta
  que acabou de ligar a ação — sem isso, toda conversa antiga e silenciosa
  receberia a primeira mensagem de uma vez. A busca também só olha conversas
  cujo último contato cabe na esteira mais longa configurada.
- **WhatsApp desconectado ou envio com falha não consome a etapa**: a próxima
  varredura tenta de novo, até a etapa ficar velha. A conexão é checada
  **antes** da IA, para não pagar por texto que não tem como sair.
- **Etapa com `ai: true`** é reescrita pela IA a partir da conversa
  (`src/modules/follow-up/compose.ts`) e grava `sentBy: "agent"` — conta na
  cota do plano, como resposta do atendimento. Sem cota, IA fora do ar ou
  resposta vazia, sai o texto fixo, que não conta.
- **Configs antigas continuam valendo.** Antes era uma mensagem só
  (`delayMinutes`, ou `delayHours` ainda antes, + `message`).
  `parseFollowUpConfig` converte numa esteira `noReply` de uma etapa, com o
  intervalo e o texto escolhidos. **Não remova esse fallback** sem migrar as
  linhas — sem ele, todo follow-up já configurado viraria em silêncio a
  esteira padrão de 10 mensagens.

A cadência da varredura (`FOLLOWUP_SCAN_EVERY_MINUTES`) é o retardo mínimo
real: uma espera menor que ela sai no próximo ciclo. Teto de cada espera:
`MAX_FOLLOWUP_DELAY_MINUTES` (30 dias); de mensagens por esteira:
`MAX_FOLLOWUP_STEPS` (15).

Regressões: `tests/follow-up-agendamento.test.ts` (varredura),
`tests/follow-up-intervalo.test.ts` (config) e `tests/follow-up-compose.test.ts` (IA).

**Consulta marcada encerra o reengajamento.** O worker ignora a conversa quando
o lead tem um `Appointment` com status `scheduled` ou `done`, futuro **ou passado**
(só consulta cancelada não conta). A
checagem é pelo `leadId`, e não só por `conversationId`, para cobrir também uma
consulta marcada manualmente em `/agenda`. A tool `follow_up` faz a mesma
checagem antes de pôr o contato na esteira de recusa ("pediu para parar" vale
mesmo com consulta marcada). Depois de agendar, mensagens
automáticas relacionadas à consulta são responsabilidade dos lembretes.

**Agente pausado ou conversa com humano nunca recebem follow-up.** Duas
chaves, dois efeitos diferentes, as duas checadas na busca (`where`) e de novo
em `nextFollowUp` (defesa em memória, mesmo padrão da consulta marcada):

- `Agent.enabled = false` é a pausa geral (ver `prisma/schema.prisma`): o dono
  desligou o agente inteiro para não atender cliente nenhum. Follow-up é
  exatamente isso — reengajar cliente — então continuar mandando por trás
  contradiz a pausa.
- `Conversation.agentPaused = true` é um humano tendo assumido *esta* conversa
  pelo painel (`sendManualMessage`). As outras conversas do mesmo agente
  continuam recebendo follow-up normalmente; só essa aqui não, para a esteira
  automática não falar por cima de quem está atendendo.

Nenhuma das duas apaga a esteira em andamento — só a pausa enquanto dura.
Agente religado ou conversa devolvida ao agente voltam a contar do
`followUpSentAt`/`followUpStep` de onde pararam, como qualquer etapa que
esperou a janela de envio.

## O que NÃO faz

- Lembretes nunca passam por IA (template fixo). No follow-up, só a etapa
  marcada com `ai: true` passa — e só ela consome a cota do plano.
- Não repete uma etapa (`followUpStep` no follow-up,
  `Appointment.remindersSent` nos lembretes — um por antecedência).
- Não responde ao que o contato escrever de volta: a mensagem entra na conversa
  e quem conduz dali em diante é o `runAgentTurn`, pelo webhook.
- Não envia follow-up para números bloqueados. Não preenche `followUpSentAt`
  nesses casos porque a tela e o relatório tratam a data como envio real.
- Não roda dentro do Next — é um processo à parte (deploy no Railway/Fly.io).

## Confirmações do Clinicorp pelo QR — 09/10/2026

Exceção específica à regra de primeiro contato: `clinicorpQrEnabled`, desligada
por padrão, permite confirmações das categorias explicitamente escolhidas, com
IDs resolvidos no Clinicorp (`clinicorpReminderCategoryIds`) e declaração da
clínica registrada em `clinicorpQrConsentAt`. Configura-se em Agentes → Agendar
horário, junto dos lembretes. Não libera Disparos ou follow-up de desconhecidos.
Quem já está na Meta continua na Meta; falta de canal não troca de número.

`ReminderDispatch` identifica tenant + origem + horário + antecedência. Consulta
espelhada usa `clinicorp:<id>` também na fila local. Claim condicional precede o
POST; `sending` abandonado vira `unknown`, nunca novo envio automático. Só o
aceite com ID grava `sent`; `ReminderReceipt` concilia entrega/leitura assinada,
inclusive antes do commit, sem regressão e sem reenvio por falha de entrega.

A agenda mostra o status e dois comandos com sessão/tenant ativo: **Enviar
confirmação agora** e **Já enviei pelo WhatsApp**. Ambos consomem o mesmo momento
da fila. Mensagem manual fora do painel precisa desse registro explícito; não
se deduz confirmação por texto. Consulta direta continua sem edição clínica no
Fechai. Categoria não identificada, cancelamento, mudança de configuração,
telefone inválido, pedido para parar, teste ou canal desconectado impedem envio.

**Teste:** “Adicionar confirmação à conversa de teste” usa o texto salvo,
`isTest` e telefone `sandbox:<agentId>`; sem WhatsApp nem consulta real. Workflow
manual `verify-clinicorp-confirmations.yml` verifica SQL com chaves sintéticas,
lê a agenda sem expor pacientes e testa a resposta no sandbox. A consulta
sintética é removida; mensagens ficam para revisão. Entrega real exige número
controlado e callback. Schema aditivo: `ReminderDispatch`/`ReminderReceipt`,
`db push` e client gerado na imagem compartilhada web/worker.
