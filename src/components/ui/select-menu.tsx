"use client";

import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { actionBorder, actionFocus, actionText } from "./action";
import {
  firstEnabledIndex,
  lastEnabledIndex,
  stepIndex,
} from "./select-menu-nav";

export type SelectMenuOption = {
  value: string;
  label: string;
  /** Contagem/etiqueta à direita do rótulo (ex.: quantas conversas). */
  badge?: React.ReactNode;
  /** Ponto colorido antes do rótulo — use um token (`bg-warn`, `bg-success`). */
  dot?: string;
  disabled?: boolean;
  /**
   * Desenha uma linha divisória ACIMA desta opção. Para separar grupos de
   * naturezas diferentes (um estágio do lead e uma origem de dados, por
   * exemplo) sem precisar de um cabeçalho de grupo.
   *
   * É só visual: o divisor sai do `role="option"` e vira `aria-hidden`, senão
   * viraria alvo das setas e entraria na contagem que o leitor de tela anuncia
   * ("opção 3 de 6" contando uma linha que ninguém escolhe).
   */
  separatorBefore?: boolean;
};

/**
 * Menu de seleção desenhado pelo produto, no lugar do `<select>` nativo.
 *
 * Existe porque o menu do `<select>` é pintado pelo sistema operacional: no
 * painel escuro ele abre uma lista clara, com a fonte e o realce do SO, e
 * ignora os tokens da marca. Não há CSS que alcance aquele popup — a única
 * forma de ele seguir o design é não ser ele.
 *
 * O `<select>` nativo (`./select.tsx`) continua valendo onde o menu do sistema
 * é uma vantagem — sobretudo formulário em celular, onde ele abre o seletor
 * nativo e não custa JS. Este aqui é para quando o menu faz parte da tela e a
 * aparência conta: filtro, navegação e formulário dentro de um modal escuro,
 * onde a lista clara do sistema destoaria de tudo à volta.
 *
 * Dentro de um `<form>`, passe `name`: o controle é um `<button>` e não entra
 * no `FormData` sozinho — um input oculto carrega o valor no envio.
 *
 * Trocar o nativo significa reimplementar o que ele dava de graça, então o
 * teclado segue o padrão ARIA de listbox: Enter/Espaço/Setas abrem, ↑↓ andam,
 * Home/End vão às pontas, Enter escolhe, Esc fecha e devolve o foco ao botão,
 * Tab fecha sem escolher. `aria-activedescendant` anuncia a opção sob o cursor
 * sem tirar o foco do botão.
 */
/** Props comuns aos dois modos. */
type SelectMenuBaseProps = {
  options: SelectMenuOption[];
  /** Rótulo acessível do controle (ex.: "Filtrar conversas por estágio"). */
  label: string;
  /**
   * Id de um `<label>` visível que já nomeia o controle — use no lugar de
   * repetir o texto em `aria-label`, que sobrescreveria o rótulo da tela.
   */
  labelledBy?: string;
  /**
   * Nome do campo quando o menu está dentro de um `<form>`. O controle é um
   * `<button>` e não entra no `FormData` sozinho: com `name`, um input oculto
   * carrega o valor no envio.
   */
  name?: string;
  /** Ícone decorativo à esquerda. */
  icon?: React.ComponentType<{ size?: number | string; className?: string }>;
  className?: string;
  /** Lado em que o menu se alinha ao botão. */
  align?: "start" | "end";
  /** Texto do botão quando nada está escolhido. */
  placeholder?: string;
  /**
   * Altura do controle, na mesma escala de `Input`/`Button` — `default` é
   * `h-10` e alinha numa linha com eles; `sm` é `h-8`, para barras densas
   * (uma linha de tabela, por exemplo).
   *
   * Nasceu fixo em `h-8`, o que deixava o menu visivelmente mais baixo que a
   * busca e os botões ao lado dele numa mesma barra.
   */
  size?: "default" | "sm";
  /**
   * Desabilita o controle: o menu não abre e o botão sai da ordem de tabulação
   * (é um `<button disabled>` de verdade, não um estilo por cima). Use para o
   * campo que ainda depende de outro — a cidade antes da UF, por exemplo — e
   * diga em algum lugar o que falta, senão o campo apagado não explica nada.
   */
  disabled?: boolean;
  /** `signal` nas telas que adotaram a cor de ação; `iris` é o padrão. */
  accent?: "iris" | "signal";
};

