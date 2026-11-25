# CRM nativo — Histórico

## 2026-11-25 — Busca ao vivo e cabeçalho responsivo

As duas buscas do quadro passaram a filtrar enquanto se digita: `CrmLiveSearch` mantém o texto no cliente e, após 350 ms sem tecla, troca apenas `q` ou `q_<etapa>` com `router.replace`, preservando etapa, responsável, etiqueta, origem, período, datas e a outra busca. Usar `replace` evita uma entrada de histórico por letra; um texto digitado depois que uma busca saiu não é apagado pela resposta dela. A busca geral saiu de baixo dos filtros e foi para a linha do título **CRM**, dentro do mesmo grupo de controles. Esse grupo não quebra linha: a busca encolhe, os links viram ícone com rótulo acessível abaixo de `xl` e o botão **Filtros** vira ícone abaixo de `sm`, então não estoura a tela em 320 px. O painel de filtros aberto passou a uma coluna em telas estreitas, duas a partir de 400 px, quatro no `sm` e a faixa completa no `xl`, com `min-w-0` em todos os campos. Esses campos usam `type="text"` com `inputMode="search"` de propósito: com `type="search"`, Chromium e Edge desenhavam um x nativo ao lado do botão de limpar do produto, e apareciam dois. O wrapper `role="search"`, o rótulo e a tecla de busca do teclado continuam; só sobra o x acessível do componente.

## 2026-11-25 — Buscas no quadro e carregamento sob demanda

O paginador "1 de 5" de cada coluna saiu: o quadro agora carrega o próximo lote de 20 cards quando a lista chega ao fim, por cursor do último card já exibido, com a mesma ordenação e o mesmo DTO do primeiro lote. A leitura extra passa pela `loadMoreCrmCards`, que tira a conta da sessão, confere a etapa ativa e relê filtros e buscas no servidor; o pulso do quadro fica pausado enquanto o lote vem. Entrou a busca geral (`q`), que vale para todas as colunas, e a busca por coluna (`q_<etapa>`), que vale só para aquela etapa — as duas procuram nome ou telefone no banco, somam-se aos filtros e são preservadas nos links da ficha. Parâmetros `p_<etapa>` de URLs antigas são descartados.

## 2026-11-25 — Animação na linha do tempo do histórico

A aba **Histórico** da ficha do lead passou a usar a mesma animação da sequência de **Prazos do transbordo**: a linha se desenha de cima para baixo, os eventos entram em sequência e as bolinhas pulsam em onda. Como a ficha mostra até 20 eventos, a onda das bolinhas é mais curta para os últimos não ficarem parados; `prefers-reduced-motion` continua desligando todo o movimento.

## 2026-11-25 — Quadro com altura de tela, adicionar e excluir lead

O Kanban de `/crm` passou a ocupar a altura disponível no desktop: cada coluna rola só a lista de cards, com título, contador, paginador e o botão **Adicionar lead** fixos, e a página não rola mais — a barra de rolagem horizontal do quadro fica sempre à vista. As colunas têm largura flexível e o fundo do quadro pode ser arrastado com o mouse para andar de lado. Cada coluna ganhou **Adicionar lead** e cada card, **Excluir**. O cadastro manual entra na etapa escolhida sem iniciar conversa, não duplica número existente e não aceita Perdido (a perda exige motivo). A exclusão é definitiva e restrita a lead sem conversa e sem agendamento, com o retrato guardado em `lead.deleted`. O layout depende da nova classe `tenant-main-crm` (`pathname === "/crm"`), que libera a rolagem da página no celular. Para testar com dados variados, `scripts/crm-demo-leads.ts` cria até 8 cards por etapa (simula sem `--apply` e remove com `--remove`).

## 2026-11-25 — Deploy do schema do CRM

`prisma/manual/003-crm-tenant-id-unique.sql` cria os índices únicos `Lead (tenantId, id)` e `Conversation (tenantId, id)` antes do `db push` do `deploy.sh` (as tabelas já têm dados e o `db push` recusaria sem `--accept-data-loss`; `id` já é único, então não há duplicata). Ensaiado num banco temporário com o schema anterior e dados: 002, 003 e `db push` sem a flag terminam em sincronia, sem perder linhas. O CRM nasce desligado em todas as contas (`crmEnabled`).

