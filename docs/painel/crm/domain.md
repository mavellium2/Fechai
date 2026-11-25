# CRM nativo — Domínio

Um `Pipeline` padrão de chave `default` pertence à conta. `PipelineStage.kind` identifica as etapas de sistema e `position` define a ordem de exibição. Etapas personalizadas usam `kind: null`. Consulte os vínculos compostos por conta no [schema Prisma](../../../prisma/schema.prisma).

| Tipo | Etapa do modelo odontológico |
| --- | --- |
| `new` | Novo lead |
| `ai` | Atendimento IA |
| `waiting_human` | Aguardando humano |
| `human` | Em atendimento humano |
| `scheduled` | Agendado |
| `attended` | Compareceu |
| `won` | Fechado |
| `lost` | Perdido |

`Lead.stageId` indica a etapa comercial. `Lead.status` e `Lead.updatedAt` são usados pelos fluxos operacionais da conta, inclusive o Bitrix24. A atribuição inicial altera a etapa e registra um `LeadTransition` com `dimension: stage`, `source: system` e a etapa anterior vazia. O evento guarda a data da atribuição. A dimensão `status` será escrita pela REL-06 quando os fluxos operacionais forem integrados ao histórico.

**Original do WhatsApp x o que vale.** `Lead.whatsappName` guarda o nome do perfil como o webhook mandou (só de contato, nunca de grupo nem do eco da clínica) e `Lead.phone` é a identidade no WhatsApp; nenhum dos dois é editado pela equipe. O que vale nas telas, nos avisos e para o agente é `Lead.name` e `Conversation.variables`. Editar pelo CRM ou por Contatos ([`editContactProfile`](../../../src/modules/crm/contact-profile.ts)) **trava** o valor: `Lead.nameEditedAt` para o nome e `Conversation.editedVariables` para cada variável. Travado, `register_lead`, `remember_variables`, o resumo e o webhook não sobrescrevem, e o prompt diz ao agente que o valor foi confirmado pela equipe. Só trava o que mudou. Em branco destrava: o nome volta ao do WhatsApp e a variável volta a ser preenchida pelo agente. O nome e o `{{nome}}` andam juntos; `{{numero}}` vem do telefone e não é editável. Contas antigas têm `whatsappName` nulo até o contato escrever de novo.

## Estados de acesso

- Desligado. `crmEnabled` nasce `false`. Um lead pode existir com `stageId` vazio.
- Preparando. `crmActivationToken` identifica a solicitação que pode publicar a flag. Os lotes preenchem leads elegíveis sem etapa. A tela fica indisponível até a publicação.
- Liberado. `crmEnabled` é `true` e o token de preparo é removido. A conta ativa com acesso ao produto pode abrir o CRM.

Desativar preserva o pipeline e as transições. Ao liberar novamente, o processo preenche os leads que ainda estão sem etapa. Leads com `Lead.isTest` ou `Conversation.isTest` ficam fora do preenchimento e da visão do CRM.

## Ficha do lead

- Cidade, procedimento e motivo informado pelo contato vêm do `ConversationInsight` da conversa vinculada na mesma conta. A leitura usa o que já foi registrado. Motivo comercial da equipe vem da transição para Perdido e desqualificação vem do lead.
- As variáveis vêm de `Conversation.variables` e das definições do agente da própria conta, e podem ser editadas no card (ver "Original do WhatsApp" abaixo). A resposta a disparo usa a atribuição já registrada em `BroadcastRecipient`. Ela tem a própria data e pode coexistir com a origem de anúncio do lead.
- `Lead.originChannel` é registrado na criação pelo canal que iniciou o cadastro. Valores possíveis são `whatsapp_qr`, `whatsapp_meta`, `widget`, `manual`, `broadcast` e `ad`. Relacionar um anúncio ou uma resposta de disparo depois da criação acrescenta evidência sem alterar o canal. O legado fica nulo, com exibição de anúncio quando já existe `LeadAdOrigin`.
- `Tenant.crmLossReasons` guarda o catálogo comercial. Uma lista vazia usa os motivos iniciais. A transição manual mantém a chave do motivo, o rótulo escolhido e `lossReasonNote` como fotografia da decisão. Motivos antigos continuam legíveis pela chave que foi gravada.
- `Conversation.assignedUserId` e `assignedAt` guardam o responsável e o horário. A ficha usa `ConversationAssignment` para mostrar a atribuição histórica e aproveita `ReportEvent` de transbordo. A exclusão do usuário libera a referência de responsável e preserva os eventos.
- No quadro, o responsável tem três estados, calculados na leitura: pessoa (há `assignedUserId` na conversa da conta), humano não identificado (sem pessoa e etapa de `kind: human`) e sem responsável (os demais, inclusive lead sem conversa). Os estados não se sobrepõem.
- A espera em Aguardando humano conta da última transição da dimensão `stage` para a etapa atual. Com menos de 15 min o selo é `ok`, de 15 a 59 min é `alert` e a partir de 60 min é `late`. Sem transição registrada fica `unknown`, sem prazo presumido. Nada disso é gravado.
- `Conversation.whatsappInboundAt` e `whatsappInbound` guardam a última entrada privada autenticada do WhatsApp. A prova vincula provedor, instância, remetente e destinatário verificado. A idade da entrada vem do horário do provedor para a Meta. Texto livre na ficha exige uma prova completa.
- `Tag` guarda nome e chave normalizada únicos por conta. `LeadTag` vincula etiqueta e lead usando chaves compostas que exigem a mesma conta. Remover do lead apaga o vínculo.
- `LeadTask` pertence ao lead e à conta por chave composta. Guarda texto, prazo em UTC, responsável opcional e data da primeira conclusão. A pessoa responsável pela tarefa precisa pertencer à conta e usar o produto. A remoção do usuário tira a atribuição da tarefa.

