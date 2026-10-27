# Conversas v1

Layout contínuo com lista (304px), histórico flexível e contato (300px), seguindo
a referência Precisa de você. O shell não acrescenta padding à rota. No mobile,
lista e histórico alternam; Sobre o contato abre como painel sobreposto.

- `page.tsx`: consultas sempre pelo tenant, filtro de situação/agente/nome/número,
  paginação 30–300, separação `isTest` e seleção por id. Contagens globais das abas
  são mantidas. Lê o próximo agendamento futuro do fechai pelo lead, sem prometer
  que espelhos externos foram consultados.
- `ConversationsWorkspace.tsx`: visibilidade do contato, busca no histórico visível
  (local, sem enviar texto para outra API) e foco no resultado.
- `ConversationFilters`, `ConversationSearch`, `ConversationList`: filtros na URL,
  urgentes primeiro, avatar, prévia e agente atribuído; exclusão de teste preservada.
- `ConversationThread`: contato à esquerda, agente/equipe à direita; áudio e texto
  na mesma mensagem; autoria recuperada, datas e cartão de satisfação preservados.
- `AssumeConversationButton`: chama `setConversationAgentPaused(id,true)` existente.
  Reativar, resolver, WhatsApp e demais ações continuam em Opções/Histórico.
- `ContactPanel`: resumo real, próximo agendamento, dados e histórico recolhível.
  Campos ausentes permanecem Não informado; não deduz motivo do handoff.
- `SendMessageForm`: mesmas actions de texto, voz e teste. A tela não oferece
  anexos genéricos porque ainda não existe envio desses arquivos neste composer.
- `Sandbox`: versão publicada, inspeção e comparação; contrato no README de Agentes.
- `loading.tsx`, `error.tsx`: carregamento e repetição sem expor detalhe técnico.

Nenhuma regra de envio/canal, pausa, retomada, resumo ou relatório foi trocada.
As páginas continuam protegidas por `requireProductAccess` e as actions checam
sessão/tenant. Temas claro/escuro usam tokens compartilhados.
