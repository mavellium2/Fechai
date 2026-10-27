# Agentes v7 no painel

A entrada `/agentes` segue a referência Entrada B: cards, busca local, criar,
importar, status real e último agente acessado. Dentro de um agente, a navegação
é por configurações (blocos ou lista), o formulário fica no centro e o resumo
salvo à direita. O teste substitui esse resumo por um painel de conversa.
As cores usam `--tenant-*`, com os temas e preferências anteriores preservados.

## Arquivos

- `AgentDirectory.tsx`, `page.tsx`: diretório e projeção dos dados no servidor.
  Não afirmar que todo agente ligado atende WhatsApp: isso depende de ser o principal.
- `AgentsFrame.tsx`: guard e contêiner; `getAgentsNavigation` reutiliza as consultas
  na renderização da página, sem cache persistente de layout.
- `[id]/AgentWizard.tsx`: navegação, limite das habilidades, resumo, formulário
  selecionado e teste lateral. `AgentHeader` mantém gestão, exportação e exclusão.
- `PersonaForm`, `RulesForm`, `VariablesSettings`, `ScheduleSettings`,
  `FollowUpSettings`, `HandoffSettings`, `BehaviorSettings`: mesmas actions;
  campos adicionais continuam disponíveis, alguns em detalhes expansíveis.
- `WeeklyAvailabilityGrid.tsx`: dias em colunas, horários em linhas; arrastar,
  teclado, pausas, 15/30/60 minutos e acesso às 24 horas preservados.
- `SaveBar.tsx`: retorno visual de pendências; `FormSaveBar` usa o mesmo snapshot
  do `UnsavedForm`, inclusive inputs ocultos dos seletores e switches.
- `KnowledgeWorkspace.tsx`: lista, abertura sob demanda, rascunho e publicação.
  `KnowledgeManager` mantém upload múltiplo, texto, falhas e repetição dos pendentes.
- `agents-v7.css`: layout v7; `agents-workspace.css` mantém componentes comuns.
- `../conversas/Sandbox.tsx`, `sandbox.css`: chat, inspeção e comparação.

## Rascunho de Conhecimento e teste

O rascunho vive na memória do navegador e é protegido pelo guard de alterações
não salvas. Recarregar/descartar o remove. Editar não muda a versão em atendimento.

`getDocumentContent` fornece texto, título e revisão SHA-256. O botão Aplicar ao
teste repete a última pergunta com o histórico anterior (até dez mensagens),
numa conversa separada, `isTest`, sem WhatsApp ou gravação na agenda. O documento
editado é substituído só na recuperação daquele teste, com embeddings temporários;
os outros documentos continuam elegíveis. Falha de embeddings interrompe o teste,
sem usar silenciosamente a versão antiga.

A inspeção mostra os trechos realmente enviados ao contexto, as instruções da
persona disponíveis e os nomes das tools executadas. Não é raciocínio interno
nem prova de que o modelo se apoiou em cada trecho. Sem fonte, a tela informa.

Publicar exige aplicar a revisão atual ao teste nesta interface. A action existente
`updateDocumentAction` recebe `baseRevision`; o servidor verifica a revisão e
`publishDocumentDraft` troca documento/trechos/vetores numa transação condicional.
A rede é usada antes da transação. Documento alterado concorrentemente é recusado;
falha de preparação não modifica o publicado. Auditoria/revalidação são mantidas.
A revisão evita reenviar o texto original inteiro no formulário. Limite do teste:
500 mil caracteres por documento e os limites de payload já existentes no salvar.
Não há nova tabela ou migração. O endpoint `/api/sandbox` foi ampliado.

A sessão de teste tem UUID próprio; reabrir a página não herda memória invisível.
O motor exige conversa de teste do tenant e `dryRunScheduling` para inspeção,
rascunho e histórico substituído. As três travas de teste continuam valendo:
sem cota de atendimento, responde com agente desligado, agenda apenas simulada.

## Decisões visuais e funcionamento

- Ações indisponíveis continuam Em breve; Triagem permanece utilizável.
- Os toggles de habilidade/comportamento e certas opções de voz/permissão
  mantêm o salvamento imediato existente. Não indicam um rascunho inexistente.
- Campos livres de tom e escrita continuam acessíveis por Personalizar.
- Formulários extensos conservam recursos além dos exemplos das prints.
- Resumos laterais são da configuração salva; não exibem valores ilustrativos.
- Mobile usa grupos horizontais e teste sobreposto, com botão de fechar;
  tablet omite o resumo lateral. Grade larga rola dentro do próprio contêiner.

## Validação em 27/10/2026

Suíte completa: 2.318 testes em 140 arquivos. Build, lint e TypeScript conferidos.
Novas regressões: `sandbox-draft`, `sandbox-engine-inspection` e
`knowledge-draft-publish` (17 casos: posse, histórico, fontes, falhas e concorrência).
Conferência real no navegador: comparação com IA, fonte do rascunho, publicação
habilitada, descarte protegido, grade por teclado, layouts desktop/mobile, filtros
e painel do contato. O rascunho de QA foi descartado; não se publicou sobre o
documento existente nem se enviou mensagem a contatos reais. A publicação foi
verificada pelos testes do contrato e da transação; o aceite de negócio segue
na homologação. Referências e contexto: [painel](../../../../.claude/context/painel/_index.md).
