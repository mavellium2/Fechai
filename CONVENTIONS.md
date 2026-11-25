# Convenções de Código

## Estrutura

- `src/app/(grupo)/` — rotas por grupo: `(auth)`, `(dashboard)`, `(marketing)`, `(admin)`.
- `src/modules/<nome>/` — lógica de domínio isolada. **Cada módulo tem um `README.md` (~40 linhas):** (1) o que faz, (2) arquivos e responsabilidades, (3) contratos expostos, (4) o que NÃO faz.
- `src/lib/` — infra compartilhada (prisma, auth guards, utils).
- `src/components/ui/` — primitivos shadcn-style. **Antes de escrever HTML novo para um botão, campo, etiqueta, aviso, vazio ou diálogo, use o primitivo daqui** — o painel já acumulou 3 selects e 3 campos-com-label divergentes por não fazer isso.
- `src/components/shell/` — casca dos painéis (`PanelShell`, `ShellNav`, `MobileNav`, `PanelError`).
- `src/components/chat/` — bolha e log de conversa (`ChatBubble`, `ChatLog`), compartilhados entre sandbox, histórico e prévia do onboarding.
- `workers/` — jobs BullMQ.

## Regras

1. **Documentação-primeiro.** Antes de codar um módulo, crie/atualize seu `README.md`.
2. **Nunca hardcode o caso "escola de esportes".** É só seed/template.
3. **Toda query filtra por `tenantId`** — obtenha-o via guards de `src/lib/session.ts`.
4. **Arquivos pequenos, uma responsabilidade.** Nada de `page.tsx` monolítico; componentize por seção.
5. Decisão de arquitetura não especificada → escolha simples+escalável, registre em `docs/decisions/ADR-XXX-titulo.md`, siga.

## Como adicionar uma "Ação" (tool) nova

1. Escolha uma `key` (ex: `send_catalog`) e adicione em `DEFAULT_ACTION_KEYS` (`src/modules/tenants/provision.ts`).
2. Registre o schema da tool (function calling) no `agent-engine` _(Milestone 5)_.
3. Implemente o handler que executa a ação, sempre recebendo `tenantId`.
4. Exponha o toggle na tela `agentes/`.

## Marca

O produto chama-se **fechai** (sempre minúsculo). O wordmark é `fechai` em `font-display` com o ponto final em `signal`:

```tsx
fechai<span className="text-signal">.</span>
```

Não escreva "Agente" como nome de produto. **Agente** é o termo de domínio para a IA que atende o lead (`agent-engine`, `AgentConfig`, "o agente responde") — isso permanece.

## Tokens de marca (obrigatório — nenhum componente usa cor fora disto)

Definidos no `@theme` de `src/app/globals.css` (Tailwind v4, sem `tailwind.config.ts`):

| Token | Hex | Uso |
|---|---|---|
| `ink` | `#14171F` | texto principal |
| `paper` | `#F7F8FB` | fundo padrão |
| `iris` | `#4B3CF0` | marca: links, ícones ativos, wordmark, botão default |
| `signal` | `#FF6B4A` | cor de ação: ícone de botão, CTA preenchido, filtros/abas/busca, interruptor ligado |
| `signal-ink` | derivado de `signal` + `ink` | ícone/texto de ação sobre `paper` (AA); no painel use `panel:text-signal` |
| `success` | `#1FC8A3` | só sucesso/confirmação |
| `neutral` | `#6B7280` | texto secundário, bordas (`border-neutral/20`) |
| `warn` / `danger` | funcionais | avisos / erros e destrutivo |

- Tons derivados: usar opacidade (`bg-iris/10`, `border-ink/15`) — nunca `indigo-*`, `gray-*`, `emerald-*` etc.
- **Piso de contraste no painel escuro**: texto sobre `ink` a partir de `white/55`. Abaixo disso (`white/35`, `white/40`) fica em ~3.4–3.9:1 e reprova no AA — justamente onde ficam os metadados pequenos.

### Raio e tipografia micro também são tokens

Estavam como valor solto espalhado (`rounded-md`/`lg`/`xl`/`2xl` misturados na mesma tela; `text-[9px]`, `text-[10px]` e `text-[11px]` para o mesmo papel). Agora saem do `@theme`:

| Token | Valor | Utilitário | Uso |
|---|---|---|---|
| `--radius-control` | 8px | `rounded-control` | botão, campo, select, textarea, skeleton |
| `--radius-surface` | 12px | `rounded-surface` | card, diálogo, item de lista, bolha de chat |
| `--text-micro` | 11px | `text-micro` | rótulos e metadados em `font-mono` — **o menor tamanho do produto** |

