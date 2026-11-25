# Animações — quem faz o quê

> Regra de ouro: rolagem é **nativa** em todo o app. Animações de UI usam **Motion** (`motion/react`); reveals de scroll da landing usam **IntersectionObserver + CSS** (GSAP e Lenis foram removidos — o smooth scroll do Lenis travava a rolagem quando a altura da página mudava, ex. accordion do FAQ).

## Bibliotecas instaladas

| Lib | Onde | Uso |
|---|---|---|
| **Motion** (`motion/react`) | Todo o app | HeroChat, FAQ accordion, FadeIn de páginas, useReducedMotion |
| IntersectionObserver + CSS (`[data-animate] .reveal`) | `(marketing)/` apenas | Reveals de scroll |
| CSS puro (keyframes em `globals.css`) | Todo o app | Assinatura `TypingToCheck` (pontos + check desenhado) |

## Onde cada coisa vive

- `src/components/ui/TypingToCheck.tsx` — **assinatura da marca** ("digitando → check"). Estados: `typing` (3 pontos) e `done` (check coral/success/branco). É o indicador padrão de carregando/sucesso do produto — não criar spinners paralelos. Keyframes: `globals.css` (`.ttc-*`).
  - Usado em: loading dos botões de login/cadastro, bolha "digitando" do Sandbox (`conversas/Sandbox.tsx`), e (versão estática) painel do auth layout + cena 4 do hero.
- `src/app/(marketing)/_components/HeroChat.tsx` — demonstração do hero: **conversa sequencial auto-atendida** (máquina de estados + Motion/AnimatePresence, sem cenas absolutas sobrepostas — o antigo `HeroShowcase` GSAP foi removido por bugs de sobreposição). Loop com pausa; reduced-motion → conversa completa estática.
- `src/app/(marketing)/_components/LandingMotion.tsx` — wrapper da landing: IntersectionObserver adiciona `.is-revealed` aos elementos `.reveal` (CSS em `globals.css`, seção `[data-animate]`). Sem JS ou com reduced-motion, tudo fica visível e nada é inicializado.
- `src/components/ui/FadeIn.tsx` — entrada de página/bloco (Motion). Usado em `/planos` e no form do auth.
- `src/app/(marketing)/_components/ScrollProgress.tsx` — barra de progresso de leitura no topo (Motion `useScroll` + spring; só observa o scroll nativo).
- `src/app/(marketing)/_components/Parallax.tsx` — parallax sutil (`useScroll` no próprio elemento). Usado no telefone do hero (`speed=-28`) e no headline do CTA final (`speed=24`).
- `Navbar.tsx` — scrollspy via IntersectionObserver (link da seção ativa com sublinhado `signal`).
- Âncoras do menu: `html { scroll-behavior: smooth; scroll-padding-top: 76px }` em `globals.css` — suave e sem cortar o topo da seção sob o header fixo.
- `src/app/(marketing)/_components/FAQ.tsx` — accordion com `motion/react` (AnimatePresence).

## Regras

1. Toda animação respeita `prefers-reduced-motion` (guard global em `globals.css` + checagens por componente).
2. Duração de UI: 150–300ms, `ease-out`. Nada bloqueia a ação do usuário.
3. Para animar algo novo na landing: adicione a classe `.reveal` (o IntersectionObserver pega sozinho) ou estenda o roteiro do `HeroChat`.
4. Para animar algo novo em qualquer lugar: `motion/react` ou CSS. Não reintroduzir smooth-scroll de biblioteca (Lenis & cia.) — já causou travamento de rolagem.
