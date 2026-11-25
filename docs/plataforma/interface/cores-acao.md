# Cor de ação (laranja `signal`)

Regra do produto: **o laranja marca o que é ação, sem pintar o conteúdo.**
Vai no ícone de um botão, no CTA preenchido, nas abas/filtros, na busca, no
interruptor ligado, na seta de um menu e no foco de um controle de ação.
**Não vai no nome do lead/card nem no rótulo dos botões secundários**: esses
continuam brancos no painel escuro e pretos (`ink`) no fundo claro.

O CRM é a primeira área adotante. Qualquer página nova do painel deve seguir
este documento desde o primeiro componente; ao reformar uma página existente,
troque também os controles dela.

## Tokens

| Token | Valor | Onde |
| --- | --- | --- |
| `signal` | `#FF6B4A` | fundo de CTA preenchido, ícone/borda/foco no painel escuro (`panel:`), interruptor ligado |
| `signal-ink` | `color-mix(in srgb, signal 68%, ink)` | ícone/texto/borda de ação sobre `paper`; é o **mesmo laranja**, escurecido só para passar AA |

O signal puro tem ~2,7:1 contra `paper` e reprova AA para texto. Por isso nunca
escreva `text-signal` em fundo claro: use `text-signal-ink`. No painel escuro
(`data-surface="dark"`) o signal cheio tem ~6:1 contra `ink` e é o que vale —
os primitivos já trazem as duas variantes na mesma classe. Não crie outro hex.

Sobre fundo `signal` preenchido, o texto é `ink` (contraste ~6:1), não branco —
branco sobre laranja reprova AA. A exceção histórica `variant="cta"` com
`text-white` vale só nas telas de conversão já publicadas e não se propaga.

## Como aplicar

- **Botão/link secundário:** `variant="action"` (`Button`/`ButtonLink`). Texto e
  borda neutros (`text-ink panel:text-white`, borda `ink/15`/`white/20`), fundo
  transparente, **ícone laranja** (`actionSurface` já aplica
  `[&_svg]:text-signal-ink panel:[&_svg]:text-signal`) e anel de foco laranja.
  Use em "Filtros", "Voltar", "Cancelar", "Limpar", "Mover", "Carregar mais" e
  ícones de ação. Botão sem ícone fica só neutro — não pinte o rótulo.
- **Ação principal da seção/tela:** `variant="cta"` (fundo `signal`, texto `ink`
  — use `className="text-ink"` até o primitivo trocar o padrão das telas de
  conversão). **Um por seção**, no máximo: "Aplicar", "Salvar prazos",
  "Adicionar lead", "Criar etapa".
- **Nome do lead/card:** sempre `text-ink panel:text-white` (com `hover:underline`
  quando é link). Nunca `actionText` — o laranja é do clique, não da pessoa.
- **Texto/link solto de ação:** `actionText` de `src/components/ui/action.ts`.
- **Borda própria:** `actionBorder`; **foco próprio:** `actionFocus` (quando o
  primitivo já tem `focus-visible:ring-iris`, a variante `signal` troca o anel).
- **Filtros em pílula:** `<FilterTabs accent="signal">`.
- **Interruptor:** `<Switch accent="signal">` — ligado fica laranja.
- **Menu de seleção:** `<SelectMenu accent="signal">` — gatilho, opção ativa e
  marca de seleção laranjas. O padrão dos primitivos continua `iris` para não
  repintar o produto inteiro de uma vez.
- **Campo de busca:** lupa, botão de limpar e borda/anel de foco laranjas, como
  em `CrmLiveSearch`.
- **Menu (painel e admin):** `ShellNav`/`MobileNav` compartilham a mesma regra —
  **rótulo branco no painel escuro e `ink` no fundo claro**, **ícone laranja** e
  marca de item ativo laranja (fundo `--tenant-nav-selected`, barra lateral,
  avatar/badge). Vale para os dois contextos, inclusive com o tema invertido: o
  `data-surface` escolhe `signal` (escuro) ou `signal-ink` (claro), nunca cor
  nova. Quem define a cor é `src/components/shell/tenant-shell.css`, não só o
  Tailwind do componente. Controles de abrir/fechar/fixar menu, perfil, sair,
  trocar tema e "Voltar ao admin" seguem o mesmo critério. Separadores de uso
  das abas (`FilterTabs`, `DisparosNav`, `StepTabs`) e o menu de agentes também
  usam o laranja no ativo. Estados de cota (perto do limite/sem mensagens)
  continuam `warn`/`danger`, e o dot de status do agente segue `success`/`warn`.

### Exemplo

```tsx
<ButtonLink href="/crm" variant="action"><ArrowLeft size={16} />Voltar ao CRM</ButtonLink>
<Link className="text-ink hover:underline panel:text-white" href={href}>{lead.name}</Link>
<FilterTabs accent="signal" label="Período" active={days} href={href} options={periods} />
<Switch accent="signal" checked={on} onCheckedChange={setOn} label="…" />
<Button type="submit" variant="cta" className="text-ink">Aplicar</Button>
```

## O que **não** é cor de ação

- **Estado:** sucesso, aviso, erro e prazo continuam em `success`, `warn`,
  `danger` (com texto/ícone, nunca só cor).
- **Destrutivo:** "Excluir", "Arquivar" e confirmações finais continuam em
  `destructive`/`destructiveSolid`.
- **Identidade e navegação estrutural:** wordmark, barra ativa do menu, links
  editoriais e botão `default` seguem `iris`.
- **Dado e texto comum:** nome de lead, telefone, origem, título de card e
  rótulo de botão secundário não viram laranja. Se não é ícone nem CTA/filtro,
  não use laranja.

## Checklist da página

- [ ] Ícone de ação, CTA, filtros, aba, busca e interruptor ligado usam `signal`.
- [ ] Nome de lead/card, rótulo de botão secundário e rótulo do menu continuam branco/preto; o laranja fica no ícone e no ativo.
- [ ] Há no máximo um `cta` preenchido por seção; o resto é `action`.
- [ ] `text-signal` não aparece em fundo `paper`; ícones sobre `paper` usam `signal-ink`.
- [ ] `focus-visible` continua visível e com contraste; `disabled`/`loading` intactos.
- [ ] Estados de erro/sucesso/destrutivo mantêm as cores funcionais.
