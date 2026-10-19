# Agenda (scheduling)

Para os relatórios, lembretes novos do fechai e Clinicorp registram a operação
`contact_reminder` após salvar a mensagem enviada (`recordMessageContext`),
apenas id/data e com exclusão de testes. O registro é best-effort e nunca altera
o resultado do envio. Uma resposta a lembrete não deve aparecer como aquisição
nova. Mensagens históricas sem esse registro conservam finalidade desconhecida;
não se deduz confirmação pelo conteúdo nem por `sentBy`.

A agenda do fechai é a **fonte da verdade**. Google Agenda e Clinicorp são
espelhos opcionais, ligados por conta (tenant). Nenhum dos dois pode derrubar um
atendimento: as funções de integração **nunca lançam** — a falha é registrada e
mostrada no painel, e o horário combinado com o lead continua de pé.

## Arquivos

| Arquivo | O que faz |
| --- | --- |
| `repository.ts` | Toda leitura/escrita da agenda. Filtra por `tenantId` sempre. A tela, as server actions e a tool `schedule_meeting` passam por aqui. |
| `config.ts` | `ScheduleConfig` (expediente, fuso, duração padrão + variações) em `TenantAction.config`, chave `schedule_meeting`. Por agente. |
| `time.ts` | Fuso: `parseLocalDateTime`, `partsInZone`, `monthRangeUtc`. Nada de data no projeto sem passar por aqui. |
| `google.ts` | Espelho no Google Agenda (OAuth por tenant). |
| `clinicorp.ts` | Espelho + leitura de disponibilidade e da agenda (para a `/agenda`) no Clinicorp (Basic auth por tenant). Cache da agenda: `listClinicorpAgenda`, `clearClinicorpAgendaCache`. |
| `agenda-pulse.ts` | A `/agenda` ao vivo: `agendaVersion` (versão do mês, igual na página e na rota), `readAgendaPulse` (o pulso), `monthDays`, `warmNeighborMonths`. |
| `meta-reminder.ts` | Template aprovado da Meta para lembrar quem nunca conversou com o número (`metaReminderTemplate`): leitura, parâmetros e validação. Puro — a tela importa. |
| `features.ts` | Quais calendários a conta habilitou em /integracoes. |
| `dimensions.ts` | As dimensões de um agendamento (tipo, situação, confirmação, comparecimento, procedimento, origem, horário de origem): rótulos e regras puras. Ver "Dimensões de um agendamento". |

Fora do módulo, o que usa estas peças:

| Arquivo | O que faz |
| --- | --- |
| `app/(dashboard)/agenda/page.tsx` | A tela. Banco primeiro, Clinicorp por streaming (`<Suspense key={mês}>`); `after()` aquece os meses vizinhos. |
| `app/(dashboard)/agenda/DayPanel.tsx` | A lista do dia (compromissos do fechai + consultas do Clinicorp), desenhada com e sem a agenda de lá. |
| `app/(dashboard)/agenda/ClinicorpAppointmentItem.tsx` | Card só leitura da consulta do Clinicorp, com "lembrete enviado". |
| `app/(dashboard)/agenda/CalendarMonth.tsx` | Grade do mês; prefetch completo em ‹ › e "Hoje", `prefetch={false}` nos dias. |
| `app/(dashboard)/agenda/AgendaLiveRefresh.tsx` | "Ao vivo" + botão Atualizar: pergunta a versão a cada 15 s e refaz só quando muda. |
| `app/(dashboard)/agenda/LinkPendingHint.tsx` | Acende o link clicado enquanto a navegação não chega (`useLinkStatus`). |
| `app/api/agenda/pulso/route.ts` | A pergunta do ao vivo: versão do mês, relendo o Clinicorp com `fresh`. |
| `app/(dashboard)/agentes/MetaReminderTemplatePicker.tsx` | Escolha do template da Meta do lembrete, variáveis e prévia. |
| `workers/follow-up-worker/clinicorp-reminders.ts` | Envia os lembretes das consultas do Clinicorp (fila própria, 5 min). |

## Dimensões de um agendamento

Cada agendamento responde a perguntas **separadas**, e nenhuma é deduzida de
outra. Antes tudo cabia em `status` (`scheduled | done | canceled`): o botão
"Concluir" gravava `done`, que o relatório lia como "compareceu" — e uma
avaliação contava como realizada sem ninguém ter conferido.

| Dimensão | Valores | Onde mora | Quem define |
| --- | --- | --- | --- |
| Tipo | avaliação, retorno, procedimento, não classificado | `kind` | tela (Marcar/Classificar) ou tool com `categoria` explícita |
| Situação | agendado, remarcado, cancelado | `status` + `rescheduledAt` | ciclo de vida |
| Confirmação | confirmado, não confirmado | `confirmedAt` (+ `confirmationSource`) | tela, antes do horário |
| Comparecimento | compareceu, faltou, não verificado | `attendance` (+ `attendanceSource`, `attendanceAt`) | tela, depois do horário |
| Procedimento | texto (implante, clareamento) | `procedure` | tela ou tool com `procedimento` |
| Origem | agente, humano, integração | `source` (`agent`/`manual`/`integration`) | quem criou |
| Horário de origem | dentro, fora, não classificado | **calculado na leitura** | `reports/origin-hours.ts` |

Regras que não se negociam:

- **Agendar ou confirmar nunca é comparecer.** `attendance` nasce `unknown` e só
  muda por marcação de alguém **depois do horário** (`canMarkAttendance`, com a
  trava repetida no `WHERE` de `setAppointmentAttendance`). Confirmar
  (`setAppointmentConfirmed`) não toca em `attendance`.
- **`status` é só ciclo de vida**: `scheduled` (de pé) ou `canceled`. Conflito,
  lembrete e horários livres filtram `status: "scheduled"` — confirmação e
  remarcação ficaram fora dele justamente para nenhum filtro esquecido deixar
  passar horário duplicado.
- **Remarcar** grava `rescheduledAt` e **limpa a confirmação** (era do horário
  antigo). Se o Clinicorp recusa o novo horário, tudo é reposto, inclusive
  `rescheduledAt` e a confirmação.
- **Tipo nunca é deduzido** do nome do serviço, das notas ou da conversa. Sem
  `kind`, o relatório mensal cai no mapeamento antigo por `serviceType` ×
  `evaluationTypes` das premissas — que é configuração conferida, não palpite.
  Valor fora da lista (`parseKind`) vira "não classificado".
- **Tipo e procedimento são independentes**: "avaliação para implante" é tipo
  avaliação, procedimento implante. O procedimento também vai ao Clinicorp em
  `Procedures` (sem repetir se a nota já o diz).
- **Horário de origem** é a primeira mensagem do contato (anterior à marcação)
  contra o expediente humano das premissas do ROI mensal (`humanHours`, a
  competência mais recente). Sem expediente ou sem chegada: "não classificado",
  jamais "dentro" presumido. Nunca gravado — o expediente pode ser corrigido.
- **Cancelar consulta com comparecimento marcado é recusado** (a action
  confere): desfaça a marcação antes.

**Legado `done`.** `attendanceOf()` lê `status: "done"` como compareceu, então
linhas antigas continuam contando como antes. `scripts/separa-dimensoes-agendamento.ts`
(prévia por padrão, `--aplicar` para gravar, idempotente) converte as que já
passaram do horário em `scheduled` + `attended`, com **`attendanceAt: null`**:
é essa ausência de data que mantém a regra do relatório para consultas
espelhadas — com espelho no Clinicorp, o status mapeado de lá vence, e sem
resposta de lá só vale marcação feita na `/agenda` (com data). `done` com
horário futuro fica como está até passar (convertido antes, receberia lembrete
e bloquearia horário).