## Movimento automático

A ordem operacional parte de Novo lead e passa por Atendimento IA, Aguardando humano, Em atendimento humano, Agendado e Compareceu. Fechado e Perdido são etapas terminais. A ordem usa o `kind`; os nomes e a posição exibida são configuráveis.

| Evento | Etapa | Origem no histórico |
| --- | --- | --- |
| Criação de lead real | Novo lead | `system` |
| Primeira resposta da IA registrada pelo motor no fluxo real | Atendimento IA | `ai` |
| Transbordo explícito pelo agente, reação reconhecida ou retorno à fila pelo painel | Aguardando humano | `ai` ou `user` |
| Escalonamento por indisponibilidade do agente, configuração ou limite | Aguardando humano | `system` |
| Assumir pelo painel ou enviar uma resposta humana pelo painel ou WhatsApp pessoal da clínica | Em atendimento humano | `user` |
| Novo agendamento aceito | Agendado | `ai` ou `user` |
| Comparecimento explicitamente marcado na agenda do Fechai | Compareceu | `user` |
| Desqualificação registrada, escolha de outra clínica ou falta de interesse explicitamente registrada | Perdido | `ai` |
| Cancelamento confirmado do último agendamento futuro, se ainda em Agendado | Em atendimento humano se o agente está pausado para a conversa, senão Atendimento IA | `ai`, `user` ou `system` |

O fluxo avança por padrão. Um transbordo explícito ou novo agendamento pode tirar o lead de etapa personalizada ou Fechado. De Perdido, só um novo agendamento reabre o lead. Escalonamento por falha do sistema não reabre decisões manuais. Cancelamento preserva etapas mais avançadas e também mantém Agendado quando há outra consulta futura de pé.

Adiamento, silêncio, confirmação de presença, falta, desfazer comparecimento e consulta do Clinicorp de leitura não geram movimentações. Marcar comparecimento no Fechai de uma consulta local espelhada no Clinicorp usa a mesma regra local. A perda comercial do CRM não reclassifica a triagem ou as métricas de Relatórios.

## WhatsApp da equipe

[`team-whatsapp.ts`](../../../src/modules/crm/team-whatsapp.ts) liga quem escreve no grupo de transbordo ao usuário do Fechai (CRM-05).

- `TeamMemberWhatsapp` tem uma linha por pessoa na conta. Só o número **confirmado** identifica alguém: `phone` (dígitos com 55), `phoneKey` (`canonicalPhone`, sem 55 e sem o nono dígito, única na conta) e `verifiedAt`. Dois usuários da mesma conta nunca ficam com o mesmo número, e as duas grafias do mesmo celular colidem de propósito.
- O número digitado e ainda não confirmado fica em `pendingPhone`/`pendingKey`, com `codeHash` (SHA-256 de conta, usuário e código) e `codeExpiresAt` (15 min). O pendente não é único: digitar o número de outra pessoa não trava o dono dele. Trocar de número mantém o atual até o novo ser confirmado.
- A confirmação é a mensagem `#vincular CÓDIGO` vinda do próprio número pendente. No privado o número vem do remetente; no grupo, do participante (`groupSender.phone`). Evento de grupo só com `@lid` não prova o número e responde pedindo o código no privado. O código vale uma vez (atualização condicional no hash).
- `lid` é o identificador `@lid` do WhatsApp, único na conta. É aprendido quando o mesmo evento traz o LID e o número: no `#vincular` e em qualquer mensagem de grupo (`learnTeamMemberLid`). Se outra linha tinha o mesmo LID, ela o perde. Trocar de número começa sem LID.
- `resolveGroupMember(tenantId, phoneOrLid)` devolve `{ userId, name }` só para número confirmado de quem ainda usa o produto na conta. Aceita `...@lid`, `...@s.whatsapp.net` ou dígitos de telefone; LID precisa vir com o sufixo. Nunca lança. É a função que o CRM-08 usa para "assumo" e 👍 no grupo.