- `rounded-full` segue livre para pílulas (badge, filtro, switch, avatar).
- **Nada de `rounded-[10px]` ou `text-[9px]`.** Se um valor novo parecer necessário, ele vira token aqui antes de virar classe.
- Espaçamento em múltiplos de 4/8. A única exceção tolerada é ajuste **óptico** de ícone contra a primeira linha de texto (`mt-0.5`), sempre comentado no código.
- **`signal` marca a ação, não o conteúdo.** Botão/link secundário usa `variant="action"`: texto e borda brancos no painel escuro (`ink` no fundo claro) e **laranja só no ícone** e no foco. A ação principal da seção usa `variant="cta"` (preenchido), no máximo 1 por seção. Filtros, switches, menus e busca usam `accent="signal"`. Nome de lead/card e rótulos de botão/menu continuam branco/preto; no menu o laranja fica no ícone e no item ativo (painel e admin, via `tenant-shell.css`). `iris` segue como identidade (wordmark). Regra completa e exceções: [docs/plataforma/interface/cores-acao.md](docs/plataforma/interface/cores-acao.md).
- Fontes: `font-display` (títulos/wordmark — Clash Display, fallback Space Grotesk), `font-sans` (corpo — Satoshi, fallback Plus Jakarta Sans), `font-mono` (dados/snippets/IDs — JetBrains Mono).
- Texto sobre `iris` é branco/`paper`; sobre `paper` é `ink`. Sobre fundo `signal` preenchido use `ink` (branco reprova AA); ícone/texto de ação sobre `paper` usa `signal-ink` e no painel `panel:text-signal`/`panel:border-signal`. Não use `actionText` em nome de lead.
- Indicador de carregando/sucesso é o `TypingToCheck` (assinatura "digitando → check") — não criar spinners.
- Animações: ver `docs/plataforma/interface/animations.md` (Motion + IntersectionObserver; rolagem nativa — nada de lib de smooth-scroll; `prefers-reduced-motion` sempre).
- Design system completo: skill `.claude/skills/design-ui/SKILL.md` (anti-padrões na seção 8, checklist na 9).

## Superfícies (claro x painel escuro)

O produto tem duas superfícies: `paper` (marketing, auth, onboarding) e `ink` (painel logado). **Nenhuma tela reescreve cor para se adaptar** — quem marca a superfície é a casca:

```tsx
<div data-surface="dark">   {/* PanelShell faz isso uma vez */}
```

E o `globals.css` declara a variante que os primitivos consomem:

```css
@custom-variant panel (&:where([data-surface="dark"] *));
```

Num componente novo, escreva o estilo claro e adicione a variante escura no mesmo lugar: `text-ink panel:text-white`, `border-ink/10 panel:border-white/10`. **Nunca** `className="border-white/20 bg-transparent text-white/70"` no local de uso.

## Regras de interação (não negociáveis)

1. **Ação assíncrona dá retorno**: `<Button loading={pending}>`, `Switch loading`, `SegmentedControl loading`. Botão não trava mudo.
2. **Ação destrutiva confirma**: `ConfirmButton` (suspender conta, apagar documento). Ação reversível num clique **não** confirma — confirmação em tudo vira ruído.
3. **Nada de commit implícito**: `<select onChange={grava}>` grava estado intermediário a cada seta do teclado. Use commit explícito (botão Salvar/Desfazer) ou `SegmentedControl`.
4. **Toda tela com dados tem os 4 estados**: `loading.tsx` (`PageSkeleton`), vazio (`EmptyState`, **sempre com próximo passo**), erro (`error.tsx` → `PanelError`) e preenchido.
5. **Campo tem label associada**: `<Field label htmlFor>` + `{...fieldProps(id)}` no controle. `placeholder` não é rótulo.
6. **Estado nunca é só cor**: acompanhe de texto (visível ou `sr-only`) ou ícone.
7. **Diálogo é `<dialog showModal()>`**: foco preso, `Esc` e devolução de foco vêm do navegador — não escreva armadilha de foco à mão nem instale lib de modal.

## Nomenclatura

- Rotas/labels de usuário em **português**; identificadores de código e `key`s de ação em **inglês** (`register_lead`).
- Componentes: PascalCase. Helpers/arquivos: camelCase ou kebab por pasta existente.

## Definition of done por milestone

`npm run build` passa → testes (se houver) passam → `docs/projeto/CHANGELOG.md` atualizado → só então próximo milestone.
