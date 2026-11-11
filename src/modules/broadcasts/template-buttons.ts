/**
 * Botões de um modelo da Meta (`BUTTONS` no modelo aprovado).
 *
 * Duas famílias, que a Meta não deixa misturar na mesma mensagem:
 * - **Resposta rápida** (`QUICK_REPLY`): o contato toca e a resposta chega como
 *   mensagem com o texto do botão ("Eu quero", "Bloquear"). Até 3 na tela.
 * - **Link** (`URL`): abre uma página `https` fixa. Link com variável fica de fora.
 *
 * Telefone e código de verificação ficam fora desta versão. Sem prisma nem rede:
 * tela e servidor usam as mesmas regras.
 */

export const BUTTON_LIMITS = { count: 3, text: 25, url: 2000 } as const;

export type TemplateButton =
  | { type: "QUICK_REPLY"; text: string }
  | { type: "URL"; text: string; url: string };

export type ButtonKind = TemplateButton["type"];

/** Atalhos da tela: o par que cobre "quero saber mais" e "não quero mais receber". */
export const QUICK_REPLY_PRESETS = ["Eu quero", "Bloquear", "Saber mais", "Parar mensagens"] as const;

type RawButton = { type?: string; text?: string; url?: string };

/**
 * Lê `BUTTONS` do que a Meta devolve. `null` quando há botão que o fechai ainda
 * não sabe enviar (telefone, código, link com variável) — o modelo então não
 * aparece para disparo, como qualquer outro formato não suportado.
 */
export function metaButtons(raw: RawButton[] | undefined): TemplateButton[] | null {
  if (!raw?.length) return [];
  const buttons: TemplateButton[] = [];
  for (const b of raw) {
    const text = (b.text ?? "").trim();
    if (!text) return null;
    if (b.type === "QUICK_REPLY") buttons.push({ type: "QUICK_REPLY", text });
    else if (b.type === "URL" && b.url && !/{{/.test(b.url)) buttons.push({ type: "URL", text, url: b.url });
    else return null;
  }
  return buttons;
}

/** Igualdade na ordem (o JsonB do banco reordena chaves; aqui compara campo a campo). */
export function sameButtons(left?: TemplateButton[], right?: TemplateButton[]): boolean {
  const a = left ?? [];
  const b = right ?? [];
  return (
    a.length === b.length &&
    a.every((x, i) => {
      const y = b[i];
      return x.type === y.type && x.text === y.text && (x.type === "URL" ? x.url === (y as typeof x).url : true);
    })
  );
}

/** "Eu quero · Bloquear" — o que vai registrado na conversa e na lista. */
export function buttonsLabel(buttons: TemplateButton[] | undefined): string {
  return (buttons ?? []).map((b) => b.text).join(" · ");
}

function httpsLink(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password;
  } catch {
    return false;
  }
}

/**
 * Valida o que veio do formulário. Nunca lança: devolve os botões prontos ou
 * uma frase para a tela. Lista vazia é válida (modelo sem botão).
 */
export function validateButtons(
  input: unknown,
): { ok: true; buttons: TemplateButton[] } | { ok: false; error: string } {
  if (input == null || input === "") return { ok: true, buttons: [] };
  if (!Array.isArray(input)) return { ok: false, error: "Botões inválidos." };
  if (input.length > BUTTON_LIMITS.count)
    return { ok: false, error: `Use até ${BUTTON_LIMITS.count} botões.` };

  const buttons: TemplateButton[] = [];
  for (const raw of input) {
    const b = (raw && typeof raw === "object" ? raw : {}) as RawButton;
    const text = typeof b.text === "string" ? b.text.trim() : "";
    if (!text) return { ok: false, error: "Escreva o texto de cada botão." };
    if (text.length > BUTTON_LIMITS.text)
      return { ok: false, error: `O texto do botão pode ter até ${BUTTON_LIMITS.text} caracteres.` };
    if (/{{|}}|\n/.test(text)) return { ok: false, error: "O texto do botão não aceita variáveis nem quebra de linha." };
    if (b.type === "QUICK_REPLY") buttons.push({ type: "QUICK_REPLY", text });
    else if (b.type === "URL") {
      const url = typeof b.url === "string" ? b.url.trim() : "";
      if (!url || url.length > BUTTON_LIMITS.url || /{{|\s/.test(url) || !httpsLink(url))
        return { ok: false, error: `O link do botão “${text}” precisa começar com https://` };
      buttons.push({ type: "URL", text, url });
    } else return { ok: false, error: "Tipo de botão inválido." };
  }
  if (new Set(buttons.map((b) => b.text.toLowerCase())).size !== buttons.length)
    return { ok: false, error: "Dois botões não podem ter o mesmo texto." };
  if (buttons.some((b) => b.type !== buttons[0].type))
    return { ok: false, error: "Não dá para misturar resposta rápida com link na mesma mensagem." };
  return { ok: true, buttons };
}