Na `/agenda`, cada compromisso mostra as dimensões numa linha de rótulos, e os
botões são por dimensão: **Confirmar** (antes do horário), **Compareceu /
Faltou** (depois; clicar de novo desfaz), **Classificar** e **Cancelar**. O
gráfico "Comparecimento e no-show" de `/relatorios` conta, pelo **horário** da
consulta, compareceu × faltou, com "não verificado" na tabela.

Regressões: `tests/agendamento-dimensoes.test.ts`. Schema novo (colunas em
`Appointment`): `db push` + `generate` nos dois processos, depois o script.

## Configuração do agendamento por agente

### Grade semanal

`weeklyAvailability` guarda sete listas de `{ start, end }` em minutos locais,
domingo primeiro. Os intervalos são fechados no início e abertos no fim;
`1440` representa 24:00. Lista vazia fecha o dia; sete listas vazias fecham toda
a semana, sem cair no expediente padrão. A escrita valida os limites e une
períodos adjacentes; uma grade malformada na leitura nunca reabre horários.

`WeeklyAvailabilityGrid` substitui os campos de dias, abertura, fechamento e
pausas. Arrastar seleciona um retângulo de dias e horas; iniciar sobre um bloco
preenchido remove. Há desfazer, teclado, seleção do dia inteiro e visualização
em blocos de 60/30/15 minutos. Trocar a visualização não arredonda os períodos:
horários parciais aparecem parcialmente preenchidos. Pausas são os espaços
desmarcados entre períodos e podem variar de um dia para outro.

Configurações sem a propriedade continuam usando `workdays`, `startTime`,
`endTime` e `breaks`. `getWeeklyAvailability` converte esses dados sem perder
minutos nem pausas, e a nova tela grava a grade na próxima confirmação.
Não remova a compatibilidade de leitura sem migrar as linhas existentes.
`slotStartTimes(cfg, weekday)`, a validação de marcar/reagendar e o prompt usam
os períodos do dia. A consulta de conflitos cobre o dia local completo, inclusive
o último bloco até meia-noite. Regressões em `weekly-availability*.test.ts` e
`agendamento-tools.test.ts`.

Em Agentes › Ações › Agendar horário, `TenantAction.config` guarda também:

- `allowCancellation` e `allowRescheduling`: desligados por padrão, inclusive
  para configs antigas. As ferramentas de cancelar/reagendar só são expostas
  quando a opção e a ação principal estão ligadas; o handler relê essa permissão.
- `recognizeExisting`: ligado por padrão. Acrescenta ao contexto os próximos
  horários do contato na nossa agenda, mesmo sem estarem no histórico recente.
  Retorno e confirmação de lembrete não devem reiniciar o agendamento.
- `durations`: lista de `{ label, minutes }`, vazia em configs antigas e no caso
  comum. São tipos de atendimento com duração própria ("Limpeza · 30 min"), não
  um catálogo de serviços: só existe aqui o que muda o tamanho do bloco.
  `durationMinutes` continua sendo **o padrão** — o bloco de quem não disse o
  tipo, e a grade de `slotStartTimes`/`listFreeSlots`. O agente recebe a lista no
  prompt e devolve o nome em `tipoAtendimento`; `resolveDuration()` compara sem
  caixa nem acento e **cai no padrão quando o nome não existe**, porque um bloco
  do tamanho errado a clínica corrige e um lead perdido não. Nesse caso a
  resposta da tool avisa o LLM, para ele não confirmar ao contato um tipo que a
  agenda não registrou. Variação sem nome, fora de 5–480 min ou com nome
  repetido é descartada na leitura (`parseScheduleConfig`) e recusada na escrita
  (`validateDurations`) — nome repetido o agente não teria como escolher.
  `list_available_slots` continua listando a grade do padrão: uma grade por
  variação daria listas concorrentes para o mesmo dia. Um tipo mais longo que
  não couber é recusado por `schedule_meeting`, que já devolve os livres junto.
  Com o Clinicorp habilitado **e** conectado, a tela oferece trazer os nomes de
  lá (`loadClinicorpDurationNamesAction`) — ver "Tipos de atendimento" abaixo.
- `breaks`: lista de `{ label, startTime, endTime }`, vazia em configs antigas.
  Pausas repetem-se nos dias atendidos. O formulário recusa sobreposição,
  intervalos invertidos e pausas fora do expediente. `isWithinBusinessHours`
  recusa qualquer consulta que atravesse uma pausa; encostar é permitido.
- `blockedDates`: dias em que o negócio não atende (feriado, recesso), lista de
  `{ date, label }` com `date` em `YYYY-MM-DD` **no fuso do negócio** — é um dia
  do calendário de quem atende, não um instante; guardar UTC faria o bloqueio
  escorregar de dia. É a **exceção da grade**: a grade só conhece dia da semana,
  então sem isto 25/12 numa quarta é só mais uma quarta. `isWithinBusinessHours`
  checa `isBlockedDate` **antes** da grade, e por isso `listFreeSlots` e
  `schedule_meeting` já herdam a recusa — nenhum dos dois precisou mudar.
  `scheduleSystemContext` lista só as datas **futuras** (teto
  `MAX_BLOCKED_DATES_IN_PROMPT`) para o agente explicar em vez de só recusar.
  A lista é **manual de propósito**: feriado nacional não é feriado para toda
  clínica (muitas atendem), municipal não caberia numa tabela nossa e recesso
  não é feriado nenhum — uma lista automática erraria dos dois lados. Config
  antiga não tem o campo e vira lista vazia, que é o comportamento que ela já
  tinha. `parseBlockedDates` aceita também uma lista de strings simples.
- `reminderEnabled` e `reminders`: os lembretes pré-consulta. Ver a seção abaixo.

## Lembretes de consulta

Entre "marcado" e o dia da consulta não havia nenhum contato, e cadeira vazia
por paciente que esqueceu é o custo que a clínica mais sente. Com a opção
ligada, o agente manda mensagens antes do horário.

**É configuração da ação `schedule_meeting`, não uma ação nova.** Lembrete sem
agendamento não existe — não há consulta para lembrar — e uma ação própria
consumiria outra vaga do limite do plano para cobrar de novo pelo que a conta
já ligou. Como toda config de ação, só age com a ação **ligada**: a varredura
filtra `TenantAction.enabled`, mesma regra de `getActiveHandoffConfig`.

### São vários, não um

