# Agentes no painel do tenant

Interface baseada nas referências v5: navegação principal em ícones, lista de
agentes no menu secundário, grade de configurações e resumo do item à direita.
Os temas claro e escuro do tenant (`PanelShell variant="tenant"`) são controlados
por `TenantThemeProvider`, com preferência local persistida. O seletor fica na
navegação principal, inclusive recolhida, e na gaveta mobile. O controle é um
**switch à direita**, no lugar de "Ligado/Desligado": sol à esquerda no tema
claro, lua no escuro e rótulo do modo atual. Recolhido, o ícone fica no thumb do
switch para o controle continuar visível. O admin usa a mesma
casca com preferências próprias (padrão escuro, menu expandido); autenticação
e marketing mantêm suas superfícies.

Contexto compacto para futuras sessões: [painel](../../../../.claude/context/painel/_index.md).

## Mapa

- `AgentsFrame.tsx`: lê a navegação junto da página, com as consultas existentes
  filtradas pelo tenant. O cache do React reaproveita a leitura na mesma renderização.
  Não colocar essa leitura no layout persistente: criar/importar/renomear precisa
  atualizar a lista sem deixar itens antigos na navegação.
- `AgentsSidebar.tsx`: seleção, busca, criar/importar e uso do plano. Só recebe
  identificação e estado dos agentes; prompts e configuração completa ficam no servidor.
- `[id]/AgentHeader.tsx`: gestão existente do agente no menu de opções; salvamentos
  imperativos usam `useSaveFeedback` e as mesmas server actions.
- `[id]/AgentWizard.tsx`: grade/lista, busca de configurações, resumos, interruptores
  e edição em diálogo lateral. O nome foi mantido para preservar a entrada existente.
- `agents-workspace.css`: layout e componentes específicos dessa área.
- `loading.tsx`, `error.tsx`, `[id]/not-found.tsx`: estados da navegação de Agentes.
- `src/components/shell/TenantShell.tsx` e `tenant-shell.css`: navegação comum
  do tenant; a ponte de estilos adapta as páginas existentes só no tema claro,
  e o escuro reaproveita as variantes `panel:`. Cores da área de Agentes usam
  variáveis semânticas dos dois temas.
- `TenantTheme.tsx`: preferências de tema e switch compartilhados por tenant e
  admin; `Switch.thumbContent` recebe o ícone decorativo no menu recolhido.
- `ImpersonationBanner.tsx`: aviso "Acesso de administrador", identificação da
  conta visualizada e retorno ao admin, com contraste nos dois temas.
- `src/lib/utils.ts`: registra `text-micro` como tamanho no `tailwind-merge`;
  uma classe de cor não pode remover o tamanho e ampliar links/botões.
- `FilterTabs`, `PageHeader` e `Stat`: filtros sem caixa alta, títulos e números
  com escala mais contida; a mudança é visual, não altera métricas.

## Contratos preservados

Os botões de editar abrem `PersonaForm`, `RulesForm`, `VariablesSettings`,
`KnowledgeManager`, `ScheduleSettings`, `FollowUpSettings`, `HandoffSettings`
e `BehaviorSettings`. Testar abre `Sandbox` com o **id do agente selecionado**.
Os formulários, as validações, os limites e as regras de domínio permanecem
nas fontes anteriores; não há nova API, tabela ou mudança no worker.

Os resumos refletem a configuração salva. Horários usam a grade semanal existente,
inclusive pausas; não presumem um expediente. A agenda do fechai continua sendo a
fonte da verdade, com Clinicorp indicado quando conectado. Ações indisponíveis do
catálogo aparecem como **Em breve**, sem interruptor. Triagem continua utilizável.
Voz exige a voz escolhida e disponibilidade da instalação antes de ligar áudio.

O diálogo de edição usa `showModal()` para foco, Escape e isolamento de teclado.
O fechamento passa por `useUnsavedNavigation`; os formulários originais mantêm
seu registro de rascunhos. Retornos usam o ToastProvider existente, e formulários
que já tinham `FormFeedback` dentro de diálogo continuam com o retorno inline.
As abas dos formulários aceitam setas, Home e End.

## Responsividade e escopo

No desktop, lista e resumo ocupam 220px e 300px. Em telas intermediárias a grade
usa três colunas e o resumo segue abaixo dela; selecionar um item leva o foco ao
detalhe. No celular, agentes viram uma lista horizontal e a navegação principal
abre em gaveta. A preferência de expandir a navegação é independente do admin.
O recolhimento anima a largura e os rótulos, sem escalar texto; a gaveta também
anima entrada e saída. `prefers-reduced-motion` desliga essas transições.

As preferências são independentes: `fechai:tenant-theme`/`fechai:admin-theme` e
`fechai:tenant-menu-expanded`/`fechai:admin-menu-expanded`. Sem localStorage, há
fallback em memória. `data-panel` identifica o contexto e `data-surface` o tema.
Não há coluna de usuário para essas escolhas. A identificação do admin fica no
cabeçalho compacto; rotas e ferramentas administrativas continuam as existentes.
O `main` permanece `position: relative` para conter elementos absolutos das
tabelas e evitar transbordamento horizontal no tamanho menor.

As outras rotas do tenant recebem a casca e a navegação novas, preservando a
organização de seus conteúdos. Submenus específicos e redesenho interno dessas
áreas ficam fora desta entrega.

## Validação realizada

- Build e lint completos passaram durante a implementação; lint dos componentes
  e `npx tsc --noEmit` foram conferidos novamente após o switch final.
- 56 testes unitários existentes de agente, pacote, personalidade, follow-up e
  feedback passaram na refatoração inicial. Na correção de tipografia, passaram
  os 3 casos de `tests/ui-class-merge.test.ts` e 24 de `tests/toast-feedback.test.ts`.
- A prévia isolada, com dados e actions simulados, passou por 26 verificações de
  navegador: editores, rascunhos, busca, limites e larguras de 320 a 1440px.
- No servidor real foram conferidos admin, personificação do tenant demo,
  relatórios, editor de personalidade, claro/escuro, persistência, menu mobile e
  switch final à direita; sol no claro e lua no escuro foram verificados no DOM.

Essas conferências não representam um teste de envio real de WhatsApp nem uma
nova validação integrada de todas as gravações; as actions de domínio foram
reutilizadas. Para repetir a regressão de UI:

```sh
npx vitest run tests/ui-class-merge.test.ts tests/toast-feedback.test.ts
npm run lint
npm run build
```
