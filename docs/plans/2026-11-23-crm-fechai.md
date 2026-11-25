# CRM do Fechai

Plano de implementação e continuidade · atualizado em 24/11/2026 · v0.8

## Primeira entrega

Começar pela fundação do **CRM-01**. Persistir pipeline e etapas, provisionar o modelo odontológico de forma idempotente e definir com **REL-06** o histórico compartilhado. Validar em banco de teste, com o CRM ainda fechado aos tenants. Depois vêm a ativação, o preenchimento de leads existentes e a configuração visual das etapas. O CRM-01 permanece aberto até cumprir o aceite completo.

O **CRM-09** parece o menor card completo pelo reaproveitamento da detecção de resposta humana no WhatsApp. Ele depende de CRM-02 e CRM-07, e a autoria por pessoa depende de SEG-08. CRM-07 também exige CRM-06 e SEG-11. O CRM-01 é o único card de CRM sem pré-requisito formal. A estimativa é relativa, pela quantidade de fluxos e integrações, pois o Operum não registra uma estimativa de esforço nesses cards.

O CRM organiza o acompanhamento comercial na clínica. Cada card representa um `Lead` do Fechai, com etapa atual, trilha de movimentações e acesso ao atendimento. A agenda continua sendo a fonte de agendamentos e comparecimento. O CRM nativo terá rota `/crm`. A aba de CRM em `/integracoes` é a integração com o Bitrix24.

## O que já existe no repositório

| Parte | Referência e uso no CRM |
| --- | --- |
| Identidade e atendimento | [`Lead` e `Conversation`](../../prisma/schema.prisma). `Conversation.leadId` é único. Use `Lead.id` no card, com escopo de `tenantId`. Há leads legados sem conversa. [`getOrCreateConversation`](../../src/modules/agent-engine/conversation.ts) já reaproveita contatos por telefone em cada conta. |
| Contatos e Conversas | [`/contatos`](../../src/app/(dashboard)/contatos/page.tsx) já lista e busca leads reais. [`/conversas`](../../src/app/(dashboard)/conversas/README.md) já tem painel de contato, histórico, resposta manual e navegação por `?id=`. Reutilizar esses fluxos na abertura do lead. |
| Acesso e liberação | [`require-product.ts`](../../src/lib/require-product.ts) dá o acesso atual ao produto. [`broadcasts/access.ts`](../../src/modules/broadcasts/access.ts) verifica conta ativa e flag. Os controles de `/admin/contas` chamam as [ações auditadas do superadmin](../../src/app/(admin)/actions.ts). Navegação em [`(dashboard)/layout.tsx`](../../src/app/(dashboard)/layout.tsx). |
| Sinais operacionais | [`agent-engine`](../../src/modules/agent-engine/README.md), [`process-incoming.ts`](../../src/modules/whatsapp/process-incoming.ts) e [`scheduling`](../../src/modules/scheduling/README.md) concentram atendimento, transbordo e agenda. `Lead.status` atende fluxos legados e permanece como dimensão própria. |
| Origem e contexto | [`lead-insights`](../../src/modules/lead-insights/README.md), [`broadcasts`](../../src/modules/broadcasts/README.md) e `LeadAdOrigin` registram evidências que podem ser lidas pelo CRM. `Conversation.whatsappProvider` representa o canal da conversa e pode mudar. |

## Contratos propostos

### Pipeline, etapas e histórico