`reminders` é uma **lista** de `{ minutesBefore, template }`, ordenada do mais
distante para o mais próximo. Uma clínica costuma querer mais de um ("1 semana
antes" para dar tempo de remarcar, "2 horas antes" para quem já esqueceu), e
cada disparo diz algo diferente — por isso o texto mora em cada linha, e não
num template único para todos.

**Não há teto de quantidade.** Quantos lembretes o paciente aguenta é decisão
de quem conhece a própria base. A tela avisa em bloco a partir de
`REMINDER_COUNT_WARNING` (10) e interrompe com um popup ao ultrapassar — uma
vez por edição, porque aviso repetido treina a pessoa a fechar sem ler. O que
está em jogo é que **quem leva o bloqueio no WhatsApp é o número da clínica**,
e um número bloqueado deixa de alcançar também os outros pacientes.

**A antecedência vai de minutos a semanas** (`REMINDER_UNITS`), guardada em
minutos — a unidade é só a forma de digitar, como em `FollowUpStep.
delayMinutes`. `splitReminderLead()` devolve o valor na maior unidade inteira,
que é como a tela reabre o que foi salvo (1440 vira "1 dia", não "1440
minutos"). Teto por lembrete: `MAX_REMINDER_MINUTES` (8 semanas).

**Dois lembretes no mesmo momento são recusados** (`validateReminders`, na tela
e no servidor): "1 dia" e "24 horas" digitados sem perceber que são a mesma
coisa chegariam como duas mensagens coladas.

Lembretes com antecedência em dias ou semanas podem ter `sendTime` (`HH:mm`):
o disparo ocorre nesse horário do dia local calculado antes da consulta, usando o fuso
da agenda. Por exemplo, `minutesBefore: 1440` e `sendTime: "08:30"` disparam
às 08h30 da véspera, mesmo que a consulta seja às 15h. Sem `sendTime`, a
antecedência continua sendo uma duração exata, como nas configs antigas. O
worker amplia o teto da busca em até um dia para incluir consultas noturnas
cujo lembrete fixo vence na manhã da véspera. `remindersSent` continua usando
`minutesBefore` como identidade do disparo.

**Confirmação da véspera não sai no dia da consulta** (19/10/2026).
Lembretes com antecedência de 1 dia ou mais expiram à meia-noite que encerra
o dia local de `reminderDueAt`, no fuso da agenda. Se a consulta foi marcada
ou remarcada para hoje, ou o worker só voltou hoje, a confirmação da véspera
é fechada sem mensagem e sem gravar `reminderSentAt`. A regra é compartilhada
com as consultas diretas do Clinicorp. Lembretes de minutos/horas (menos de
1 dia) continuam válidos até o início da consulta. "Enviar confirmação agora"
pode antecipar a hora dentro do dia previsto, mas não enviar o modelo em
outro dia; "Já enviei pelo WhatsApp" continua permitindo registrar o que a
equipe fez, pois não envia mensagem. Prefira `{{data}}` e `{{hora}}` nos textos
para deixar explícito o horário da consulta.

**Configs antigas continuam valendo.** Antes o lembrete era um só, em
`reminderMinutesBefore` + `reminderTemplate`. `parseScheduleConfig` lê os dois
formatos e converte na leitura, dando preferência à lista. **Não remova esse
fallback** sem migrar as linhas — mesma lição do `delayHours` do follow-up.

### O texto é template, não IA

Cada `template` aceita `{{nome}}`, `{{data}}`, `{{hora}}` e `{{local}}`
(`REMINDER_VARIABLES`), substituídos por `renderReminder()`. Gerar cada
lembrete por LLM gastaria a cota do plano (`modules/billing/usage.ts`) para
produzir uma frase que precisa sair igual todas as vezes. Duas regras dessa
função:

- **`{{local}}` já vem com a preposição** e some quando a conta não configurou
  local — o template padrão escreve `às {{hora}}{{local}}.` por isso, senão
  sobraria "às 15:00 em ." na mensagem.
- **Token desconhecido é apagado**, não impresso cru: `{{medico}}` vira um
  buraco na frase, que é ruim, mas melhor do que mandar `{{medico}}` ao
  paciente. A tela mostra a prévia já substituída justamente para esse erro
  aparecer antes de salvar.

Contato sem nome cadastrado existe, então a limpeza final tira espaço e
pontuação órfãos: "Oi {{nome}}!" não pode virar "Oi !".

### Lembretes de UMA consulta (`reminderOverride`)

O padrão do agente serve ao caso comum, não a toda consulta: um procedimento
que exige preparo pede um aviso que a consulta de rotina não pede. Por isso
`Appointment.reminderOverride` (Json), editado no botão "Lembretes" de cada
compromisso em `/agenda`. Três estados, e a diferença entre os dois últimos é
o motivo de ser Json e não uma relação:

| valor | significado |
| --- | --- |
| `null` | segue os lembretes do agente (o caso comum) |
| `[]` | esta consulta **não recebe** lembrete nenhum |
| `[...]` | esta consulta usa exatamente estes |

Tratar `[]` como "não configurado" faria a consulta que a clínica marcou para
não lembrar receber os lembretes do agente assim mesmo. `remindersFor()` é
quem resolve isso, e o override vale **mesmo com o lembrete desligado no
agente** — são duas decisões diferentes.

**"Os lembretes do agente" são os gerais da conta**: os do agente principal
(o que atende o WhatsApp), não os do `Appointment.agentId`. É o que `/agenda`
mostra no modal, e o worker lê a mesma fonte. Seguir o `agentId` gravado
deixava sem lembrete a consulta marcada antes de trocar o agente do WhatsApp
(ou de um agente apagado), até alguém salvar um override nela.

### O que já foi enviado

**`Appointment.remindersSent`** guarda as antecedências (em minutos) dos
disparos que já saíram. É uma **lista, não um booleano**: uma consulta tem
vários disparos e cada um precisa ser marcado sozinho, senão o primeiro
calaria todos os outros. E fica em `Appointment`, não em `Conversation` como o
`followUpSentAt` do follow-up, porque o lembrete é **por consulta** — o mesmo
paciente marca de novo no mês seguinte e precisa ser lembrado outra vez.

`reminderSentAt` é só para a tela ("lembrete enviado há 2h") e **só é gravado
quando uma mensagem de fato saiu**: um disparo fechado sem envio faria essa
frase mentir.

Mudar a régua de uma consulta não reenvia o que já saiu — os marcados
continuam marcados.

Quem envia é `workers/follow-up-worker/reminders.ts`, na mesma varredura
periódica do follow-up (ver o README de lá, que documenta as regras de janela
e de consulta atrasada). A mensagem entra na conversa como `role: "assistant"`,
e é isso que faz a resposta do paciente ("não vou poder") cair no
`runAgentTurn` normal — com `recognizeExisting` dando o contexto da consulta,
cancelar e reagendar já existentes atuam sem código novo.

Regressões: `tests/agendamento-lembrete.test.ts`.

`agent-engine/scheduling-tools.ts` fornece `list_appointments`, `cancel_meeting`
e `reschedule_meeting`, como capacidades da mesma ação (sem consumir novas
ações do plano). Consulta e alteração filtram por tenant e lead. O prompt exige
identificar a consulta, perguntar a confirmação e esperar a resposta clara;
os handlers recusam alterações sem `confirmed: true`. A interpretação da
confirmação na conversa cabe ao LLM.

Reagendar preserva o ID e a duração da consulta original, valida expediente,
pausas e conflitos **antes** da alteração e sincroniza os espelhos. O conflito
ignora somente o ID local e o ID espelhado da própria consulta. Falha de
disponibilidade preserva o original; falha de espelho mantém o novo horário
na agenda local. Uma atualização concorrente impede a alteração.
Se remover o espelho antigo falhar, não cria uma segunda cópia nesse serviço e
preserva o ID antigo para uma tentativa posterior de cancelamento.

**A data original nunca desaparece na remarcação** (19/10/2026).
`AppointmentReschedule` guarda o horário anterior, a nova data, as observações
e o ID espelhado anterior, na mesma transação que muda a consulta ativa.
O calendário lê esses registros pelo mês **do horário antigo**, mesmo quando a
consulta foi para outro mês, e mostra "Remarcado", a data escolhida e quando
a troca aconteceu, sem ações de envio/cancelamento. Cada troca guarda uma linha;
rejeição explícita por conflito desfaz a alteração e seu histórico juntos.
A consulta ativa mantém o ID, limpa confirmação/lembretes do horário anterior,
e só ela entra nas filas, conflitos e cálculos de relatórios. O pulso considera
o histórico, e o ID externo antigo é deduplicado da leitura do Clinicorp.
Cancelar já mantém `Appointment` na data original com `status: canceled` e
observação; não excluir registros para cancelar nem criar uma consulta ativa
fictícia na data antiga. Registros anteriores sem histórico não são inferidos
do texto das conversas. Schema novo: `db push` + `generate` em web e worker
antes de publicar; não há reconstrução ou reenvio de consultas antigas.

`schedule_meeting` recusa duplicar uma consulta existente, salvo pedido de uma
consulta adicional (`additionalAppointment: true`); trocar data usa reagendamento.
O agente exige `patientName`: quem conversa no WhatsApp pode marcar para outra
pessoa. Esse nome vai em `Appointment.patientName`, no título da agenda e em
`PatientName` no Clinicorp; `Lead.name` continua sendo o nome do contato. Quando
os dois nomes diferem, a integração não associa o prontuário encontrado pelo
telefone do contato à paciente; o número continua sendo enviado como contato
da consulta. Reagendar preserva o nome salvo na consulta.
Regressões: `tests/agendamento-config.test.ts` e `tests/agendamento-tools.test.ts`.

## Onde cada coisa acontece

- **`/integracoes?aba=calendarios`** — habilitar E configurar. O toggle grava em
  `CalendarFeatures`; ligado, o formulário de credenciais daquele calendário
  abre dentro do mesmo card (`CalendarFeatureToggles`, prop `panels`).
- **`/agenda`** — só o **status** (`CalendarSyncStatus`): "conectado · enviando e
  recebendo", com link para gerenciar. Nada de formulário: quem olha a agenda
  quer saber se o horário que vai marcar chega na clínica, não preencher token.

Desabilitar **não apaga credencial** (isso é desconectar) — quem desliga por uma
semana reencontra tudo ao religar. Mas desabilitar **para a sincronização de
verdade**: a checagem mora em `getIntegration()` (clinicorp) e em
`pushEventToGoogle()`, no caminho por onde toda chamada passa, não só na
renderização.

A exceção é **cancelar**: `cancelAppointmentInClinicorp` usa
`ignoreFeatureFlag: true` e `deleteEventFromGoogle` não checa a flag. Cancelar um
horário aqui tem que sumir com ele lá mesmo depois de desabilitar — senão fica um
paciente fantasma na agenda da clínica.

Os cards (`GoogleCalendarCard`, `ClinicorpCard`) vivem em `(dashboard)/integracoes/`
e são **painéis**, não cards: sem título nem moldura próprios, porque o card do
toggle já os fornece — repetir dava dois "Google Agenda" na mesma caixa.

## Credenciais cifradas

`ClinicorpIntegration.apiUser` e `.apiToken` ficam cifrados com AES-256-GCM
(`src/lib/crypto.ts`), chave em `ENCRYPTION_KEY`. Isso protege um dump do banco;
não protege quem já tem a chave **e** o banco.

Regras:

- **Nunca leia a linha do banco direto.** `getIntegration()` é o único caminho de
  leitura e devolve as credenciais já decifradas; `saveClinicorpCredentials()` é
  o único de escrita e cifra. Uma tela que fizesse `prisma.clinicorpIntegration.
  findUnique()` mandaria o token cifrado no header Basic e colheria um 401 difícil
  de diagnosticar.
- Credencial que não decifra (chave trocada, linha corrompida) vira `null`, o que
  para o módulo é igual a "não conectado" — a pessoa reconecta na tela.
- Isso é o **oposto de senha de usuário**, que usa hash e nunca é lida de volta
  (`src/lib/password.ts`). O token do Clinicorp precisa voltar em texto claro.

## Conflito de horário: duas funções, não uma

- `hasConflict(tenantId, startsAt, endsAt, ignoreId?)` — só a nossa base.
- `hasConflictAnywhere(tenantId, startsAt, endsAt, timezone, ignoreId?)` — a
  nossa base **e** a agenda do Clinicorp.

Use `hasConflictAnywhere` em qualquer caminho que marque horário (a tool do
agente e a criação manual já usam). `hasConflict` continua existindo porque a
consulta local é barata e vem primeiro: quando ela já acusa conflito, não se
gasta uma chamada de rede.

Sobreposição é `início < fimExistente && fim > inícioExistente`. Encostar não é
conflito: 14:00–15:00 e 15:00–16:00 convivem.

## Horários livres: o agente só oferece o que está vago

O expediente no prompt diz quando atendemos, **não o que está livre**. Sem mais
nada, o agente sugeria um horário já ocupado, o contato aceitava e só então
`schedule_meeting` recusava — e o agente voltava atrás pedindo outra data.

- `listFreeSlots(tenantId, cfg, date)` (repository) devolve os inícios livres de
  um dia local pelas **mesmas regras da gravação**: dia atendido, expediente,
  pausas, antecedência (`>=`, igual à recusa de `schedule_meeting`) e conflito na
  nossa base e no Clinicorp (`listClinicorpBusyBlocks`, uma chamada por dia).
  A integração nunca lança: devolve `null` se não conseguiu conferir. O repository
  converte isso em `AvailabilityUnavailableError`; a tela mostra o erro e o agente
  encerra o turno sem oferecer ou confirmar novos horários. `[]` significa uma
  agenda realmente vazia ou a consulta externa desabilitada.
- Candidatos: `slotStartTimes(cfg)` (grade da duração, recomeçada no fim de cada
  pausa) mais o fim de cada compromisso ocupado, para um encaixe fora da grade
  não sumir.
- Tool `list_available_slots` (`date` + `days` até 14 + `excludeDates` +
  `excludeWeekdays`), sempre exposta com o agendamento ligado. Sem uma data exata pedida pelo contato, ela
  pesquisa 14 dias por padrão e devolve até cinco dias com vaga, cada um com o
  expediente daquele dia e os horários realmente livres. Datas que o contato
  recusou entram em `excludeDates`; dias da semana recusados (como quinta e
  sexta) entram em `excludeWeekdays`. Nenhum deles volta nas opções; o prompt manda
  avançar para o próximo dia da grade em vez de insistir. A tool continua sendo
  obrigatória antes de sugerir ou aceitar qualquer horário.
- A recusa por conflito em `schedule_meeting` e `reschedule_meeting` já oferece
  alternativas conferidas (`offerAlternativeSlots`), para a segunda sugestão não ser outro
  chute. A lista é orientação: `hasConflictAnywhere` continua sendo a checagem
  final antes de gravar (alguém pode marcar entre a consulta e a confirmação).

## Clinicorp

Sistema de gestão de clínicas. Documentação: `https://api.clinicorp.com/api-docs/`
(o spec real está embutido em `swagger-ui-init.js`, não em `swagger.json` — esse
devolve o HTML do Swagger UI).

**Autenticação: HTTP Basic, não OAuth.** Usuário = "Usuário API", senha = "Token
API", ambos gerados pela clínica em *Gerenciar Assinatura › Acesso Externo e
Integrações*. Por isso a pessoa cola as credenciais na tela (`ClinicorpCard`) em
vez de passar por um consentimento — e por isso a tela precisa dizer onde achar
esses campos. As credenciais são **do cliente** e ficam em
`ClinicorpIntegration`, uma linha por tenant, nunca em env.

Base: `https://api.clinicorp.com/rest/v1`. Quase todo endpoint pede
`subscriber_id`.

### O que a integração faz

1. **Espelho** (`pushAppointmentToClinicorp`) — `POST /appointment/create_appointment_by_api`.
   O id que volta é gravado em `Appointment.clinicorpAppointmentId`. Cancelar
   aqui chama `POST /appointment/cancel_appointment`.
2. **Disponibilidade** (`hasClinicorpConflict`) — `GET /appointment/list` do dia,
   com `includeAssigns` para trazer também eventos e bloqueios (almoço, férias):
   para o agente, esses horários são tão ocupados quanto uma consulta.
3. **Agenda na tela** (`listClinicorpAgenda`) — `GET /appointment/list` do mês
   aberto em `/agenda`, para a clínica ver ali também o que a recepção marcou
   no Clinicorp. Ver "Consultas do Clinicorp na /agenda" abaixo.

### Regras que não são óbvias

- **Ids são inteiros e ficam como `String` no banco.** O exemplo
  `4791226171916288` cabe no `Number` seguro do JS; nem todo inteiro de 64 bits
  cabe. O envio valida a faixa segura antes de converter, recusando ids fora
  dela em vez de arredondar e enviar para outra clínica/profissional/paciente.
- **A data vai como dia local, não instante UTC.** `fromTime`/`toTime` são hora
  local (`HH:mm`) e `date` é o dia local em ISO com `T00:00:00.000Z`. Mandar o
  instante UTC cru jogaria horários da manhã no Brasil para o dia anterior.
- **Telefone de contato e prontuário são coisas separadas** (19/10/2026).
  Consultas reais enviam `MobilePhone` do contato vinculado mesmo quando
  `patientName` difere de `Lead.name` (perfil curto x nome completo, ou outra
  pessoa marcando). A diferença de nomes impede apenas buscar/criar e vincular
  um prontuário pelo telefone (`Patient_PersonId`), nunca apaga o número da
  consulta. Não deduza identidade por nome parcial/apelido. O sandbox continua
  omitindo telefone sintético. A agenda mostra nome **e** telefone do contato.
  Não há migração nem reenvio de consultas já sincronizadas.
- **Chat de teste marca em todas as integrações**, como um contato real — é assim
  que o dono vê o fluxo inteiro. Só muda o paciente: o telefone do sandbox é
  sintético (`sandbox:<agente>`), então o envio vai **sem telefone**, vinculado
  ao cadastro exclusivo "TESTE fechai (chat de teste do agente)". A integração
  busca esse nome exato, cria se a ausência foi confirmada e relê o id antes de
  marcar. Busca ambígua ou falha interrompe o envio. Nunca usa os dígitos do id
  como telefone, o nome simulado como paciente real ou `IgnoreSameName` para
  criar outro cadastro de teste. A nota do horário identifica o teste em `Procedures`.
- **`IgnoreSameName: "X"` ao criar paciente.** Sem isso o Clinicorp recusa quando
  já existe alguém com o mesmo nome — e "João Silva" repetido é rotina numa base
  de pacientes. O telefone é o que de fato distingue, e ele já foi consultado
  antes (`GET /patient/get?Phone=`, que aceita qualquer formato; mandamos só
  dígitos com DDD, sem o código brasileiro `55`). A normalização remove esse
  prefixo apenas de números com 12–13 dígitos; um DDD 55 em um número nacional
  de 10–11 dígitos permanece. O telefone do contato no Fechai não é alterado.
- **Criar paciente não promete retornar `PatientId`.** O contrato de
  `/patient/create` mostra os dados do cadastro; se não vier ID, consulte
  `/patient/get` pelo mesmo telefone para obter `PatientId`, sem repetir a
  criação. Busca que falhou não autoriza criar outro paciente.
- **Procedimento e observações do agendamento vão em `Procedures`**, o campo
  documentado de `/appointment/create_appointment_by_api`; `Notes` continua
  sendo campo do cadastro de paciente. `serviceType` e `notes` da consulta
  seguem para esse campo também no reagendamento e na reposição do horário
  anterior. A instrução da tool pede registrar o procedimento/queixa informado
  mesmo quando o tipo de duração é apenas “avaliação”.
- **HTTP bem-sucedido sem confirmação nunca vira envio confirmado.** O painel
  preserva o motivo informado pela API ou avisa sobre corpo vazio. O console
  registra apenas código HTTP, estrutura da resposta e presença dos campos de
  paciente enviados, sem corpo, headers ou valores de dados pessoais. A fila
  automática relê a agenda sem cache antes de qualquer nova criação: reconhece
  a referência `[fechai:<id do envio>]` em Notes/Procedures, ou a identidade e
  o horário/profissional exatos. Leitura indisponível ou ambígua não permite POST.
- **Falha na consulta de disponibilidade devolve `null`.** Com a checagem
  habilitada, uma falha, credencial ilegível ou resposta incompleta não prova que
  o horário esteja livre. Nenhuma reserva nova é confirmada até conseguir
  conferir; consultas já combinadas são preservadas. Desligar a integração ou
  `checkAvailability` continua permitindo usar só a agenda local.
- **`syncEnabled` e `checkAvailability` são independentes.** Uma clínica pode
  querer só enviar, sem a leitura extra a cada horário oferecido.
- **Filtro por profissional só quando a conta fixou um** (`dentistId`). Com
  dentista definido, a agenda de um colega não bloqueia o horário; sem ele, o
  agendamento é da clínica e tudo conta.
- **`lastError`/`lastErrorAt`** existem para a tela avisar que a credencial
  venceu. Sem isso, um token expirado só apareceria quando a clínica reclamasse
  de um paciente que não chegou na agenda. **O erro gravado tem que se explicar
  sozinho**: `pushAppointmentToClinicorp` prefixa de quem é o agendamento e para
  quando ("Agendamento de Maria para seg., 14 de set., 16:30, salvo só no
  fechai."), o motivo diz o que fazer, e `clinicorpReason()` repassa o texto que
  o próprio Clinicorp escreveu (JSON `message`/`error`; página HTML é ignorada).
  O card mostra ainda "há 3 horas" (`lastErrorWhen`, formatado no servidor).
  Quem chama o push recebe só o motivo, sem o prefixo — já tem o contexto.

### Confirmação de envio e preferências

- `pushAppointmentToClinicorp` devolve `ClinicorpSyncResult`: `synced` com id,
  `failed` com motivo ou `skipped` quando desligado/sem conexão. HTTP 200 vazio,
  objeto de erro e resposta sem id válido **não são confirmação de criação**.
  Só uma criação confirmada atualiza `lastSyncAt` e limpa o erro de envio.
- `createAppointment` persiste `ClinicorpAppointmentSync` antes da chamada HTTP
  e tenta enviar imediatamente. Falhas temporárias ficam em `retry` com próxima
  tentativa em 2 min, sem limite de tentativas; o worker varre a cada 30 s e
  também recupera consultas futuras antigas sem id externo. Claim condicional,
  token e lease de 3 min protegem web/worker concorrentes e reinícios. Clínica e
  assinante ficam congelados no envio; trocar conexão não redireciona dados.
- A criação manual e o agente informam que o registro está sendo concluído
  automaticamente quando a fila foi persistida (`automatic: true`). A agenda
  mostra "Enviando ao Clinicorp" durante o processamento e "Clinicorp enviado"
  só com `clinicorpAppointmentId`. `replyOverride` impede confirmação falsa.
  Pedir confirmação novamente não cria outra reserva. A recuperação também
  reconhece uma consulta externa criada sem resposta ou antes de salvar o ID.
- Cancelar ou mudar o horário de uma tentativa incerta exige conferir e limpar
  seu possível registro antigo antes de encerrar o envio. Nunca recria consulta
  cancelada. Uma versão terminal pode ser substituída pela versão reagendada
  sem ID; um envio incerto nunca tem payload ou destino sobrescritos. Lembretes
  do fechai aguardam a fila concluir o envio. Conflito no retry cancela a reserva
  local e seu espelho Google; o contato pode escolher outro horário.
- Schema novo: `ClinicorpAppointmentSync`. Aplicar `prisma db push` e gerar o
  client na imagem usada por web e worker. O deploy aplica o schema antes da
  troca, e a imagem compartilha o mesmo client gerado entre os dois processos.
- A recusa explícita "horário ocupado" retorna `failed` com `reason: "conflict"`.
  Uma tentativa nova é cancelada localmente, sem promover o lead a agendado nem
  enviar ao Google. Ao reagendar, o horário original é reposto e seus espelhos
  são restaurados. Falha genérica do espelho continua preservando a consulta.
  **Conflito não transfere para humano.** `offerAlternativeSlots` consulta até
  três opções livres nos próximos 14 dias, com a duração do atendimento, e exclui
  o intervalo recusado mesmo se a leitura externa estiver desatualizada.
  `ToolContext.replyOverride` entrega essas opções diretamente e pede a escolha
  do contato antes de reservar outra. A conversa permanece com o agente.
  Regressões em `clinicorp.test.ts`, `agendamento-tools.test.ts` e
  `agente-desligado.test.ts`.
- O contato com telefone é obrigatório no formulário manual quando o envio ao
  Clinicorp está ativado; sem espelho continua opcional. O servidor também valida.
- Profissional, clínica e categoria são campos controlados no formulário. O
  envio usa `onSubmit` + `startTransition` + `useActionState`, sem `<form action>`:
  seu reset nativo altera até um select controlado sem disparar `onChange`.
  Uma lista que falhou ao
  carregar não apaga a opção salva, e o erro permite tentar carregar novamente.
- Os três são `SelectMenu` (`components/ui/select-menu.tsx`), **não o `<select>`
  nativo**: o menu nativo é pintado pelo sistema operacional e abre uma lista
  clara sobre este painel escuro, ignorando os tokens da marca — não há CSS que
  alcance aquele popup. Três consequências de trocar, todas já tratadas aqui:
  - **A opção vazia precisa existir na lista.** `SelectMenu` cai na primeira
    opção quando o valor atual não está entre elas (`Math.max(findIndex, 0)`),
    então sem um `{ value: "" }` explícito o botão mostraria a primeira clínica
    como se estivesse escolhida, e o envio falharia contradizendo a tela.
  - **A carga preguiçosa mudou de gatilho.** Profissionais e categorias são
    chamadas de rede feitas só quando a pessoa abre o menu; o `<select>` usava
    `onFocus`/`onMouseDown`, que o `SelectMenu` não expõe (o controle é um
    `<button>`). O disparo vive num `onPointerDownCapture` no wrapper, que
    acontece antes do clique que abre o menu.
  - **Não há validação nativa.** O `required` do `<select>` sumiu junto; quem
    recusa clínica vazia é `clinicorpSettingsSchema` no servidor, com mensagem
    exibida no `Alert` do formulário.
  - O rótulo é um `<p id>` + `labelledBy`, não o `<label>` do `Field`: aquele
    associa por `htmlFor` a um controle nativo, que o `SelectMenu` não é.
- Categorias vêm de `GET /appointment/list_categories`. Mantemos o nome na coluna
  existente e resolvemos o `CategoryId` antes de enviar, exigindo nome único.
  Categoria ausente ou duplicada gera aviso para corrigir no Clinicorp. Não há
  alteração de schema. **Categoria “Avaliação” é diferente de `Procedures`**
  (“Avaliação para aparelho”, por exemplo); este campo ainda não é configurado aqui.
- `getClinicorpStatus` é a leitura de metadados para as telas, passando pela
  decifragem sem expor as credenciais. “Credenciais salvas” não garante envio.
  “Testar conexão” consulta a clínica pela API, sem criar dados, sem atualizar
  `lastSyncAt` e sem apagar um erro anterior de criação.
- `readClinicorpReport` consulta status e agenda para o ROI mensal, usando as
  mesmas credenciais decifradas e `clinicorpEnabled`, com clínica selecionada.
  `integrationState` distingue configuração/ausência/desabilitação/credenciais
  ilegíveis de falha da consulta. Se a agenda falhar ou contiver ID inseguro,
  mantém os status válidos para conferência, mas retorna `available: false`
  e nenhuma presença. Erros mostram operação e HTTP, sem corpo externo. Sucesso
  no teste de conexão (`business/list`) não garante acesso a todos os endpoints.
  A leitura não grava resultado de envio nem limpa `lastError`.
  Regressões em `relatorio-mensal-clinicorp.test.ts` e
  `relatorio-mensal-clinicorp-ui.test.ts`.
- Regressões: `tests/clinicorp.test.ts` e `tests/clinicorp-actions.test.ts`, com
  API e banco simulados. Nenhum teste cria agendamentos na conta de um cliente.

### Tipos de atendimento: a API não tem duração

O botão "Trazer tipos do Clinicorp" (Agentes › Agendar horário › Durações por
tipo de atendimento) importa **só os nomes**. Isso não é economia de escopo — a
API não expõe duração por tipo, e vale conferir antes de tentar de novo:

| Endpoint | O que devolve | Duração? |
| --- | --- | --- |
| `/appointment/list_categories` | `id`, `Description`, `Color` | não |
| `/procedures/list` | `ProcedureName`, `ProcedureExpertiseName`, `PriceListId`, `Type` | não (é tabela de **preço**) |
| `/group/list_subscribers_clinics` | `SlotTime` | sim, mas **da clínica inteira** ("se o slot for 30, este é o tempo de consulta da clinica"), não por tipo |

Por isso cada linha importada nasce com o campo de minutos **em branco**, e o
`required` do input mais o `superRefine` de `saveScheduleConfigAction` (mensagem
com o nome do tipo) obrigam a preencher antes de salvar. Preencher com um chute
— a duração padrão, ou o `SlotTime` — faria a tela afirmar um dado que a clínica
nunca informou, e ninguém revisa um campo que já parece respondido.

Outras regras do botão:

- **Só aparece com `clinicorpEnabled` E credencial salva** (`getClinicorpStatus`
  devolve `null` sem credencial). Para as outras contas seria um botão que só
  sabe dizer "não está conectado". Esconder não é autorização: a action confere
  a flag de novo no servidor.
- **Importar não sobrescreve.** Quem já ajustou "Limpeza" para 30 min não perde
  isso ao clicar; a comparação é por `normalizeDurationLabel`, e só o que falta
  é acrescentado. Nome repetido no Clinicorp entra uma vez só — duas linhas com
  o mesmo nome fariam `validateDurations` recusar o formulário inteiro depois.
- **Falha nunca trava o formulário**: erro de rede ou credencial vira aviso na
  própria seção e o resto da configuração continua salvável à mão.
- Regressões: `tests/clinicorp-actions.test.ts`.

### Estendendo

Endpoints úteis ainda não usados: `/appointment/change_status` (marcar
comparecimento aqui refletir lá; `/appointment/status_list` já é lido pelo
relatório mensal),
`/business/list_available_times` (oferecer os slots reais da clínica em vez de
derivar do expediente configurado no fechai).

Para a duração por tipo (que a API não informa, ver acima), o único caminho
seria **deduzir do histórico**: ler `/appointment/list` de semanas passadas e
tirar a duração média real por categoria. Daria nome *e* tempo de verdade, mas
depende de haver histórico, são várias chamadas e leva segundos — foi avaliado e
deixado de fora do botão de importar, que é síncrono.

### Consultas do Clinicorp na /agenda

A `/agenda` mostra também as consultas marcadas **direto no Clinicorp**, lidas
do mês aberto (uma chamada a `/appointment/list` com `from`/`to` do mês, mais
`/professional/list_all_professionals` para dar nome ao profissional; as duas
com cache — ver abaixo). Antes a tela lia só o nosso banco, e a clínica via
dias vazios que estavam cheios lá. Decisões e alternativas descartadas:
[ADR-005](../../../docs/decisions/ADR-005-agenda-clinicorp.md).

- **Só leitura, nada é importado.** A consulta não vira `Appointment`: não
  entra em relatório nem na cota, não tem ações nem override de lembrete, e
  não existe regra de quem vence numa divergência — o Clinicorp continua dono
  do que foi marcado nele. Por isso o card não tem Lembretes/Concluir/Cancelar
  e diz "para alterar, use o Clinicorp". Os lembretes chegam a esses pacientes
  por um caminho próprio (ver "Lembretes das consultas do Clinicorp"). Importar
  de verdade exigiria sincronização, deduplicação e essa regra — continua
  sendo decisão em aberto.
- **O que o fechai espelhou aparece uma vez só**, como o nosso compromisso: a
  tela descarta a linha do Clinicorp cujo `id` está em
  `Appointment.clinicorpAppointmentId` de algum compromisso do mês.
- **Consultas ativas e canceladas**: sem `includeAssigns` (almoço e bloqueio
  não são consultas), com `includeCanceled=X`. Desmarcadas permanecem visíveis
  com indicação de cancelamento; excluídas não são exibidas. Lembretes e
  disponibilidade continuam usando somente as consultas ativas.
- **A clínica inteira, mesmo com `dentistId`.** O filtro por profissional
  existe para a disponibilidade do agente; na tela a pessoa quer ver a agenda
  que tem lá.
- **O dia de cada linha** (`agendaDay`): numa consulta de um dia só o dia é o
  da consulta, mas num mês cada linha diz o seu. `AtomicDate` (YYYYMMDD) vem
  primeiro; depois `date`, que chega como dia local à meia-noite UTC (o formato
  que o próprio fechai envia, lido pela parte da data) ou como instante
  (convertido para o fuso da agenda). O horário vem de `fromTime`/`toTime`,
  locais como em `fetchBusyBlocks`. `toTime` ilegível não esconde a consulta: a
  tela mostra só o início.
- **Falha nunca some em silêncio.** Clinicorp fora do ar ou lento (teto de 6s,
  a página espera a leitura) vira aviso no topo dizendo que o calendário mostra
  só o que é do fechai; linha sem id, dia ou início legível é contada em
  `skipped` e a tela avisa quantas ficaram de fora. A leitura **não grava
  `lastError`**: desenhar a tela não é envio.
- Desabilitada, sem clínica escolhida ou com credencial ilegível: `off`, sem
  chamada nenhuma (o card de sincronização já explica cada caso).

- **Recebem lembrete, com regra própria de canal** — ver "Lembretes das
  consultas do Clinicorp" abaixo. A tela mostra "lembrete enviado" no card
  (`ClinicorpReminder.reminderSentAt`, casado pelo id **e** pelo horário).
- **Trocar de mês nunca espera o Clinicorp.** Quatro camadas, da mais para a
  menos frequente:
  1. **Prefetch completo de ‹ › e "Hoje"** (`CalendarMonth`): o mês vizinho
     já está no navegador (5 min, `staleTimes.static`), e o clique nem vai ao
     servidor. Os dias ficam com `prefetch={false}` — 30 renderizações por mês
     não compensam; o dia vem do cache do servidor.
  2. **Streaming** (`page.tsx`): a página sai com o que está no nosso banco, e
     calendário + dia são redesenhados quando a agenda de lá chega, num
     `<Suspense key={mês}>`. A chave do mês é obrigatória — sem ela a
     navegação é uma transição e o React segura a tela antiga até o Clinicorp
     responder. Enquanto chega, o calendário diz "buscando Clinicorp…" na
     linha do título (embaixo dele, sumir puxaria a grade) e o dia avisa que a
     lista pode crescer. Conta sem Clinicorp ativo não entra no streaming.
  3. **Meses vizinhos aquecidos no servidor**: `after()` chama
     `warmNeighborMonths` depois de cada resposta.
  4. **Cache servido enquanto é revalidado** (`AGENDA_CACHE_MS`, 30 min; falha
     10 s; profissionais 10 min), no `globalThis` para a página e a rota do
     pulso enxergarem o mesmo. Longo de propósito: quem garante que o dado
     não fica velho é o pulso, que relê o mês aberto com `fresh` a cada 15 s —
     e **na hora** quando a página chega com leitura antiga (`fetchedAt` →
     `dataAsOf` do `AgendaLiveRefresh`), seja do cache do servidor ou do
     prefetch do navegador. A conexão (flag, credencial, clínica) é conferida
     a cada chamada — desligar para na hora —, só a resposta de lá é
     reaproveitada, e a chave inclui assinante e clínica. Pedidos simultâneos
     do mesmo mês esperam a mesma chamada. Nova credencial e desconexão limpam
     o cache da conta (`clearClinicorpAgendaCache`).

  A página também busca o agente em paralelo com as demais consultas ao
  banco (antes era uma ida em série a mais por navegação).
- **"Tempo real" é releitura, não webhook.** O Clinicorp não avisa quando uma
  consulta é marcada (o único webhook da API é de upload de arquivo). A cada
  `LIVE_INTERVAL_MS` (15s), `AgendaLiveRefresh` (`(dashboard)/agenda/`)
  pergunta a `/api/agenda/pulso` a **versão** do mês (`readAgendaPulse`, em
  `agenda-pulse.ts`): relê o Clinicorp com `fresh` — o que reabastece o cache —
  e conta os compromissos do fechai (quantidade + último `updatedAt`, então o
  que o agente marcou no WhatsApp também entra). Só quando a versão difere da
  que a página desenhou é que ele chama `router.refresh()`, e a página refeita
  já acha o cache cheio. É uma **rota com `fetch` comum, não Server Action nem
  `router.refresh()` a cada volta**: os dois entram na fila do roteador, e o
  primeiro desenho (refresh a cada 15s) segurava os cliques enquanto o
  Clinicorp respondia. A versão sai de `agendaVersion` nos dois lados e ignora
  a ordem das consultas — se página e rota calculassem diferente, a tela se
  refaria em loop. Com a aba escondida nada é chamado; ao voltar, pergunta na
  hora. O botão "Atualizar" pergunta e sempre refaz. A volta automática **pula
  enquanto houver `<dialog>` aberto**: a lista do dia pode trocar de forma e
  levar junto o formulário que a pessoa estava preenchendo. Baixar o intervalo
  multiplica chamadas ao Clinicorp por aba aberta.
- Os links do calendário têm `prefetch={false}` (página dinâmica sem
  `loading.js`: o prefetch não adianta e gera requisição por casa) e o
  `LinkPendingHint` acende o dia clicado enquanto a página nova não chega.

Regressões: `tests/clinicorp.test.ts` ("agenda do Clinicorp na /agenda") e
`tests/agenda-pulse.test.ts`.

### Lembretes das consultas do Clinicorp

**Público dos lembretes:** `ScheduleConfig.reminderAudience` é `all` (legado)
ou `selected_types`, com nomes em `reminderTypes`. Em Agentes › Agendar horário,
"Somente os tipos escolhidos" permite, por exemplo, **só Avaliação**. A
lista aceita seleção múltipla e permite adicionar nomes. Ao escolher esse
público, `ReminderAudienceSettings` carrega automaticamente as categorias do
Clinicorp com `loadClinicorpReminderTypesAction`, sem o teto de 12 durações;
"Atualizar tipos" permite repetir a leitura se ela falhar ou o catálogo mudar.
As opções aparecem em ordem alfabética, para Avaliação não ficar escondida
depois das durações na lista curta do celular.
Carregar tipos não seleciona pacientes nem altera a duração de atendimentos;
a escolha passa a valer ao salvar a configuração.
`ReminderAudienceSettings.tsx` mantém a seleção ao recarregar as opções.
A comparação é exata, ignorando caixa e acento: Reavaliação não é Avaliação.
A escolha vale também para lembretes próprios de uma consulta, antes do envio.
No fechai, o tipo vem de `Appointment.serviceType`; tipos escolhidos para
lembretes podem ser registrados pelo agente mesmo sem duração própria.
No Clinicorp, usamos somente os metadados explícitos da consulta:
`CategoryId` resolvido por `/appointment/list_categories`, ou
`CategoryDescription` quando não há id. Sem tipo ou com id não resolvido,
a consulta fica **fora do envio**, sem consumir o disparo. Nunca classificar
por nome do paciente, `Notes`, procedimentos ou histórico da conversa.

O exemplo público de `/appointment/list` não garante metadados de categoria.
Antes de reativar lembretes restritos em produção, conferir se a resposta real
da clínica identifica os tipos. Os contadores `tipo_excluido` e
`tipo_desconhecido` no worker permitem acompanhar sem imprimir dados pessoais.
Formulário antigo preserva a seleção salva; público malformado nunca vira todos.

As consultas marcadas direto no Clinicorp recebem **os mesmos lembretes da
conta** (lista do agente principal, `reminderEnabled`), pelas mesmas regras de
tempo (`dueReminders`). Quem envia é
`workers/follow-up-worker/clinicorp-reminders.ts`, numa fila própria a cada
5 min — cada volta relê a agenda do Clinicorp com `fresh`, e a cada minuto
seriam 1.440 chamadas por dia por clínica.

**O canal é a regra que importa:** o paciente do Clinicorp quase sempre nunca
conversou com o número da clínica.

- **Meta (API oficial)**: sempre por **template aprovado**
  (`ScheduleConfig.metaReminderTemplate`, `meta-reminder.ts`), escolhido em
  Agentes › Agendar horário › Lembretes. Fora da janela de 24h a Meta só aceita
  template. Sem template escolhido, a conta não manda nada a esses pacientes.
  O template é **congelado** na config e conferido com a Meta ao salvar quando
  muda (`readMetaReminderTemplate`), como nos Disparos. `variables` diz o que
  vai em cada `{{n}}` (nome, data, hora, local); parâmetro vazio a Meta recusa,
  então `{{local}}` com o local em branco é recusado ao salvar, e paciente sem
  nome no Clinicorp fecha o disparo sem envio.
- **Evolution**: histórico anterior permite o lembrete no canal conhecido.
  Sem histórico, somente a opção explícita `clinicorpQrEnabled`, com categoria
  autorizada por ID e declaração da clínica (ver revisão de 09/10 abaixo).
- **Duas conexões**: preserva o canal conhecido. Contato da Meta não migra para
  QR; QR desconectado não migra para Meta. Sem canal, bloqueia com motivo.
  Resultado incerto nunca repete, independentemente do provedor.

Outras regras:

- **O que já saiu fica em `ClinicorpReminder`** (id do Clinicorp + `startsAt`),
  porque a consulta não é um `Appointment`. Remarcada lá (mesmo id, outro
  horário), os disparos voltam a valer. Linhas com mais de 90 dias são
  apagadas na própria varredura.
- **O que o fechai espelhou** (`Appointment.clinicorpAppointmentId`) é pulado:
  quem lembra é `scanAndSendReminders`, com override e tudo.
- **Envio pela Meta que falhou ou ficou incerto não é repetido** — fecha sem
  `reminderSentAt`. A Meta pode ter aceitado antes do erro (mesma regra do
  `unknown` dos Disparos). Pelo Evolution, a falha tenta de novo, como nos
  lembretes do fechai.
- **Telefone**: o Clinicorp guarda como a recepção digitou; 10–11 dígitos
  ganham o 55 (`clinicorpWhatsappPhone`) e o resto passa pela validação dos
  Disparos. Sem telefone válido, bloqueado ou "pediu para parar": fecha sem
  enviar.
- **A mensagem entra na conversa** (`role: "assistant"`, criada se preciso
  com `getOrCreateConversation`): é o contexto do agente quando o paciente
  responder. Mas a consulta não é nossa — cancelar/reagendar pelas tools do
  agente não alcança o Clinicorp; o agente conversa e a clínica ajusta lá.
- **Sem override por consulta** (o botão Lembretes da `/agenda` é só dos
  compromissos do fechai).

Schema novo: `ClinicorpReminder` — `db push` + `generate` nos dois processos.
Regressões: `tests/clinicorp-lembrete.test.ts`.


### Cancelamento preservado nas observações (07/10/2026)

`cancelAppointment` mantém ID e horário e acrescenta às observações a data/hora
no fuso da conta e a origem (agente/painel). Motivo só entra quando informado
explicitamente; nunca é exigido nem inferido. O texto anterior é preservado.
Status e observação são gravados juntos, com comparação das notas anteriores
para não sobrescrever uma edição concorrente; repetir não duplica o registro.

A agenda externa pede `includeCanceled=X` e mostra desmarcados (`Canceled=X`)
com identificação de cancelamento. Excluídos (`Deleted=X`) continuam separados
e não são reintroduzidos como cancelados. A versão do pulso inclui o estado de
cancelamento. **Exibição não é disponibilidade:** conflito continua ignorando
cancelados e o trabalhador externo também os exclui explicitamente dos
lembretes. O cancelamento externo invalida o cache de leitura.

**Limite da integração:** esta observação é persistida no Fechai. A API pública
consultada não oferece edição das observações de uma consulta já existente no
Clinicorp. O envio de cancelamento continua usando `cancel_appointment`; não
promete preservação na grade nativa do Clinicorp. Falha devolvida pela API é
comunicada ao painel/agente, sem afirmar conclusão externa. HTTP aceito não é
uma conferência da grade remota. A fila durável de criação não é uma fila de
cancelamento de consultas já sincronizadas.

Regressões: `agendamento-tools.test.ts`, `clinicorp.test.ts`,
`clinicorp-lembrete.test.ts` e `agenda-pulse.test.ts`.

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

### Aceite dos riscos da Evolution (09/10/2026)

Ao ligar a opção QR, `ClinicorpQrTermsDialog` apresenta termos sobre integração
não oficial, restrição/suspensão/bloqueio do número, limites das proteções e
alternativa pela API oficial. Exige checkbox e nome do responsável (3–120
caracteres, com letras). Cancelar, Esc ou fechar mantém a opção desligada. A
ativação só aparece após sucesso no servidor; erro fica inline no diálogo.

`saveScheduleConfigAction` valida checkbox/versão/nome e ownership, resolve
categorias e grava flag + `clinicorpQrRiskAcceptance` juntos no JSON da ação.
O registro contém nome normalizado, texto integral/versão dos termos e usuário
autenticado/data do servidor; ator/data não vêm do formulário.
`scheduling.qr_risk_accepted` acrescenta auditoria não reversível (best-effort);
a prova persistente é a configuração. Nenhuma migração de schema.

`parseScheduleConfig` só libera QR com prova íntegra da versão atual. Flags
antigas, declaração dos pacientes isolada e termos inválidos/antigos não
autorizam envio. Desligar preserva o registro; reativar exige novo aceite.
Aceitar não torna a Evolution oficial nem elimina risco de bloqueio.
Regressões: `qr-risk-terms.test.ts`, `weekly-availability-action.test.ts` e
`clinicorp-lembrete.test.ts`; UI isolada verifica cancelamento, validação, erro,
ativação após sucesso e telas desktop/mobile sem mensagens externas.
