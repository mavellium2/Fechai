# Conversas — Telas

## `/conversas`

- `ConversationList` mostra contato, última mensagem, agente atribuído e prioridade. `ConversationFilters` e `ConversationSearch` mantêm filtros na URL.
- `ConversationThread` mostra histórico, autoria, áudio, datas e cartão de satisfação. A resposta da equipe pelo celular da clínica aparece como "Fulana · pelo celular da clínica" ou "Não identificado · pelo celular da clínica" (CRM-09). A busca no histórico é local ao conteúdo carregado.
- `SendMessageForm` oferece texto, voz sintetizada quando disponível e áudio gravado. Na aba Testes, também é possível escrever como se fosse o contato.
- `ContactPanel` abre resumo, dados, variáveis, campanhas e próximo agendamento. Campos ausentes aparecem como **Não informado**.
- **Assumir conversa** faz a pessoa responsável e pausa o agente. Com alguém responsável, a faixa do topo mostra **Com Fulana** e o seletor **Transferir para**. Controles de resolver, reabrir e retomar (que devolve para a IA) ficam nas opções conforme a situação.

Desktop exibe lista, histórico e contato em colunas. No mobile, lista e histórico alternam e o contato abre como painel sobreposto.

[Mapa de componentes](../../../src/app/(dashboard)/conversas/README.md)