## Aviso de transbordo

[`handoff-notice.ts`](../../../src/modules/agent-engine/handoff-notice.ts) registra cada espera da equipe (CRM-06).

- `HandoffNotice` tem `tenantId`, `conversationId` (chave composta com a conta), `trigger` (`agent`, `reaction`, `unanswered`, `campaign`), `reason`, `groupId`, `messageId`, `sentAt`, `status` (`waiting`, `assumed`, `returned`, `expired`), `assignedUserId`, `assumedAt`, `assumedVia` (`group`, `panel`, `phone`), `assumedByPhone` (CRM-08), `closedAt` e `repeatCount`.
- Todo transbordo real abre uma espera, mesmo sem grupo: a conta só com a Meta tem o card em Aguardando humano e a espera registrada. Só uma espera fica `waiting` por conversa; um novo transbordo com ela aberta só soma `repeatCount` e guarda o motivo, sem novo aviso no grupo.
- `messageId` é o id que `sendGroupMessage` devolveu. É ele que liga uma resposta ou reação no grupo ao lead (CRM-08).
- A espera fecha em todo caminho que tira a conversa de "precisa de você": Assumir no CRM e resposta pelo painel (`assumed`, `panel`, com a pessoa), resposta pelo celular (`assumed`, `phone`), Resolver em Conversas (`assumed`, `panel`) e Reativar agente ou Devolver para a IA (`returned`, que também marca a última espera já assumida). Transferir muda a pessoa da espera assumida. `expired` fica para o CRM-12.
- O card vai para Aguardando humano pelo `moveLeadToStage` que o transbordo já chamava (CRM-02).

## Grupo de transbordo

[`handoff-group.ts`](../../../src/modules/crm/handoff-group.ts) lê o grupo da equipe (CRM-08), só pelo QR (Evolution).

- **Que grupo:** o escolhido na ação de transbordo de algum agente (`TenantAction.config.groupId`) ou um grupo que já recebeu aviso. Tudo o que chega dele para em `handleHandoffGroupEvent`, antes de "ignorar grupos": nada vira conversa, cadastro, mensagem ou turno, e o agente nunca responde no grupo. Nenhuma mensagem do grupo é gravada; só o efeito do comando.
- **Comandos:** só valem ligados a um aviso (`HandoffNotice.messageId`), pela citação (`quotedMessageId`) ou pelo alvo da reação (`reactionTargetId`). "assumo", "eu assumo", "eu", "pego", "eu pego" e "deixa comigo" (sem acento, maiúscula ou pontuação) e 👍 (qualquer tom de pele) assumem; "#ia" devolve. Sem citação, ou citando outra mensagem, é ignorado. O eco das nossas respostas (`fromMe`) também.
- **Quem assume:** `resolveGroupMember` pelo número e depois pelo LID (CRM-05). A pessoa vira responsável (`ConversationAssignment` com `via: "group"`), a IA pausa, o card vai para Em atendimento humano (fonte `group`) e a espera fica `assumed` com `assumedVia: group`. Quem não está vinculado também assume: a IA pausa e o card fica como humano não identificado; o número vai em `assumedByPhone`, a ficha mostra "Humano não identificado (final 1234)" e o grupo recebe o pedido para vincular o WhatsApp.
- **O primeiro vence:** a espera `waiting` é a trava (`updateMany` condicional), e a conversa só muda se o responsável lido não mudou; se alguém assumiu pelo painel no meio, tudo é desfeito. Os seguintes recebem "Este lead já está com Fulana" (ou "…por um número não vinculado (final 1234)").
- **"#ia":** a mesma devolução do painel (CRM-07, `returnToAiAndReply` com `via: "group"`), que já responde no grupo. Com o lead já com a IA, só avisa.
- **Respostas** saem citando o aviso, com o nome do cadastro e só o final do número de quem não está vinculado. Reentrega da Evolution não repete o comando (trava por id da mensagem) e cada número tem um limite de 20 comandos a cada 5 minutos. Nunca lança.

