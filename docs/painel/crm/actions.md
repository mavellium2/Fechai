# CRM nativo — Ações

## Autorização

As actions `moveCrmCard`, `createCrmLead`, `deleteCrmLead`, `saveCrmLead`, `sendCrmReply`, `saveCrmStage` e `saveCrmLossCatalog` começam por [`requireCrmSession()`](../../../src/modules/crm/access.ts): sessão do produto e permissão `crm:ver` em [`hasPermission`](../../../src/lib/permissions.ts). Sem a permissão, a guarda lança o `notFound` do Next e a action responde "Você não tem acesso ao CRM.". Conta e autor vêm sempre da sessão, nunca do formulário. Hoje só o papel `OWNER` tem a permissão; o SEG-05 acrescenta os demais papéis na mesma matriz.

## Liberação pelo superadmin

[`setTenantCrmEnabled(tenantId, enabled)`](../../../src/app/\(admin\)/actions.ts) usa a sessão real, exige `SUPERADMIN`, valida os argumentos e delega a [`setCrmEnabled`](../../../src/modules/crm/activation.ts). Uma mudança efetiva registra `admin.crm_access_changed` e revalida as páginas do CRM, do painel inicial e da administração. O evento de auditoria do toggle é informativo. O caminho para desligar ou religar é o controle em Contas.

## Ativação e nova tentativa

1. O serviço provisiona o pipeline e verifica as oito etapas de sistema ativas antes de registrar a tentativa em `crmActivationToken`.
2. Cada lote preenche somente leads elegíveis sem etapa. A gravação da atribuição e das transições acontece na mesma transação.
3. Antes de ligar `crmEnabled`, o serviço confere se a tentativa ainda está vigente, se a conta segue ativa e se todos os leads elegíveis têm etapa.

Uma nova tentativa substitui a anterior. Desativar retira o acesso e cancela um preparo em andamento. Lotes concluídos são preservados e uma nova solicitação retoma pelo que ainda está sem etapa. O serviço distingue `changed`, `unchanged`, `not_found`, `inactive` e `superseded`. Falhas são retornadas pela action com mensagem genérica para o painel.

## Escrita interna de etapa

[`setLeadStage(change)`](../../../src/modules/crm/lead-stage.ts) move um lead elegível e grava o histórico na mesma transação. Os retornos distinguem mudança, ausência de mudança, referência indisponível, exigência de motivo e conflito.

## Movimentação no Kanban

[`moveCrmCard`](../../../src/app/\(dashboard\)/crm/actions.ts) obtém conta e usuário da sessão e valida a etapa de origem e o destino. `setLeadStage` confere a flag e o pipeline padrão na transação e recusa uma etapa que mudou desde a leitura do quadro. Uma tentativa repetida para o mesmo destino mantém um único evento. Mover para Perdido exige um motivo disponível na conta e uma justificativa de até 500 caracteres. O histórico recebe `source: user`, o ator, a chave do motivo, o rótulo e a justificativa. `Lead.status` permanece com o valor do fluxo operacional. O quadro é revalidado após a gravação.

## Cadastrar e excluir lead pelo quadro

[`createCrmLead`](../../../src/app/\(dashboard\)/crm/actions.ts) valida nome opcional (até 80 caracteres), telefone e etapa, e chama [`createManualCrmLead`](../../../src/modules/crm/manual-leads.ts). O telefone é normalizado para E.164 (`55` + DDD + número) e recusado quando não dá para discar; a etapa precisa estar ativa no pipeline padrão da conta, e Perdido é recusado porque perda exige motivo e justificativa. A criação e a transição `lead_created_manual` acontecem na mesma transação, sob a trava de admissão compartilhada e a trava por telefone do atendimento — o mesmo caminho do webhook. Número já existente devolve `exists`: nada é duplicado e o lead **não** é movido de etapa; a tela avisa que ele já está na lista. O lead nasce `originChannel: "manual"`, sem conversa, sem mensagem e sem consumo de cota. Grava `lead.created` e revalida `/crm`, `/conversas`, `/contatos` e `/inicio`.

[`deleteCrmLead`](../../../src/app/\(dashboard\)/crm/actions.ts) chama [`deleteManualCrmLead`](../../../src/modules/crm/manual-leads.ts), que lê o lead por `realBoardLeads` (conta ativa, CRM ligado, `isTest: false`) dentro da transação com a trava compartilhada. **Só exclui lead sem histórico**: nenhuma mensagem na conversa e nenhum agendamento. Com qualquer um dos dois, o retorno é `has_history` e a action explica que o lead não pode ser excluído pelo quadro. A exclusão é definitiva e leva em cascata conversa, mensagens, transições, etiquetas, tarefas e origem de anúncio; o retrato do lead é registrado em `lead.deleted` (`recordDeletion`) e as mesmas páginas são revalidadas. Os dois diálogos usam `useActionToast` com `FormFeedback` inline, como o resto da ficha.

