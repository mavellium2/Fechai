/**
 * Modelo de mensagem criado pelo fechai e enviado à Meta para aprovação
 * (`/disparos/modelos`). Só valida e monta o pedido: quem aprova, guarda e
 * classifica é sempre a Meta, na conta do WhatsApp (WABA) do número — uma conta
 * que a Meta não autoriza a criar modelos recusa o pedido daqui do mesmo jeito.
 *
 * O formato é o mesmo que `supportedTemplate` aceita nos Disparos e lembretes:
 * texto, cabeçalho/rodapé fixos e variáveis posicionais `{{1}}…{{20}}` no corpo.
 * O topo pode ser imagem, vídeo ou documento (`headerMedia`); esse modelo serve
 * só para os Disparos, que escolhem o arquivo a cada envio.
 */
import { isMediaFormat, type MediaFormat } from "./media";

export const TEMPLATE_CATEGORIES = ["UTILITY", "MARKETING"] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

/** Clínicas brasileiras: o idioma é fixo para o modelo casar com o envio. */
export const TEMPLATE_LANGUAGE = "pt_BR";

export const TEMPLATE_LIMITS = {
  name: 512,
  header: 60,
  body: 1024,
  footer: 60,
  example: 200,
  variables: 20,
} as const;

export type TemplateDraft = {
  name: string;
  category: TemplateCategory;
  header: string;
  /** Mídia no topo em vez do título; o exemplo vai em `headerHandle`. */
  headerMedia: MediaFormat | null;
  /** Arquivo de exemplo já enviado à Meta (Resumable Upload). */
  headerHandle: string;
  body: string;
  footer: string;
  /** Um exemplo por variável, na ordem `{{1}}`, `{{2}}`… (a Meta exige). */
  examples: string[];
};

export type TemplateDraftField = keyof TemplateDraft;
export type TemplateDraftErrors = Partial<Record<TemplateDraftField, string>>;

/**
 * Nome aceito pela Meta: minúsculas, números e `_`. Converte o que a pessoa
 * digitou ("Lembrete de consulta" → `lembrete_de_consulta`) em vez de recusar.
 */
export function templateName(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, TEMPLATE_LIMITS.name);
}

/** Variáveis do corpo, sem repetição e em ordem: `[1, 2, 3]`. */
export function bodyVariables(body: string): number[] {
  return [...new Set([...body.matchAll(/{{(\d+)}}/g)].map((m) => Number(m[1])))].sort(
    (a, b) => a - b,
  );
}

function bodyError(body: string): string | null {
  if (!body) return "Escreva o texto da mensagem.";
  if (body.length > TEMPLATE_LIMITS.body)
    return `O texto pode ter até ${TEMPLATE_LIMITS.body} caracteres.`;
  if (/{{|}}/.test(body.replace(/{{\d+}}/g, "")))
    return "Use variáveis só no formato {{1}}, {{2}}…";
  const slots = bodyVariables(body);
  if (slots.length > TEMPLATE_LIMITS.variables)
    return `Use no máximo ${TEMPLATE_LIMITS.variables} variáveis.`;
  if (slots.some((slot, i) => slot !== i + 1))
    return "Numere as variáveis em sequência, começando em {{1}}.";
  // Regra da Meta: o corpo não pode começar nem terminar numa variável.
  if (/^{{\d+}}/.test(body) || /{{\d+}}$/.test(body))
    return "O texto não pode começar nem terminar com uma variável.";
  return null;
}

function fixedTextError(text: string, label: string, limit: number): string | null {
  if (text.length > limit) return `O ${label} pode ter até ${limit} caracteres.`;
  if (/\n/.test(text)) return `O ${label} precisa caber em uma linha.`;
  if (/{{|}}/.test(text)) return `O ${label} não aceita variáveis.`;
  return null;
}

/**
 * Valida o que veio do formulário. Nunca lança: devolve o rascunho pronto ou
 * os erros por campo, que a tela mostra junto de cada campo.
 */