- `Pipeline` pertence ao `Tenant` atual. A primeira versão tem um pipeline padrão por conta. Definir uma chave estável com unicidade no banco para que chamadas concorrentes criem um único pipeline padrão. Deixar filiais e múltiplos pipelines para depois de SEG-01 e SEG-07.
- `PipelineStage` tem `pipelineId`, `kind`, nome, ordem e cor. O modelo inicial é Novo lead (`new`), Atendimento IA (`ai`), Aguardando humano (`waiting_human`), Em atendimento humano (`human`), Agendado (`scheduled`), Compareceu (`attended`), Fechado (`won`) e Perdido (`lost`). Cada `kind` de sistema é único dentro do pipeline e usa uma chave imutável. Pode haver várias etapas `custom`. A ordem visual é editável. A regra de avanço da automação usa os tipos e suas transições permitidas.
- `Lead.stageId` começa anulável para contas fechadas, períodos de implantação e linhas legadas. A escrita verifica que o lead e a etapa pertencem à mesma conta e que a etapa aceita movimento. Arquivar etapa personalizada com cards exige um destino explícito. Etapas de sistema permanecem disponíveis.
- Usar **uma tabela** de histórico para CRM-01 e REL-06. Cada evento registra `tenantId`, `leadId`, data, fonte e autor quando conhecido, com campos de antes/depois conforme a dimensão `stage` ou `status`. Usar `ai | system | user | group` como vocabulário comum, com mapeamento dos nomes `agent` e `human` usados na REL-06. Status `warm` e `hot` continuam representáveis. Preservar o histórico quando uma etapa mudar de nome ou for arquivada. Motivo estruturado quando aplicável.
- Uma mudança de etapa grava estado e histórico na mesma transação, com atualização condicional para concorrência. Um movimento para a etapa atual gera zero novas linhas. Para eventos que podem ser reenviados, definir no CRM-02 uma chave estável que impeça repetir um movimento mesmo depois de outra troca de etapa. Registrar o preenchimento inicial como evento de sistema na data da execução, com etapa anterior vazia. Em automações futuras, o chamador trata falhas e registra diagnóstico sem interromper atendimento, webhook ou agenda.
- `Tenant.crmEnabled` começa desligado. O superadmin controla a flag. Nas rotas e em cada ação do CRM, resolver o tenant pela sessão, aplicar o acesso ao produto, verificar conta ativa e flag. Sem liberação, a rota responde como inexistente. Acrescentar permissões específicas de CRM quando SEG-05 estiver disponível. Desligar preserva pipeline, etapas, cards e histórico. O histórico operacional da REL-06 tem escopo próprio.

### Preenchimento inicial, origens e automações

1. Aplicar a precedência que o CRM-01 lista para leads reais sem etapa: `scheduled` → Agendado, `lost` → Perdido, `needsHuman` → Aguardando humano, resposta real da IA confirmada → Atendimento IA, demais → Novo lead. Um lead sem conversa usa o status disponível. Conversas e leads de sandbox ficam fora.
2. Para saber se a IA respondeu, usar autoria e finalidade da mensagem, com entrada anterior do contato como evidência. Consultar [`contact-context-events.ts`](../../src/modules/reports/contact-context-events.ts) e [`contact-activity.ts`](../../src/modules/reports/contact-activity.ts) para excluir envios automáticos pelo ID e lidar com legados. Mensagens inconclusivas seguem a regra de Novo lead quando nenhuma outra condição se aplica. Consulta passada e confirmação por si só não sustentam `attended`.
3. Rodar o preenchimento por conta em lotes estáveis por `Lead.id`. Atualizar só linhas ainda sem etapa, gravar o evento junto e retomar com segurança se houver interrupção. Medir uma base grande de teste e consultar existência de respostas em lote, sem carregar seus textos. Conciliar os leads criados entre o início da operação e a ativação. Antes de liberar, validar cobertura e garantir que novos leads reais entram ao menos em `new`, pelo caminho de criação existente, até os demais eventos do CRM-02.
4. REL-06 define `originChannel` na entrada comprovada (`whatsapp_qr`, `whatsapp_meta`, `widget`, `manual`, `broadcast`, `ad`). Origem desconhecida fica vazia. A atribuição de uma resposta a um disparo segue a janela de sete dias do módulo e é uma informação distinta da origem inicial do lead. Finalizar a escrita de status, a captura de origem e seus testes com REL-06.
5. CRM-02 conecta entrada, resposta da IA, transbordo, atendimento humano, agendamento, comparecimento e perda explícita. Proteger movimentos manuais e etapas finais contra eventos comuns ou atrasados. Documentar exceções de transição antes de ligar o hook, incluindo cancelamento a partir de `scheduled` e evento forte após etapa personalizada ou Fechado. A perda analítica dos relatórios após 72h sem resposta não implica perda explícita no CRM.