## Resposta pelo celular da clínica

[`phone-reply.ts`](../../../src/modules/crm/phone-reply.ts) trata a equipe respondendo pelo celular ou pelo WhatsApp Web da clínica (CRM-09): o eco `fromMe` que não é automação.

- O webhook grava a resposta com `Message.sentVia = "phone"`, pausa a IA, tira o "precisa de você", leva o card para Em atendimento humano e fecha a espera aberta como `assumed` pelo `phone`.
- **Autor:** o número é compartilhado, então a mensagem não diz quem digitou. Com responsável na conversa, a resposta fica com ele (`Message.sentByUserId`); sem, fica como **humano não identificado** (autor null).
- **Grupo:** só na resposta que encerrou a espera, citando o aviso: "📱 Alguém respondeu pelo celular da clínica. Quem foi? Responda *assumo*" (ou "📱 Fulana respondeu pelo celular da clínica." quando há responsável). As respostas seguintes não repetem.
- **Quem foi:** a pessoa se identifica pelo **Fui eu** do card (`claimPhoneReplies`) ou respondendo **assumo** ao aviso no grupo (CRM-08, que aceita a espera fechada pelo celular sem autor). Os dois assumem a conversa e ficam com as respostas pelo celular sem autor do **atendimento atual**: as que vieram depois da última resposta da IA. A espera ganha a pessoa (`identifyPhoneHandoff`). Número não vinculado que responde "assumo" só fica registrado em `assumedByPhone`.
- **Ecos não viram resposta humana** e não mudam a etapa: a resposta da IA (id gravado, ou o mesmo texto nos últimos 15 s), o lembrete (`ReminderDispatch.messageId`), a pesquisa de satisfação (`isSurveyOutbound`) e os avisos no grupo (eco de grupo, parado pelo grupo de transbordo). Teste para cada um em `tests/crm-transbordo.integration.test.ts`.

## Prazo do transbordo

[`handoff-sla.ts`](../../../src/modules/crm/handoff-sla.ts) acompanha cada espera aberta (CRM-10). Só contas com o CRM ligado; conversa de teste nunca entra.

- **Configuração** em `HandoffSlaSettings` (uma linha por conta, `parseHandoffSla` nunca lança): `alertMinutes` (padrão 15), `escalateMinutes` (padrão 60, sempre depois do alerta), `businessHoursOnly` (padrão ligado) e `escalateByEmail` (padrão ligado). Sem linha, valem os padrões.
- **Expediente:** com `businessHoursOnly`, o tempo só corre dentro do horário de atendimento cadastrado do agente principal (`schedule_meeting`, com dias bloqueados fora), por `businessMinutesBetween`. Sem horário cadastrado, corre o tempo todo. Um transbordo às 22h tem o 1º alerta às 8h15 do dia seguinte, não à meia-noite.
- **Varredura** a cada minuto no worker (fila `handoff-sla`, `scanHandoffSla`), sobre esperas `waiting` dos últimos 7 dias: passou do 1º prazo, o grupo recebe "⏰ Aguardando há 15 min" citando o aviso; passou do 2º, a espera é **escalonada**: aparece no painel (aviso no topo do quadro e "· escalonado" na ficha) e, ligado, os donos da conta recebem **um e-mail por volta** com o link de cada card, sem nome, telefone ou conversa do contato.
- **Um alerta por limite:** `HandoffNotice.alertedAt` e `escalatedAt` são marcados por `updateMany` condicional **antes** do envio. Falha no grupo ou no e-mail nunca repete. Esperas que passaram dos dois prazos de uma vez (worker parado) recebem os dois, em ordem.
- **Assumir para o relógio:** a espera deixa de ser `waiting` e a varredura não a vê mais. A ficha mostra quanto levou (`assumedAt − createdAt`) e a 1ª resposta humana depois do transbordo, a base dos indicadores do CRM-11.

## Trilha do CRM e do transbordo

[`trail.ts`](../../../src/modules/crm/trail.ts) grava na `AuditLog` (a mesma da auditoria) quem fez, por onde, quando e quanto tempo levou (CRM-11). Todo evento tem o **lead** como alvo (`targetType: "Lead"`) e grupo `crm` no catálogo ([`events.ts`](../../../src/modules/audit/events.ts)).