export function validateTemplateDraft(input: {
  name?: unknown;
  category?: unknown;
  header?: unknown;
  headerMedia?: unknown;
  headerHandle?: unknown;
  body?: unknown;
  footer?: unknown;
  examples?: unknown;
}): { ok: true; draft: TemplateDraft } | { ok: false; errors: TemplateDraftErrors } {
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const errors: TemplateDraftErrors = {};

  const name = templateName(text(input.name));
  if (!name) errors.name = "Dê um nome ao modelo, como lembrete_consulta.";

  const category = TEMPLATE_CATEGORIES.find((c) => c === input.category);
  if (!category) errors.category = "Escolha a categoria.";

  const headerMedia = isMediaFormat(input.headerMedia) ? input.headerMedia : null;
  const headerHandle = headerMedia ? text(input.headerHandle) : "";
  const header = headerMedia ? "" : text(input.header);
  const headerProblem = header && fixedTextError(header, "cabeçalho", TEMPLATE_LIMITS.header);
  if (headerProblem) errors.header = headerProblem;
  if (headerMedia && (!headerHandle || headerHandle.length > 2000))
    errors.headerHandle = "Envie um arquivo de exemplo para o topo.";

  const body = text(input.body).replace(/\r\n/g, "\n");
  const bodyProblem = bodyError(body);
  if (bodyProblem) errors.body = bodyProblem;

  const footer = text(input.footer);
  const footerProblem = footer && fixedTextError(footer, "rodapé", TEMPLATE_LIMITS.footer);
  if (footerProblem) errors.footer = footerProblem;

  const rawExamples = Array.isArray(input.examples) ? input.examples : [];
  const examples = rawExamples.map(text);
  if (!bodyProblem) {
    const count = bodyVariables(body).length;
    if (
      examples.length !== count ||
      examples.some((e) => !e || e.length > TEMPLATE_LIMITS.example || /\n/.test(e))
    )
      errors.examples = "Preencha um exemplo curto, em uma linha, para cada variável.";
  }

  if (Object.keys(errors).length || !category) return { ok: false, errors };
  return {
    ok: true,
    draft: { name, category, header, headerMedia, headerHandle, body, footer, examples },
  };
}

/** Corpo do `POST /{WABA}/message_templates` da Graph API. */
export function templatePayload(draft: TemplateDraft) {
  return {
    name: draft.name,
    language: TEMPLATE_LANGUAGE,
    category: draft.category,
    components: [
      ...(draft.headerMedia
        ? [
            {
              type: "HEADER",
              format: draft.headerMedia,
              example: { header_handle: [draft.headerHandle] },
            },
          ]
        : draft.header
          ? [{ type: "HEADER", format: "TEXT", text: draft.header }]
          : []),
      {
        type: "BODY",
        text: draft.body,
        ...(draft.examples.length ? { example: { body_text: [draft.examples] } } : {}),
      },
      ...(draft.footer ? [{ type: "FOOTER", text: draft.footer }] : []),
    ],
  };
}

export type TemplatePayload = ReturnType<typeof templatePayload>;

/** Um modelo da conta como a tela mostra: inclusive os em análise e recusados. */
export type ManagedTemplate = {
  id: string;
  name: string;
  language: string;
  status: string;
  category: string;
  header: string;
  /** Imagem/vídeo/documento no topo; `null` = topo de texto ou sem topo. */
  headerMedia?: MediaFormat | null;
  body: string;
  footer: string;
  rejectedReason: string | null;
  /** Quando foi criado pelo fechai (a Meta não informa); `null` = desconhecido. */
  createdAt?: string | null;
};

export type MetaManagedTemplateRecord = {
  id?: string;
  name?: string;
  language?: string;
  status?: string;
  category?: string;
  rejected_reason?: string;
  components?: { type: string; format?: string; text?: string }[];
};

export function managedTemplate(raw: MetaManagedTemplateRecord): ManagedTemplate | null {
  if (!raw.id || !raw.name) return null;
  const reason = raw.rejected_reason && raw.rejected_reason !== "NONE" ? raw.rejected_reason : null;
  return {
    id: raw.id,
    name: raw.name,
    language: raw.language ?? "",
    status: raw.status ?? "",
    category: raw.category ?? "",
    header: raw.components?.find((c) => c.type === "HEADER")?.text ?? "",
    headerMedia: (() => {
      const format = raw.components?.find((c) => c.type === "HEADER")?.format;
      return isMediaFormat(format) ? format : null;
    })(),
    body: raw.components?.find((c) => c.type === "BODY")?.text ?? "",
    footer: raw.components?.find((c) => c.type === "FOOTER")?.text ?? "",
    rejectedReason: reason,
  };
}