## Plano de execução do CRM-01

| Recorte | Entrega verificável |
| --- | --- |
| **1. Fundação** | Validar o contrato do histórico com REL-06. Adicionar estruturas, flag desligada e rotina que provisiona o modelo odontológico. Testar banco com duas contas, duas chamadas simultâneas e repetição depois de uma etapa renomeada. Exercitar escrita de etapa e histórico pela mesma unidade transacional. |
| **2. Ativação e base existente** | Integrar o controle em `/admin/contas`, preencher leads elegíveis em lotes e cobrir criação concorrente e novos leads. Testar desligar e religar preservando configurações. Validar a rota e as ações com uma segunda conta e IDs cruzados. |
| **3. Configuração de etapas** | Entregar tela protegida para renomear, reordenar, criar e arquivar etapas personalizadas. Testar lookup pelo `kind` após renomear, proteção das etapas de sistema e histórico. Conferir os critérios do card integral antes de marcá-lo concluído. |

**Limite do primeiro recorte.** Cobrir provisionamento e persistência no ambiente de teste. Kanban, arrastar, WhatsApp, automações de produção e atribuição de pessoas entram nas entregas seguintes. Manter a liberação fechada até passar o cenário de ativação completo.

**Aceite mínimo.** A conta começa desabilitada. Provisione a conta A duas vezes em paralelo e verifique um pipeline com oito etapas. Renomeie uma etapa e provisione novamente. A etapa conserva o nome novo e a mesma chave semântica. A conta B mantém dados independentes. Uma tentativa cruzada falha. Uma mudança válida gera um evento, um replay gera zero e uma falha ao gravar o histórico reverte a etapa. Conferir `Lead.status` e a integração Bitrix em regressão dirigida.

**Validação ao implementar.** Usar o [laboratório de banco isolado](../plataforma/ambientes/ambiente-de-testes-admin.md) (`npm run test:db:push` conforme a preparação do ambiente) e Vitest. Verificar o schema e o TypeScript (`npx prisma validate`, `npx tsc --noEmit`) e rodar os testes direcionados. Antes de implantar mudança de schema, seguir `db push` e `prisma generate` nos ambientes web e worker, com reinício conforme o runbook do projeto. Consultar o [README de relatórios](../../src/app/(dashboard)/relatorios/README.md) para o bloqueio de arquivos Prisma no Windows.

## Ordem dos cards no Operum

Os doze cards abaixo estavam no backlog do projeto **Fechai**, tenant **Mavellium**, em 23/11/2026. Use os códigos na busca do projeto. A coluna de dependências combina as declaradas nos cards com pré-requisitos de integração necessários para liberar a experiência completa.

