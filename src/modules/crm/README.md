# CRM nativo

O CRM organiza os leads de cada conta em um pipeline e mostra os totais por etapa em `/crm`. Usa o Next.js da aplicação, o singleton Prisma 6 e o PostgreSQL do Fechai. O web e o worker compartilham o schema. Leia o [guia do CRM](../../../docs/painel/crm/_index.md) para localizar as telas, ações e próximos recortes.

## Arquivos e contratos

| Arquivo | Responsabilidade |
| --- | --- |
| [`prisma/schema.prisma`](../../../prisma/schema.prisma) | Flag e catálogo da conta, pipeline, etapa e origem do lead, transições, etiquetas, tarefas, atribuição de conversa e prova de entrada do WhatsApp. As chaves estrangeiras compostas escopam vínculos de CRM e eventos de atribuição à conta. |
| [`pipeline.ts`](./pipeline.ts) | `provisionDentalPipeline(tenantId)` cria ou reutiliza, em uma transação, o pipeline `default` e as oito etapas odontológicas. Retorna o pipeline. |
| [`lead-stage.ts`](./lead-stage.ts) e [`loss-reasons.ts`](./loss-reasons.ts) | Movimento e histórico em transação. Na perda manual, valida opção do catálogo e congela rótulo e justificativa. O catálogo tem revisão por conta. |
| [`activation.ts`](./activation.ts) | `setCrmEnabled(tenantId, enabled)` provisiona o pipeline, preenche o legado e publica ou suspende o acesso. O superadmin chama o serviço pelo controle em `/admin/contas`. |
| [`backfill.ts`](./backfill.ts) | Preenche leads sem etapa em lotes de até 200 por conta, preservando `Lead.status` e `Lead.updatedAt`. A atualização e o histórico do lote compartilham a transação. |
| [`admission.ts`](./admission.ts) | A etapa inicial e seu evento entram na mesma escrita de criação do lead. Usado na conversa ao vivo, recuperação de histórico e restauração de contato pela auditoria. |
| [`access.ts`](./access.ts) | Obtém a conta pela sessão, confere acesso ao produto, conta ativa e flag. A consulta da página retorna nomes e contagens por etapa ativa. |
| [`stage-settings.ts`](./stage-settings.ts) | Configura etapas em `/crm/etapas`. A transação usa a trava exclusiva da conta e grava a transferência com histórico ao arquivar uma etapa ocupada. |
| [`automatic-stage.ts`](./automatic-stage.ts) | `moveLeadToStage` valida a origem e a transição de eventos de atendimento e agenda. Grava etapa e histórico, sem lançar para o chamador. |
| [`board.ts`](./board.ts) e [`board-filters.ts`](./board-filters.ts) | Dados do Kanban, períodos, origem por anúncio, etiqueta, responsável, páginas por coluna e DTO com telefone truncado. |
| [`sla.ts`](./sla.ts) | Selo de espera da coluna Aguardando humano, calculado na leitura com os limites padrão do CRM-10. Não grava nem avisa. |
| [`team-whatsapp.ts`](./team-whatsapp.ts) | WhatsApp pessoal de quem é da equipe: código de confirmação, `confirmTeamWhatsappLink`, `resolveGroupMember` e `learnTeamMemberLid`. Número só vale confirmado e é único na conta pela forma canônica. |
| [`team-whatsapp-command.ts`](./team-whatsapp-command.ts) | `#vincular CÓDIGO` no webhook (só QR), antes de abrir conversa e antes de "ignorar grupos". Responde só no grupo: no privado, o eco da resposta viraria cadastro. |
| [`lead-detail.ts`](./lead-detail.ts) | Ficha de lead real com cursor de mensagens, etiquetas, tarefas, origem, responsável e linha do tempo. |
| [`lead-detail-actions.ts`](./lead-detail-actions.ts) | Mutações por conta de etiquetas e tarefas com revalidação de acesso na transação. |
| [`assignments.ts`](./assignments.ts) | Assunção condicional da conversa com histórico e gatilho de etapa. A operação pode ser reutilizada pelos próximos fluxos. |
| [`whatsapp-reply.ts`](./whatsapp-reply.ts) e [`inbound-proof.ts`](../whatsapp/inbound-proof.ts) | Comprovam o número para resposta manual na ficha. A action reutiliza o núcleo de Conversas e verifica bloqueio, pedido de parar, conexão e janela. |
| [`board-version.ts`](./board-version.ts) | Versão opaca da conta para o pulso de atualização do quadro. |
| [`manual-leads.ts`](./manual-leads.ts) | Cadastro manual de lead pelo quadro (`createManualCrmLead`) e exclusão com trava (`deleteManualCrmLead`). |
| [`limits.ts`](./limits.ts) | Limites de texto do CRM usados no servidor e nos formulários (justificativa, resposta, nome do cadastro manual). |

O provisionamento usa as restrições de unicidade do Postgres e `createMany({ skipDuplicates: true })` para deduplicar chamadas concorrentes. Reexecutar preserva nome, cor e ordem editados. O `kind` das etapas de sistema é a chave semântica imutável dentro do pipeline. `kind: null` representa uma etapa personalizada. `position` serve à apresentação. Etapas referenciadas pelo histórico são mantidas e podem ser arquivadas quando a configuração estiver disponível.