/**
 * `multiple` discrimina a união: quem passa `multiple` recebe `string[]` no
 * handler, quem não passa recebe `string`. Um `value: string | string[]` só
 * empurraria o `typeof` para dentro de cada tela.
 */
export type SelectMenuProps = SelectMenuBaseProps &
  (
    | {
        multiple: true;
        value: string[];
        /** A seleção inteira, na ordem das opções. */
        onChange: (value: string[]) => void;
      }
    | {
        multiple?: false;
        value: string;
        onChange: (value: string) => void;
      }
  );

export function SelectMenu({
  options,
  value,
  onChange,
  multiple = false,
  placeholder,
  label,
  labelledBy,
  name,
  icon: Icon,
  className,
  align = "start",
  size = "default",
  disabled = false,
  accent = "iris",
}: SelectMenuProps) {
  const [open, setOpen] = React.useState(false);
  // Opção sob o cursor do teclado. Só existe com o menu aberto; separada do
  // valor escolhido, senão navegar com as setas já mudaria o filtro.
  const [activeIndex, setActiveIndex] = React.useState(0);

  const uid = React.useId();
  const listId = `selectmenu-${uid}`;
  const btnRef = React.useRef<HTMLButtonElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);

  // Uma representação só para os dois modos: no simples é um conjunto de um
  // elemento. Evita ramificar em toda leitura de "está escolhido?".
  const selectedValues = React.useMemo(
    () => new Set(Array.isArray(value) ? value : value ? [value] : []),
    [value],
  );

  const selectedIndex = Math.max(
    options.findIndex((o) => selectedValues.has(o.value)),
    0,
  );
  const selected = options[selectedIndex];

  /**
   * O que o botão mostra. No múltiplo: o rótulo quando há um só, "N escolhidos"
   * a partir de dois — listar todos truncaria no meio de um nome e não diria
   * quantos ficaram de fora.
   */
  const buttonLabel = !multiple
    ? (selected?.label ?? placeholder ?? "")
    : selectedValues.size === 0
      ? (placeholder ?? "Todos")
      : selectedValues.size === 1
        ? (options.find((o) => selectedValues.has(o.value))?.label ?? "")
        : `${selectedValues.size} escolhidos`;

  /**
   * Coordenadas do menu, medidas do botão no momento da abertura.
   *
   * O menu é `position: fixed` para escapar de ancestrais com `overflow` (o
   * corpo rolável de um modal, por exemplo), e `fixed` é relativo à viewport —
   * então a posição precisa ser calculada, não herdada do wrapper.
   */
  const [pos, setPos] = React.useState<React.CSSProperties>({});

  const place = React.useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    // Vira para cima quando não cabe embaixo e há mais espaço acima — senão o
    // menu nasceria colado no rodapé da janela, com a lista quase toda fora.
    const flipUp = below < 240 && r.top > below;

    setPos({
      minWidth: r.width,
      // Alinhamento pela borda que o `align` pedir, preso à janela.
      ...(align === "end"
        ? { right: Math.max(8, window.innerWidth - r.right) }
        : { left: Math.max(8, r.left) }),
      ...(flipUp
        ? { bottom: window.innerHeight - r.top + 4, maxHeight: r.top - 16 }
        : { top: r.bottom + 4, maxHeight: below - 16 }),
    });
  }, [align]);

  const openMenu = React.useCallback(
    (index = selectedIndex) => {
      setActiveIndex(index);
      place();
      setOpen(true);
    },
    [selectedIndex, place],
  );

  const closeMenu = React.useCallback((focusButton = true) => {
    setOpen(false);
    if (focusButton) btnRef.current?.focus();
  }, []);

  const choose = React.useCallback(
    (index: number) => {
      const opt = options[index];
      if (!opt || opt.disabled) return;

      if (multiple) {
        // Alterna e MANTÉM o menu aberto: fechar a cada clique obrigaria a
        // reabrir para cada item, que é o contrário de escolher vários.
        const next = new Set(selectedValues);
        if (next.has(opt.value)) next.delete(opt.value);
        else next.add(opt.value);
        // Devolve na ordem das opções, não na de clique — assim o texto do
        // botão não embaralha conforme a pessoa marca e desmarca.
        (onChange as (v: string[]) => void)(
          options.filter((o) => next.has(o.value)).map((o) => o.value),
        );
        return;
      }

      (onChange as (v: string) => void)(opt.value);
      closeMenu();
    },
    [options, onChange, closeMenu, multiple, selectedValues],
  );

  // Pula opções desabilitadas ao andar com as setas — parar numa opção que o
  // Enter recusa faz o teclado parecer quebrado. A lógica mora em
  // `./select-menu-nav` para ser testável sem DOM.
  const step = React.useCallback(
    (from: number, dir: 1 | -1) => stepIndex(from, dir, options),
    [options],
  );

  // Fecha ao clicar fora. Mousedown (não click) para o menu sumir junto com o
  // gesto, sem o piscar de um clique que ainda está em curso.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        !btnRef.current?.contains(target) &&
        !listRef.current?.contains(target)
      ) {
        closeMenu(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, closeMenu]);

  // Menu `fixed` não acompanha a rolagem do que está atrás: sem isto ele
  // ficaria parado enquanto o botão sobe com a página. `capture` para pegar
  // também a rolagem de contêineres internos, não só a da janela.
  React.useEffect(() => {
    if (!open) return;
    const onMove = () => place();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, place]);

  // Mantém a opção ativa à vista quando a lista rola.
  React.useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (
        e.key === "Enter" ||
        e.key === " " ||
        e.key === "ArrowDown" ||
        e.key === "ArrowUp"
      ) {
        e.preventDefault();
        openMenu();
      }
      return;
    }

    switch (e.key) {
      case "Escape":
        e.preventDefault();
        closeMenu();
        break;
      case "Tab":
        // Deixa o Tab seguir para o próximo campo, mas sem menu aberto atrás.
        closeMenu(false);
        break;
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) => step(i, 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) => step(i, -1));
        break;
      case "Home":
        e.preventDefault();
        setActiveIndex(firstEnabledIndex(options));
        break;
      case "End":
        e.preventDefault();
        setActiveIndex(lastEnabledIndex(options));
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        choose(activeIndex);
        break;
    }
  }

  return (
    <div className={cn("relative", className)}>
      {name && (
        <input
          type="hidden"
          name={name}
          value={Array.isArray(value) ? value.join(",") : value}
        />
      )}
      <button
        ref={btnRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={
          open ? `${listId}-opt-${activeIndex}` : undefined
        }
        // Com um <label> visível, ele é o nome do controle; `aria-label` só
        // entra quando não há rótulo na tela — os dois juntos fariam o leitor
        // de tela ignorar o rótulo que a pessoa está vendo.
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : label}
        disabled={disabled}
        onClick={() => (open ? closeMenu(false) : openMenu())}
        onKeyDown={onKeyDown}
        className={cn(
          "flex w-full items-center gap-2 rounded-control border text-sm transition-colors",
          size === "sm" ? "h-8 px-2.5" : "h-10 px-3",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
          "focus-visible:ring-offset-paper panel:focus-visible:ring-offset-ink",
          // Mesmo desabilitado dos campos de `input.tsx`: a borda de hover sai
          // junto, senão o controle apagado ainda reage ao mouse.
          "disabled:cursor-not-allowed disabled:opacity-50",
          accent === "signal"
            ? cn(actionText, actionBorder, actionFocus, "bg-transparent enabled:hover:bg-signal/10",
              "disabled:hover:border-signal/60", open && "border-signal ring-2 ring-signal panel:ring-signal")
            : cn("focus-visible:ring-iris",
              "border-ink/15 bg-white text-ink hover:border-ink/25",
              "panel:border-white/20 panel:bg-white/5 panel:text-white panel:hover:border-white/30",
              "disabled:hover:border-ink/15 panel:disabled:hover:border-white/20",
              open && "border-iris ring-2 ring-iris panel:border-iris"),
        )}
      >
        {Icon && (
          <Icon
            size={14}
            className="shrink-0 text-neutral panel:text-white/50"
          />
        )}
        {!multiple && selected?.dot && (
          <span
            aria-hidden
            className={cn("h-1.5 w-1.5 shrink-0 rounded-full", selected.dot)}
          />
        )}
        <span className="min-w-0 flex-1 truncate text-left">{buttonLabel}</span>
        {/* No múltiplo o contador substitui o badge da opção: com vários
            marcados, o badge de um só deles enganaria. */}
        {multiple && selectedValues.size > 1 && (
          <span className="shrink-0 rounded-full bg-iris/20 px-1.5 font-mono text-micro tabular-nums text-white">
            {selectedValues.size}
          </span>
        )}
        {!multiple && selected?.badge !== undefined && (
          <span className="shrink-0 font-mono text-micro tabular-nums text-neutral panel:text-white/50">
            {selected.badge}
          </span>
        )}
        <ChevronDown
          size={14}
          aria-hidden
          className={cn(
            "shrink-0 text-neutral transition-transform panel:text-white/50",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-multiselectable={multiple || undefined}
          aria-label={label}
          tabIndex={-1}
          // `fixed` + coordenadas medidas do botão, e não `absolute` dentro do
          // wrapper: assim o menu não é cortado por nenhum ancestral com
          // `overflow` — o corpo rolável de um modal, a célula de uma tabela
          // rolável. Foi o que quebrou ao pôr este menu dentro do diálogo de
          // "Criar conta".
          style={pos}
          className={cn(
            "fixed z-[100] max-h-72 overflow-y-auto rounded-surface border p-1 shadow-xl",
            "border-ink/10 bg-white panel:border-white/15 panel:bg-ink",
          )}
        >
          {options.map((o, i) => {
            const isSelected = selectedValues.has(o.value);
            const isActive = i === activeIndex;
            return (
              <React.Fragment key={o.value}>
                {o.separatorBefore && i > 0 && (
                  <li
                    role="presentation"
                    aria-hidden
                    className="my-1 border-t border-ink/10 panel:border-white/10"
                  />
                )}
                <li
                  id={`${listId}-opt-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={o.disabled || undefined}
                  // O foco fica no botão (aria-activedescendant): o ponteiro só
                  // move o cursor, para mouse e teclado não brigarem pelo realce.
                  onPointerMove={() => !o.disabled && setActiveIndex(i)}
                  onClick={() => choose(i)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-control px-2.5 py-1.5 text-sm transition-colors",
                    o.disabled && "cursor-not-allowed opacity-40",
                    isActive && !o.disabled && (accent === "signal" ? "bg-signal/10 panel:bg-signal/15" : "bg-iris/10 panel:bg-white/10"),
                    isSelected
                      ? "font-medium text-ink panel:text-white"
                      : "text-neutral panel:text-white/70",
                  )}
                >
                  {/* Espaço do check reservado sempre: sem isso o rótulo dança
                    para o lado quando a seleção muda. No múltiplo vira uma
                    caixinha — a forma diz "dá para marcar mais de um" antes de
                    a pessoa tentar. */}
                  <span
                    className={cn(
                      "flex h-3.5 w-3.5 shrink-0 items-center justify-center",
                      multiple &&
                        cn(
                          "rounded-[3px] border",
                          isSelected
                            ? (accent === "signal" ? "border-signal bg-signal text-ink panel:text-ink" : "border-iris bg-iris text-white")
                            : "border-ink/25 panel:border-white/25",
                        ),
                    )}
                  >
                    {isSelected && (
                      <Check
                        size={multiple ? 11 : 13}
                        aria-hidden
                        className={multiple
                          ? (accent === "signal" ? "text-ink" : "text-white")
                          : (accent === "signal" ? "text-signal-ink panel:text-signal" : "text-iris")}
                      />
                    )}
                  </span>
                  {o.dot && (
                    <span
                      aria-hidden
                      className={cn("h-1.5 w-1.5 shrink-0 rounded-full", o.dot)}
                    />
                  )}
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.badge !== undefined && (
                    <span className="shrink-0 font-mono text-micro tabular-nums text-neutral panel:text-white/45">
                      {o.badge}
                    </span>
                  )}
                </li>
              </React.Fragment>
            );
          })}
        </ul>
      )}
    </div>
  );
}