| Card | Entrega | Dependência ou ponto de integração |
| --- | --- | --- |
| CRM-01 | Pipeline configurável, modelo odonto, histórico e add-on | Primeiro recorte. Histórico junto com REL-06, conforme comentário naquele card. |
| CRM-02 | Movimento automático por eventos do atendimento e da agenda | CRM-01. Definir precedência, proteção de movimento manual e comportamento em falha. |
| CRM-03 | Kanban `/crm`, filtros e movimento manual | CRM-01/02. Começar pelo quadro básico. Responsável, origem completa e SLA entram com SEG-11/CRM-07, REL-06 e CRM-10. |
| CRM-04 | Detalhe do lead, conversa, etiquetas, tarefas e motivo de perda | CRM-01. Reaproveitar Conversas. Origem completa, responsável e linha do tempo integram REL-06, CRM-07 e CRM-11. |
| CRM-05 | WhatsApp verificado da pessoa e vínculo por telefone/LID | SEG-03, desenho de membros SEG-01 e tela de equipe SEG-06. Pode avançar em paralelo após essa base. |
| CRM-06 | Aviso de transbordo v2 e vínculo com mensagem do grupo | CRM-01/02. Publicar link quando `/crm?lead=ID` tiver destino autorizado. Instruções de comandos saem junto com CRM-08. |
| CRM-07 | Assumir, transferir e devolver para IA pelo painel | SEG-11 e CRM-06. Um único fluxo condicional de atribuição. |
| CRM-08 | Assumir e devolver via grupo do WhatsApp | CRM-05/06/07. Restrito ao grupo configurado no Evolution. |
| CRM-09 | Resposta humana no celular ou WhatsApp Web atualiza a etapa | CRM-02/07 e SEG-08 para autoria. Compartilhar o hook de CRM-02. Número compartilhado sem evidência fica como humano não identificado. |
| CRM-10 | Tempo de espera, alertas e escalonamento | CRM-06 para dados, CRM-03/04 para os indicadores. |
| CRM-11 | Auditoria, linha do tempo e indicadores de atendimento | CRM-07 e eventos dos fluxos. Linha do tempo integra CRM-04. Tela de auditoria e imutabilidade dependem de SEG-10 e SEG-09. |
| CRM-12 | Retorno automático para a IA | CRM-07/09, e CRM-06 para avisos. Configuração desligada por padrão. |

**Sequência proposta.** Fundação CRM-01 + contrato REL-06 → completar CRM-01 → CRM-02 → CRM-03/04 básicos → CRM-06 → CRM-07 e então CRM-09. O bloco de membros e permissões (SEG-03/05/08/11) pode avançar em paralelo após o desenho de SEG-01. CRM-05 precede CRM-08, enquanto CRM-10 pode começar pelo worker quando o CRM-06 estiver pronto. Integrar trilha e indicadores com CRM-11. Liberar CRM-12 depois do CRM-09.

**Conexões com outros cards.** SEG-11 fornece o responsável e a operação condicional de atribuição usada no painel, no grupo e no celular. REL-06 fornece origem e histórico compartilhado para Relatórios e CRM. CMP-07 consome o pipeline depois de CMP-02 e CRM-01/03. CMP-02 e a auditoria automática do relatório mencionam CRM, mas pertencem aos fluxos de campanha e relatório.

No transbordo, preservar as regras de cada provedor. Evolution atende ao aviso de grupo interno. Meta funciona com transbordo no painel. O grupo recebe aviso para a equipe. A resposta ao paciente usa o canal registrado para a conversa. Avisos e comandos só entram nos recortes que os implementam. Rever a divergência do aceite do CRM-06, que fala em “transbordo de teste”: validar com fixture elegível em ambiente isolado e manter o sandbox fora de avisos e CRM.

## Continuidade para a próxima IA