`setLeadStage` retorna `moved` ao gravar, `unchanged` quando a etapa já é a solicitada, `not_found` para referências que não pertencem à conta ou estão indisponíveis e `conflict` quando a leitura fica desatualizada antes da gravação. Usa atualização condicional pelo estágio e pela data lidos. A etapa precisa estar ativa e leads de sandbox são excluídos, inclusive quando só a conversa está marcada como teste. `Lead.status` e `Lead.updatedAt` pertencem aos fluxos operacionais, incluindo a captura do Bitrix24. A data da mudança no CRM vem de `LeadTransition.createdAt`.

## Histórico compartilhado com REL-06

`LeadTransition.dimension` determina os campos de antes/depois. `stage` usa `fromStageId` e `toStageId`. Na primeira atribuição, `fromStageId` é vazio. `status` usará `fromStatus` e `toStatus`, com os valores operacionais atuais. Cada linha leva `tenantId`, `leadId`, `source`, data e, quando houver evidência, `userId`. As fontes são `ai`, `system`, `user` e `group`. Na REL-06, `agent` corresponde a `ai` e `human` a `user` quando a origem é humana fora do grupo. Guarde o motivo como código de domínio quando aplicável. O histórico não carrega texto da conversa nem telefone.

A operação de etapa escreve a dimensão `stage`. A captura de `Lead.originChannel` já alimenta ficha e filtro. A REL-06 completa a instrumentação de `Lead.status`. O fluxo automático registra `eventAt` e, quando disponível, uma chave estável com hash em `eventKey`. Consulte a [matriz de transições](../../../docs/painel/crm/domain.md#movimento-automático) e os [gatilhos](../../../docs/painel/crm/actions.md#eventos-de-atendimento-e-agenda).

## Continuidade e operação

`crmEnabled` nasce desligado. Na ativação, o modelo e o token da tentativa são gravados antes dos lotes. A publicação confere se a solicitação ainda é a atual e se os leads elegíveis estão cobertos. O lock de admissão usa a conta e é compartilhado pelas criações e pelos lotes. Iniciar, publicar ou cancelar usa o lock exclusivo. CRM liberado ou em preparo com conta ativa recebe novos leads em `new`. Se uma conta com CRM liberado for suspensa, a página fica bloqueada e os leads que o atendimento ainda criar recebem a etapa para a futura reativação. Conversas e leads de teste ficam fora da contagem e do preenchimento.

O preenchimento usa o status atual do lead e a prioridade da conversa. Registra Atendimento IA somente com autoria do agente e entrada anterior do contato. Mensagens recuperadas e envios automáticos com ID registrado ficam fora. Desativar invalida a tentativa em andamento e preserva as etapas e o histórico. Uma nova tentativa continua pelas linhas sem etapa. O controle em modal usa toast e feedback inline. A exportação administrativa inclui pipeline, etapas, transições, etiquetas, tarefas e atribuições.

Toda action e rota do CRM chama `requireCrmSession()`, que exige `crm:ver` ([`src/lib/permissions.ts`](../../lib/permissions.ts)). O teste estático `tests/crm-permissao.test.ts` falha se uma action exportada não chamar a guarda. O SEG-05 amplia a matriz com os novos papéis.

Criação e movimentação de leads usam a trava compartilhada da conta. O arquivamento usa a trava exclusiva para impedir atribuições concorrentes à etapa. O Kanban em `/crm` tem paginação por coluna e filtros compartilháveis. Consulte o [guia funcional](../../../docs/painel/crm/telas.md) para os recursos que ainda dependem de outros cards.

## Cadastro e exclusão pelo quadro

`createManualCrmLead` cria o lead já na etapa escolhida, com `originChannel: "manual"` e a transição de entrada na mesma transação. Usa o mesmo par de travas do webhook (`withConversationContactLock`: admissão compartilhada + telefone), então um número que já existe na conta não nasce de novo nem muda de etapa — o retorno `exists` só informa o lead atual. Etapa perdida é recusada (`stage_unavailable`): Perdido exige motivo e justificativa, que só a movimentação pede. Não há conversa, mensagem, disparo nem consumo de cota.

`deleteManualCrmLead` apaga o lead (e, em cascata, conversa, mensagens, transições, etiquetas, tarefas e origem de anúncio) **somente sem histórico**: nenhuma mensagem na conversa e nenhum agendamento. Com qualquer um dos dois, o retorno é `has_history` e a tela explica a recusa — o botão existe para limpar cadastro manual e teste, nunca atendimento real. A leitura usa `realBoardLeads(tenantId)` (conta ativa, CRM ligado, `isTest: false`), então o quadro não exclui lead de teste nem de outra conta. O retrato do lead vai para a auditoria (`lead.deleted`) antes do `delete`.

Para mudanças no schema, usar o [laboratório isolado](../../../docs/plataforma/ambientes/ambiente-de-testes-admin.md) e seguir `db push` e `prisma generate` no web e no worker antes de implantar. Com o schema aplicado em um PostgreSQL local de teste, definir `CRM_TEST_DATABASE_URL` para a URL dessa base e rodar `npm test -- tests/crm-foundation.integration.test.ts tests/crm-transbordo.integration.test.ts`. O segundo arquivo cobre o filtro de responsável, o WhatsApp da equipe (índice único e LID), a espera de transbordo com a trava `FOR UPDATE`, assumir, transferir e devolver pelo painel (CRM-07) e o grupo de transbordo pelo caminho real do webhook (CRM-08). O teste requer uma base local identificada no nome por `test`, `teste`, `sandbox` ou `lab`, distinta de `DATABASE_URL`. Sem a variável, a suíte de integração fica desativada.

O [plano do CRM](../../../docs/plans/2026-11-23-crm-fechai.md) registra a ordem dos cards e os próximos passos.