| Evento | Quando | Ator |
|---|---|---|
| `handoff.requested` | Espera nova aberta (`openHandoffNotice`) | Fechai, ou `PHONE` na reação do atendente |
| `handoff.assumed` | Assumir no painel, responder pelo painel ou resolver com espera aberta, "assumo"/👍 no grupo, resposta pelo celular que encerrou a espera | Pessoa (`OWNER`), `GROUP` ou `PHONE` |
| `handoff.transferred` | Transferir (card ou Conversas) | Pessoa |
| `handoff.returned_to_ai` | Devolver no painel, "#ia" no grupo, devolução automática (CRM-12) | Pessoa, `GROUP` ou Fechai |
| `handoff.sla_alerted` | Alerta (`level: alert`) e escalonamento (`level: escalated`) do prazo | Fechai |
| `crm.stage_changed` / `crm.lost_reason_set` | Mover o card à mão (perda leva o motivo do catálogo) | Pessoa |
| `crm.tag_changed` / `crm.task_changed` | Etiqueta aplicada ou removida, tarefa criada ou concluída | Pessoa |

- **Um evento por ação:** cada caminho grava uma vez. A resposta pelo painel só grava `handoff.assumed` quando ela mesma fechou a espera (se o Assumir já tinha fechado, não repete). Mover para Perdido grava só `crm.lost_reason_set`. Devolver sem nenhum atendimento humano em curso não grava.
- **Meta:** só ids, via (`panel`, `group`, `phone`, `auto`), ação (`claim`, `reply`, `resolve`, `identify`), tempos (`waitSeconds`, `waitedMinutes`) e rótulos (nome da etapa, da etiqueta, do motivo). **Nunca** texto de mensagem, motivo livre do transbordo, texto da tarefa ou justificativa da perda, nem telefone completo: quem assumiu pelo grupo sem estar vinculado aparece como `actorPhone: "•••• 1234"` (`maskPhone`).
- **Atores:** `OWNER` (pessoa da equipe pelo painel), `GROUP` (pelo grupo, com a pessoa de `resolveGroupMember` ou o número mascarado), `PHONE` (celular da clínica, com o responsável ou não identificado) e `SYSTEM` (o Fechai).
- Grava direto pelo Prisma, sem a sessão (os eventos nascem também no webhook e no worker), e **nunca lança**.
- **1ª resposta:** `HandoffNotice.firstReplyAt` guarda a primeira resposta humana (painel ou celular) depois do transbordo em curso, uma vez só (`markHandoffFirstReply`).

## Devolução automática para a IA

[`handoff-auto-return.ts`](../../../src/modules/crm/handoff-auto-return.ts) devolve o lead para a IA quando a equipe passou do prazo sem responder (CRM-12). **Desligada por padrão**: as contas não mudam de comportamento.

- **Configuração** na mesma `HandoffSlaSettings`: `autoReturnHours` (null = desligado; a tela sugere 4 h, até 168), `autoReturnBusinessHoursOnly` (conta só o horário de atendimento cadastrado) e `autoReturnHumanStage` (vale também para quem já está em atendimento humano).
- **Quando volta:** na mesma volta do worker do prazo (fila `handoff-sla`), só a espera mais recente de cada conversa conta.
  - Esperando (`waiting`): nenhuma resposta humana desde o transbordo, por N horas.
  - Em atendimento humano (`assumed`, só com a opção): a mensagem do contato mais antiga ainda sem resposta humana tem N horas. A IA respondendo enquanto isso (`whileWaiting: continue`) não conta como resposta humana.
  - Uma resposta humana antes do prazo cancela; o relógio só volta a contar da próxima mensagem do contato.
  - **Fechado e Perdido nunca voltam**, nem conversa de teste ou conta sem o CRM ligado.
- **O que acontece:** a mesma devolução do painel (`returnConversationToAi` com `via: "auto"`): IA despausada, sem "precisa de você" e sem responsável, card na etapa da IA e espera `returned` com `returnedVia: "auto"`, mais o evento `handoff.returned_to_ai` do Fechai na trilha. O grupo recebe "↩️ Sem resposta em N h — a IA voltou a atender", citando o aviso, **antes** de a IA responder a mensagem pendente (`replyPendingAfterReturn`; se ela falhar, a conversa volta a pedir a equipe com uma espera nova).
- **A IA retoma com contexto:** enquanto a IA não respondeu depois da devolução automática, o turno leva `AUTO_RETURN_INSTRUCTION` (`autoReturnTurnInstruction`): pedir desculpas pela demora em uma frase e retomar, sem prometer que a equipe vai responder. Some depois da primeira resposta da IA.