1. Ler [`AGENTS.md`](../../AGENTS.md), este plano e os cards CRM-01 e REL-06, incluindo o comentário da REL-06. O mapa técnico foi conferido na revisão `c931806`. Conferir o diff atual e mudanças recentes dos cards antes de editar.
2. Ler o [guia do CRM](../painel/crm/_index.md) e validar o CRM-01 no ambiente de teste. Usar **Configurar etapas** para criar e mover uma etapa personalizada, renomear uma de sistema, arquivar com destino e conferir as contagens em `/crm`. Conferir uma segunda conta sem liberação e testar a primeira entrada após renomear a etapa `new`.
3. Validar o CRM-02 conforme a [matriz de transições](../painel/crm/domain.md#movimento-automático) e a ficha conforme os critérios do CRM-04. Quadro, etiquetas, origens e ficha estão implementados. Para o quadro, prosseguir com filtro de responsável, SLA e `crm:ver`. Na REL-06, completar a dimensão de status em `LeadTransition`. Antes de CRM-06/07/08/09, reler os READMEs de WhatsApp e do motor do agente e confirmar o tratamento de autoria incerta pelo celular.
4. Ao terminar um recorte, atualizar aqui o status, a revisão, os arquivos alterados, os testes executados e o próximo trabalho. Anotar decisões novas junto ao contrato que mudou, com referência ao card. Manter os critérios do card integral como referência do fechamento.

### Estado da implementação

O recorte 1 do CRM-01 implementa [`Pipeline`, `PipelineStage` e `LeadTransition`](../../prisma/schema.prisma), flag desligada por padrão, [`provisionDentalPipeline`](../../src/modules/crm/pipeline.ts) e [`setLeadStage`](../../src/modules/crm/lead-stage.ts). O mesmo `LeadTransition` recebe a dimensão `status` quando a REL-06 instrumentar os pontos de escrita.

O recorte 2 adiciona o controle em `/admin/contas`, o [preparo em lotes](../../src/modules/crm/activation.ts), a atribuição inicial na criação do lead e a visão de totais em `/crm`. A flag é publicada após confirmar a cobertura. A [exportação](../../src/modules/admin/tenant-export.ts) inclui as coleções do CRM.

O recorte 3 entrega [`/crm/etapas`](../../src/app/\(dashboard\)/crm/etapas/page.tsx) para renomear e reordenar etapas e para criar e arquivar etapas personalizadas. O [serviço de configuração](../../src/modules/crm/stage-settings.ts) mantém `kind` e histórico. Ao arquivar uma etapa ocupada, os leads elegíveis são transferidos em transação com o arquivamento. CRM-01 está pronto para teste de aceite.

No recorte 2, o Prisma validou o schema completo e gerou o cliente. TypeScript e lint direcionado passaram, assim como 2.885 testes da suíte padrão. Os [oito testes de integração](../../tests/crm-foundation.integration.test.ts) rodaram à parte em PostgreSQL 17 descartável. Eles cobrem a fundação, classificação do legado, ativação concorrente em uma base com 265 leads, cancelamento durante o preparo e reativação. A cópia usada no banco descartável omitiu a extensão pgvector e as colunas de vetores porque a instalação local não oferecia a extensão. O cliente usado nos testes veio do schema do repositório.

No recorte 3, passaram TypeScript, lint direcionado, 2.886 testes da suíte padrão e 11 testes de integração em PostgreSQL 17 descartável com a mesma limitação de pgvector. A integração cobre proteção das etapas de sistema, identidade `kind` após renomear, destino de arquivamento, histórico e concorrência com movimentações.

O CRM-02 implementa a [movimentação automática](../../src/modules/crm/automatic-stage.ts) após eventos do agente, WhatsApp, painel e agenda. A implantação requer `db push` e `prisma generate` no web e no worker para `LeadTransition.eventAt` e `eventKey`. No aceite, testar um lead novo até comparecimento, um cancelamento com e sem outra consulta futura, uma perda conclusiva e a proteção de Fechado. Confirmar exclusão do sandbox e que uma falha de projeção preserva o atendimento.

A validação do CRM-02 passou com 2.888 testes da suíte padrão e 15 de integração no PostgreSQL 17 descartável, sem pgvector. A suíte padrão inclui falhas simuladas no turno do agente e no webhook. Prisma, TypeScript e lint direcionado passaram. O card segue para teste de aceite.

O quadro inicial do CRM-03 lista leads reais em colunas de 20 cards, combina filtros na URL e permite movimentação por arraste e botão. Perdido exige confirmação com categoria. O destaque por origem usa dados de anúncio registrados. O quadro mostra uma coluna por vez no celular e `?lead=ID` abre o detalhe básico. A [documentação funcional](../painel/crm/telas.md) descreve o contrato e as dependências pendentes. O card segue em andamento para completar responsável, etiquetas, origens e SLA.

Para validar o quadro, abrir `/crm` em uma conta ativa, aplicar etapa e período, rolar uma coluna até carregar o próximo lote e compartilhar a URL. Conferir que a busca geral e a da coluna filtram ao digitar sem derrubar os outros filtros. Arrastar para outra etapa e conferir o evento `source: user`. Em 360 px, selecionar uma etapa, abrir um card e usar Mover para enviar a Perdido com motivo. Assegurar que o quadro não faça consultas com a aba oculta.

Na validação local, passaram 2.892 testes da suíte padrão e 17 de integração no PostgreSQL descartável sem pgvector. Com 5.000 leads fictícios, a leitura do quadro levou 196 ms no teste de integração. No Chromium, três aberturas com servidor aquecido levaram 1.352, 1.157 e 719 ms. Uma rodada com a suíte em paralelo levou 2.121 ms. Em 360 px, foi confirmada uma coluna visível sem rolagem horizontal da página, com detalhe e telefone mascarado. O teste de navegador confirmou arraste, mudança da versão do pulso, confirmação de perda e eventos com autoria e motivo.

O primeiro recorte de CRM-04 implementa a [ficha lateral](../painel/crm/telas.md#ficha-do-lead), a leitura paginada da conversa existente e o resumo, dados declarados do contato, perda registrada e movimentos de etapa. Etiquetas usam `Tag` e `LeadTag`, integram o filtro do CRM-03 e persistem por conta. `LeadTask` registra tarefas com prazo, responsável opcional e conclusão. A implantação segue o procedimento de schema do Fechai no web e no worker.

Passaram 2.914 testes da suíte padrão e 18 testes de integração em PostgreSQL 17 descartável, com a cópia de schema sem pgvector. Os testes verificam referências de outra conta, etiquetas duplicadas, tarefas concluídas, a página de 40 mensagens e a resposta atribuída a disparo. Um cenário adicional força a admissão a ter data maior que a decisão manual e confirma que um evento antigo continua descartado. A consulta de 5.000 leads levou 100 ms na rodada final de integração. Em Chromium com dados fictícios, foram conferidos painel lateral a 1.280 px e tela cheia a 360 px, paginação, criação e filtro de etiqueta, tarefa atribuída e concluída, lembrete e preservação dos filtros ao fechar. A ficha de teste não apresentou botão de envio.

O fechamento do CRM-04 adiciona `Tenant.crmLossReasons`, `Lead.originChannel`, prova de entrada em `Conversation` e atribuição canônica com `ConversationAssignment`. A perda manual guarda a justificativa e o rótulo da época. A resposta usa o núcleo já compartilhado em Conversas, com prova de mensagem privada do contato pelo número ativo. Primeiro contato oficial e retomada fora da janela passam pelos modelos aprovados da Meta em Disparos.

O aceite local passou em Chromium a 1.280 px e 360 px, com conta e provedor fictícios. Foram conferidos o histórico paginado, a linha do tempo, o responsável após responder, a falta de botão de resposta para quem nunca escreveu, a configuração do catálogo e a recusa de perda sem justificativa. Passaram 2.915 testes da suíte padrão, 21 de integração em PostgreSQL 17 descartável sem pgvector, TypeScript, ESLint direcionado e Prisma. O card segue para **Em teste** no Operum. Antes de instalar em outro ambiente, aplicar o schema e gerar o Prisma Client no web e no worker.

O CRM-04 usa o recorte de assunção pelo painel e de leitura de transbordos existentes para completar a ficha. Avançar em CRM-06 com o aviso e `HandoffNotice`, depois CRM-07 com transferência, devolução e mensagens citadas no grupo. Manter a mesma atribuição condicional para o grupo e para o celular. REL-06 completa o histórico de status operacional, SEG-11 amplia a atribuição à equipe e CRM-11 completa auditoria e indicadores.

### Identificadores para consulta no Operum

Projeto Fechai `cmt79lg3u000801o9mtscmwc6`. Cards CRM-01 `cmwedn4ed002o01t8hu1x7mba`, CRM-03 `cmwednn35002s01t8dfo0mov9`, CRM-04 `cmwednwo9002u01t8c78owh6l`, REL-06 `cmwed8pa1002201t8ysjoh0ny`, CRM-09 `cmwedp8ic003401t8sy77xkce` e SEG-11 `cmwecvk9m000v01t820lklcvj`.