## 2026-11-25 — Devolução automática para a IA

O CRM-12 devolve o lead para a IA quando a equipe passa N horas sem responder, desligado por padrão e configurado em `/crm/transbordo` (sugestão de 4 h, só no horário de atendimento se a clínica quiser, e opcionalmente também para quem já está em atendimento humano). A devolução é a mesma do painel, avisa o grupo citando o aviso e faz a próxima resposta da IA pedir desculpas pela demora. Fechado e Perdido nunca voltam, e uma resposta humana antes do prazo cancela. Schema novo: `HandoffSlaSettings.autoReturnHours`, `autoReturnBusinessHoursOnly`, `autoReturnHumanStage` e `HandoffNotice.returnedVia` (`db push` + `generate` no web e no worker).

## 2026-11-25 — Trilha e indicadores do transbordo

O CRM-11 grava na auditoria cada passo do CRM e do transbordo: pedido, assunção (painel, grupo ou celular), transferência, devolução para a IA, alertas de prazo, movimentos de etapa, etiquetas e tarefas. Um evento por ação, com ator, via e tempos, e nunca texto da conversa ou telefone completo. A linha do tempo da ficha lê esses eventos com o histórico de etapas, e `/crm/indicadores` mostra, por pessoa, assumidos, mediana até assumir e até a 1ª resposta e devolvidos para a IA. Schema novo: `HandoffNotice.firstReplyAt` (`db push` + `generate` no web e no worker).

## 2026-11-25 — Prazo do transbordo

O CRM-10 acompanha cada espera no worker, minuto a minuto. Passou do 1º prazo, o grupo recebe "⏰ Aguardando há 15 min" citando o aviso; passou do 2º, a espera é escalonada aos donos no painel e por e-mail. Os prazos são da conta (`/crm/transbordo`, padrão 15 e 60 min) e contam só o horário de atendimento cadastrado. O selo do quadro segue os mesmos prazos, e a ficha mostra o tempo até assumir e até a 1ª resposta humana. Schema novo: `HandoffSlaSettings`, `HandoffNotice.alertedAt`/`escalatedAt` (`db push` + `generate` no web e no worker).

## 2026-11-25 — Resposta pelo celular da clínica

O CRM-09 trata a equipe respondendo pelo celular ou pelo WhatsApp Web da clínica. A resposta pausa a IA, leva o card para Em atendimento humano, fecha a espera e fica com o responsável da conversa ou, sem ele, como humano não identificado. O grupo recebe "📱 Alguém respondeu pelo celular da clínica. Quem foi? Responda *assumo*", e a pessoa se identifica pelo **Fui eu** do card ou pelo "assumo" no grupo. Os ecos da IA, do lembrete, da pesquisa e dos avisos continuam fora. Schema novo: `Message.sentByUserId` e `Message.sentVia` (`db push` + `generate` no web e no worker).

## 2026-11-25 — Pendências do CRM-07

Assumir em Conversas passa a definir a responsável também sem o CRM, e responder pelo painel faz quem respondeu assumir. Conversas ganha a faixa "Com Fulana" com Transferir. Resolver avisa o grupo, e o grupo só ouve sobre o atendimento de que foi avisado: reativar ou responder de novo uma conversa antiga não reabre o assunto.

## 2026-11-25 — Grupo de transbordo lido pelo Fechai

O CRM-08 lê o grupo da equipe. Responder "assumo" ao aviso, ou reagir 👍 nele, faz a pessoa responsável pelo card. "#ia" devolve o lead para a IA. Só vale o que cita o aviso, e o primeiro a assumir vence. Quem não vinculou o WhatsApp também assume, como humano não identificado, e recebe o pedido para vincular. O aviso ganhou a linha com os comandos, e nada do grupo vira conversa ou resposta do agente, com "ignorar grupos" ligado ou não. Schema novo: `HandoffNotice.assumedByPhone` (`db push` + `generate` no web e no worker).

## 2026-11-25 — Assumir, transferir e devolver para a IA