## Configuração de etapas

[`saveCrmStage`](../../../src/app/\(dashboard\)/crm/etapas/actions.ts) resolve o ator na sessão, verifica o acesso e valida o formulário. [`editCrmStages`](../../../src/modules/crm/stage-settings.ts) reconfere a conta ativa e a liberação dentro da transação. Aceita criar etapa personalizada, renomear, mover uma posição na ordem visual e arquivar etapas personalizadas. Nomes de etapas ativas são únicos sem distinção de maiúsculas. A renomeação e a ordenação conferem o estado de origem para recusar dados obsoletos.

O arquivamento com leads exige um destino ativo diferente no mesmo pipeline. Os leads elegíveis são movidos em lotes dentro da transação que arquiva a etapa, com um evento `stage_archived` por lead. A operação preserva `Lead.status`, `Lead.updatedAt` e os eventos anteriores. As duas páginas do CRM são revalidadas após o salvamento.

[`saveCrmLossCatalog`](../../../src/app/\(dashboard\)/crm/etapas/actions.ts) valida um catálogo de 1 a 20 motivos com até 80 caracteres por linha, deduplicados com normalização e sem distinção de caixa. A gravação usa a trava exclusiva da conta e a revisão lida no formulário. Mudança concorrente pede nova conferência. Perdido fica fora dos destinos de arquivamento, pois cada lead exige sua justificativa.

## Assumir e responder

[`claimCrmConversation`](../../../src/modules/crm/assignments.ts) deriva os dados do ator na action e reconfere usuário ativo no produto, conta e lead elegível. Uma atualização condicional assume só a conversa sem responsável. Atribui, pausa o agente e grava o evento na mesma transação. A etapa usa o gatilho `human_assumed` com o identificador do evento. Repetição pelo mesmo usuário é idempotente.

[`sendCrmReply`](../../../src/app/\(dashboard\)/crm/reply-actions.ts) passa ao `sendManualReply` a conversa, o lead e o ator. O envio valida entrada privada, bloqueio e pedido de parar, assume a conversa quando disponível e reconfere a prova de canal. Na Evolution confirma o número pareado imediatamente antes do envio. Na Meta valida o Phone Number ID e a janela de 24 horas. Em falha incerta o retorno orienta a conferir a conversa. A ação usa texto e o mesmo registro humano de Conversas.

## Transferir e devolver para a IA

O CRM-07 completa o atendimento pelo painel em [`handoff-panel.ts`](../../../src/modules/crm/handoff-panel.ts). As duas operações passam por `saveCrmLead` (`operation=transfer` e `operation=returnToAi`) e exigem `crm:ver`.

- **Transferir** (`transferCrmConversation`): a tela envia o responsável que mostrava (`expectedUserId`). A troca é um `updateMany` condicional a ele; se alguém mudou no meio, nada é gravado e a tela diz com quem está agora. Quem recebe precisa ser da equipe (dono com o produto ligado). Grava `ConversationAssignment` (`from` → `to`), deixa a espera como assumida pela pessoa nova e mantém o card em Em atendimento humano.
- **Devolver para a IA** (`returnConversationToAi`): despausa, tira "precisa de você" e o responsável, leva o card para a etapa da IA (`returned_to_ai`, a única volta de etapa automática, e só a partir de Aguardando humano ou Em atendimento humano) e marca a espera como `returned`. `returnToAiAndReply` responde a mensagem pendente; se falhar, a conversa volta a pedir a equipe. O Reativar agente de Conversas usa a mesma função.
- **Assumir fora do card** ([`assumeConversation`](../../../src/modules/crm/assignments.ts)): o botão Assumir conversa de Conversas, com ou sem CRM. Com o CRM ligado é o mesmo `claimCrmConversation` do card; sem CRM, a mesma atribuição condicional, sem quadro. Conversa de teste só pausa, sem responsável. Se outra pessoa assumiu segundos antes, a mensagem diz quem foi.
- **Responder pelo painel** (`sendManualReply` vindo de Conversas ou Contatos): depois do envio, quem respondeu assume se ninguém estava com a conversa. O card do CRM já assumia antes de enviar.
- **Transferir em Conversas** ([`transferConversation`](../../../src/app/\(dashboard\)/conversas/actions.ts)): a mesma `transferCrmConversation` do card, pela faixa "Com Fulana" no topo da conversa.