/** Status da Meta em palavras da clínica, com o tom do selo. */
export function templateStatusLabel(status: string): {
  label: string;
  tone: "success" | "warn" | "danger" | "neutral";
} {
  switch (status) {
    case "APPROVED":
      return { label: "Aprovado", tone: "success" };
    case "PENDING":
    case "IN_APPEAL":
      return { label: "Em análise", tone: "warn" };
    case "REJECTED":
      return { label: "Recusado", tone: "danger" };
    case "PAUSED":
      return { label: "Pausado", tone: "warn" };
    case "DISABLED":
      return { label: "Desativado", tone: "danger" };
    default:
      return { label: status ? status.toLowerCase() : "sem status", tone: "neutral" };
  }
}

/**
 * Renumera as variáveis pela ordem em que aparecem (`{{3}} … {{1}}` vira
 * `{{1}} … {{2}}`). A mesma variável repetida continua com o mesmo número.
 * Devolve também o mapa novo → antigo, para a tela mover os exemplos junto.
 */
export function renumberVariables(body: string): { body: string; order: number[] } {
  const order: number[] = [];
  const next = body.replace(/{{(\d+)}}/g, (_, n) => {
    const old = Number(n);
    let index = order.indexOf(old);
    if (index < 0) index = order.push(old) - 1;
    return `{{${index + 1}}}`;
  });
  return { body: next, order };
}

/**
 * Tira variáveis do texto e arruma a pontuação em volta, para a "versão sem o
 * nome": `Oi {{1}}! Aqui…` → `Oi! Aqui…`; `Olá, {{1}}, tudo bem?` → `Olá, tudo
 * bem?`. As que sobram são renumeradas. É um ponto de partida: a pessoa revisa
 * no editor antes de mandar para a Meta.
 */
export function removeVariables(body: string, slots: number[]): string {
  let text = body;
  for (const n of slots) text = text.replace(new RegExp(`[ \\t]*\\{\\{${n}\\}\\}`, "g"), "");
  text = text
    .replace(/[ \t]+([,!?.;:])/g, "$1")
    .replace(/,\s*,/g, ",")
    .replace(/,\s*([!?.])/g, "$1")
    .replace(/([!?.])[ \t]*,/g, "$1")
    .split("\n")
    .map((line) => line.replace(/^[ \t]*,[ \t]*/, "").replace(/,[ \t]*$/, "").replace(/[ \t]{2,}/g, " ").trim())
    .join("\n")
    .trim();
  text = text.charAt(0).toUpperCase() + text.slice(1);
  return renumberVariables(text).body;
}

/** Variáveis fora de sequência (ex.: `{{1}}` e `{{3}}`) — dá para corrigir com um clique. */
export function variablesOutOfOrder(body: string): boolean {
  const seen = [...body.matchAll(/{{(\d+)}}/g)].map((m) => Number(m[1]));
  const firstSeen = [...new Set(seen)];
  return firstSeen.some((n, i) => n !== i + 1);
}

/** Nome sugerido a partir das primeiras palavras do texto, sem as variáveis. */
export function suggestTemplateName(body: string): string {
  const words = body
    .replace(/{{\d+}}/g, " ")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .match(/[a-z0-9]{3,}/g);
  return templateName((words ?? []).slice(0, 4).join("_"));
}

const PROMOTIONAL =
  /\b(desconto|promo[cç][aã]o|promocional|oferta|gr[aá]tis|cupom|imperd[ií]vel|black friday|liquida[cç][aã]o|aproveite|\d+\s?%)/i;

/**
 * Texto com cara de promoção numa categoria Utilidade: a Meta costuma recusar
 * ou trocar para Marketing. Só aviso — quem decide é a Meta.
 */
export function looksPromotional(text: string): boolean {
  return PROMOTIONAL.test(text);
}

export function templateCategoryLabel(category: string): string {
  return (
    { UTILITY: "Utilidade", MARKETING: "Marketing", AUTHENTICATION: "Autenticação" }[category] ??
    category
  );
}

/** Motivo de recusa da Meta em uma frase; código desconhecido vira texto genérico. */
export function templateRejectionLabel(reason: string): string {
  return (
    {
      INVALID_FORMAT: "Formato inválido. Revise as variáveis e o texto.",
      PROMOTIONAL: "A Meta considerou o texto promocional para a categoria escolhida.",
      TAG_CONTENT_MISMATCH: "O texto não combina com a categoria escolhida.",
      ABUSIVE_CONTENT: "A Meta considerou o conteúdo impróprio.",
      SCAM: "A Meta considerou o conteúdo enganoso.",
      INCORRECT_CATEGORY: "A categoria escolhida não combina com o texto.",
    }[reason] ?? "A Meta recusou o modelo. Revise o texto e crie outro com nome novo."
  );
}