O CRM-07 completa o atendimento pelo painel. O card ganha Transferir e Devolver para a IA, e o Assumir de Conversas passa a definir o responsável. Transferir só grava se o responsável não mudou no meio. Devolver tira o responsável, despausa a IA, leva o card para a etapa da IA e marca a espera como devolvida. Cada passo responde no grupo citando o aviso do transbordo.

## 2026-11-24 — Aviso de transbordo v2

O CRM-06 registra cada espera da equipe em `HandoffNotice`, com o id da mensagem enviada ao grupo. O aviso ganha origem, motivo e o link do card (`/crm?lead=ID`). Transbordo repetido com a espera aberta não avisa de novo, e a clínica escolhe se a IA pausa enquanto aguarda. Conta só com a Meta transborda no Fechai, sem grupo.

## 2026-11-24 — WhatsApp da equipe

O CRM-05 cria `TeamMemberWhatsapp`. Cada pessoa confirma o próprio WhatsApp em Configurações mandando `#vincular CÓDIGO` ao número da clínica. `resolveGroupMember` acha a pessoa pelo número ou pelo LID aprendido. É a base para o grupo de transbordo reconhecer quem assume (CRM-08).

## 2026-11-24 — Responsável, selo de espera e permissão no Kanban

O CRM-03 completa o quadro. O filtro de responsável (pessoa, sem responsável e humano não identificado) fica na URL e o card mostra quem atende. A coluna Aguardando humano ganha o selo de espera com os limites padrão do CRM-10 (15 e 60 min), com texto e cor. Tela, pulso e actions exigem `crm:ver`, primeira permissão do catálogo que o SEG-05 vai ampliar com novos papéis.

## 2026-11-24 — Ficha completa para teste de aceite

O CRM-04 completa a ficha com origem de entrada, responsável, histórico de atribuição e transbordo, resposta em texto pelo número comprovado e catálogo de motivos por conta. Mover para Perdido exige justificativa e congela o rótulo escolhido. O Kanban usa as mesmas origens da ficha. Transferência e devolução, avisos no grupo, histórico de status operacional e auditoria avançam nos respectivos cards.

## 2026-11-24 — Ficha do lead, etiquetas e tarefas

O primeiro recorte de CRM-04 entrega a ficha responsiva com dados declarados, histórico paginado, resumo da conversa, perdas registradas e movimentos comerciais recentes. Etiquetas podem ser geridas na ficha e filtradas no Kanban. Tarefas têm prazo, responsável opcional e conclusão, com lembrete no quadro. Resposta pelo WhatsApp, catálogo de motivos por conta, responsável pelo lead, origem completa e linha do tempo de atribuição e transbordo seguem no planejamento.

## 2026-11-24 — Quadro Kanban inicial

O CRM-03 entrega colunas paginadas, filtros combinados na URL, abertura do card, arraste e confirmação de perda. O quadro atualiza versões novas enquanto a aba está visível. Responsável, etiquetas, origens completas e SLA aguardam seus respectivos cards.

## 2026-11-24 — Movimentação automática de etapas

O CRM-02 registra as mudanças de etapa causadas por atendimento, transbordo, agenda e perda explícita. Protege decisões manuais, identifica repetição de eventos aplicados e preserva o fluxo de origem em caso de falha do CRM.

## 2026-11-24 — Configuração de etapas

O terceiro recorte do CRM-01 adiciona `/crm/etapas`, com criação, renomeação, ordenação e arquivamento de etapas personalizadas. Arquivar uma etapa com leads transfere os registros para o destino escolhido e grava as mudanças de etapa. As etapas de sistema permanecem disponíveis com o mesmo `kind`.

## 2026-11-24 — Ativação do CRM por conta

O segundo recorte do CRM-01 adiciona o controle do superadmin, a classificação dos leads existentes em lotes, a atribuição inicial dos novos leads e a leitura dos totais por etapa em `/crm`. O JSON administrativo passa a incluir as coleções do CRM. A configuração de etapas é o próximo recorte.

## 2026-11-23 — Guia por funcionalidade

Incluído o mapa de domínio, telas, consultas, ações e padrões desta área.