Cada passo responde no grupo do transbordo **citando o aviso original** (`messageId` do CRM-06): "✅ Fulana assumiu pelo Fechai" (assumir ou responder), "🔁 Transferido para Beltrano por Fulana", "✅ Fulana resolveu pelo Fechai" (Resolver em Conversas) e "↩️ Lead devolvido para a IA por Fulana". **O grupo só ouve sobre o atendimento de que foi avisado**: assumir, responder e resolver contam só quando fecham uma espera aberta; transferir, só com a espera mais recente aberta ou assumida; devolver, só quando havia uma. Reativar de novo uma conversa antiga, ou responder uma segunda vez, não reabre o assunto no grupo. Só cita o aviso da espera mais recente, e só se ele chegou ao grupo. O nome vem do cadastro, nunca o e-mail. `reflectHandoffInGroup` nunca lança.

## Fui eu

`saveCrmLead` com `operation=itWasMe` chama [`claimPhoneReplies`](../../../src/modules/crm/phone-reply.ts) (CRM-09): assume a conversa pelo mesmo `claimCrmConversation` (condicional; se outra pessoa já está com ela, a mensagem diz quem), atribui à pessoa as respostas pelo celular sem autor do atendimento atual e dá a ela a espera fechada pelo celular. Se a espera mudou, o grupo recebe "📱 Fulana respondeu pelo celular da clínica.".

## Prazos do transbordo

[`saveHandoffSlaSettings`](../../../src/app/\(dashboard\)/crm/transbordo/actions.ts) exige `crm:ver`, valida minutos inteiros de 1 a 10.080 (7 dias) e o escalonamento depois do alerta, e grava `HandoffSlaSettings` com quem alterou (`updatedById`). A devolução automática (CRM-12) vai no mesmo envio: desligada grava `autoReturnHours = null`; ligada exige horas inteiras de 1 a 168. Revalida `/crm` e `/crm/transbordo`.

## Trilha das ações

Mover o card (`setLeadStage`, origem `user`), aplicar ou remover etiqueta e criar ou concluir tarefa (`editCrmLead`, com a pessoa da sessão) gravam um evento na trilha (CRM-11) **só quando algo mudou** (etiqueta repetida ou tarefa já concluída não gravam). Assumir, transferir, devolver e as ações de Conversas gravam pelos módulos de transbordo. Ver [Trilha do CRM e do transbordo](domain.md#trilha-do-crm-e-do-transbordo).

## Etiquetas e tarefas

[`saveCrmLead`](../../../src/app/\(dashboard\)/crm/actions.ts) valida sessão, acesso ao produto, permissão `crm:ver`, operação e campos. [`editCrmLead`](../../../src/modules/crm/lead-detail-actions.ts) repete a elegibilidade dentro da transação com a trava de admissão compartilhada. Referências de etiqueta, tarefa e responsável são verificadas na conta. Criar e aplicar etiqueta usa a mesma transação. A conclusão condicional mantém o primeiro horário mesmo quando o formulário é repetido. Cada operação bem-sucedida revalida `/crm`. A ficha combina `useActionToast` com `FormFeedback` por usar um diálogo modal.

## Eventos de atendimento e agenda

[`moveLeadToStage`](../../../src/modules/crm/automatic-stage.ts) valida a conta e o lead ou os vínculos de conversa e consulta. Usa a trava de admissão compartilhada e serializa o cálculo por lead. A etapa e seu histórico são gravados juntos por [`writeLeadStage`](../../../src/modules/crm/lead-stage.ts). O serviço retorna `moved`, `ignored` ou `failed`. Em falha, registra diagnóstico sem interromper o fluxo de origem. O resultado pode ser conferido na próxima leitura de `/crm`.

| Origem | Gatilho no código |
| --- | --- |
| Motor do agente | `runAgentTurn` após persistir resposta real e ao encaminhar para a equipe por indisponibilidade. |
| Ferramentas do agente | `transferToHuman`, `disqualify_lead` e `record_lead_insight` após persistir um motivo conclusivo. |
| Conversas | `reopenConversation`, `setConversationAgentPaused` e `sendManualReply`. |
| WhatsApp | `processIncomingWhatsapp` usa reações do atendente e respostas manuais após excluir ecos, lembretes e pesquisa identificados pelo fluxo existente. |
| Agenda | `createAppointment`, `cancelAppointment` e `setAppointmentAttendance` após confirmação da escrita local. Conflito confirmado no Clinicorp interrompe a tentativa de marcação antes do evento. |

Quando a origem tem identificador estável, `LeadTransition.eventKey` guarda seu hash e tem unicidade por conta. `eventAt` registra a ocorrência. Repetições de movimentos aplicados e eventos anteriores à última decisão pela etapa atual são ignorados. Eventos sem identificador usam a etapa atual e a ordem temporal. A integração é síncrona e de melhor esforço, sem fila de repetição.
