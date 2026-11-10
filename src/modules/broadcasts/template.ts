import { removeVariables } from "./template-draft";
import { isMediaFormat, MEDIA_RULES, type MediaFormat } from "./media";
/**
 * Template aprovado com variáveis posicionais no corpo. O topo é texto fixo ou,
 * com `mediaFormat`, uma imagem/vídeo/documento escolhido a cada envio.
 */
export type BroadcastTemplate = {
  id: string;
  name: string;
  language: string;
  body: string;
  header: string;
  footer: string;
  parameterCount: number;
  /** Mídia no topo. Ausente = topo de texto (ou sem topo). */
  mediaFormat?: MediaFormat;
};

export type MetaTemplateRecord = {
  id?: string;
  name?: string;
  language?: string;
  status?: string;
  parameter_format?: string;
  components?: { type: string; format?: string; text?: string }[];
};

/** PostgreSQL JsonB reordena chaves: comparar JSON.stringify cancelaria rascunhos válidos. */
export function sameBroadcastTemplate(
  left: BroadcastTemplate,
  right: BroadcastTemplate,
): boolean {
  return (
    [
      "id",
      "name",
      "language",
      "body",
      "header",
      "footer",
      "parameterCount",
    ] as const
  ).every((field) => left[field] === right[field]) &&
    (left.mediaFormat ?? null) === (right.mediaFormat ?? null);
}

/**
 * O que os Disparos e os lembretes sabem enviar. `media: true` aceita também
 * imagem/vídeo/documento no topo — só os Disparos pedem: o lembrete não tem de
 * onde tirar o arquivo, e um modelo de mídia nele seria recusado no envio.
 */
export function supportedTemplate(
  raw: MetaTemplateRecord,
  options: { media?: boolean } = {},
): BroadcastTemplate | null {
  if (
    raw.status !== "APPROVED" ||
    !raw.id ||
    !raw.name ||
    !raw.language ||
    raw.parameter_format === "NAMED"
  )
    return null;
  const components = raw.components ?? [];
  if (components.some((c) => !["BODY", "HEADER", "FOOTER"].includes(c.type)))
    return null;
  const header = components.find((c) => c.type === "HEADER");
  const footer = components.find((c) => c.type === "FOOTER")?.text ?? "";
  const mediaFormat =
    header && options.media && isMediaFormat(header.format) ? header.format : undefined;
  if (
    header &&
    !mediaFormat &&
    (header.format !== "TEXT" || /{{/.test(header.text ?? ""))
  )
    return null;
  if (/{{/.test(footer)) return null;
  const body = components.find((c) => c.type === "BODY")?.text;
  if (!body) return null;
  const slots = [
    ...new Set([...body.matchAll(/{{(\d+)}}/g)].map((m) => Number(m[1]))),
  ].sort((a, b) => a - b);
  if (
    slots.length > 20 ||
    slots.some((slot, i) => slot !== i + 1) ||
    /{{|}}/.test(body.replace(/{{\d+}}/g, ""))
  )
    return null;
  return {
    id: raw.id,
    name: raw.name,
    language: raw.language,
    body,
    header: mediaFormat ? "" : (header?.text ?? ""),
    footer,
    parameterCount: slots.length,
    ...(mediaFormat ? { mediaFormat } : {}),
  };
}

export function renderBroadcast(
  template: BroadcastTemplate,
  parameters: string[],
): string {
  if (parameters.length !== template.parameterCount)
    throw new Error("Quantidade de variáveis diferente do template.");
  return [
    template.mediaFormat ? MEDIA_RULES[template.mediaFormat].tag : template.header,
    template.body.replace(
      /{{(\d+)}}/g,
      (_, index) => parameters[Number(index) - 1],
    ),
    template.footer,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** A mensagem que um contato recebe: a do disparo ou a versão sem nome. */
export function recipientTemplate(
  campaign: { template: unknown; namelessTemplate?: unknown },
  recipient: { variant?: string | null },
): BroadcastTemplate {
  return (
    recipient.variant === "nameless" && campaign.namelessTemplate
      ? campaign.namelessTemplate
      : campaign.template
  ) as BroadcastTemplate;
}

/** Todas as mensagens que o disparo usa — todas precisam seguir aprovadas. */
export function campaignTemplates(campaign: {
  template: unknown;
  namelessTemplate?: unknown;
}): BroadcastTemplate[] {
  return [campaign.template, campaign.namelessTemplate].filter(Boolean) as BroadcastTemplate[];
}

/** Confere se cada mensagem do disparo continua aprovada e igual na Meta. */
export function templatesStillApproved(
  saved: BroadcastTemplate[],
  approved: BroadcastTemplate[],
): boolean {
  return saved.every((t) => {
    const current = approved.find((a) => a.id === t.id);
    return Boolean(current && sameBroadcastTemplate(current, t));
  });
}

/**
 * A versão sem nome de uma mensagem, entre as aprovadas: a criada pelo botão
 * "Criar versão sem o nome" (nome `<original>_sem_nome`) ou qualquer outra com
 * o mesmo texto sem as variáveis de nome.
 */
export function findNamelessVersion(
  main: BroadcastTemplate,
  approved: BroadcastTemplate[],
  slots: number[],
): BroadcastTemplate | undefined {
  if (!slots.length) return undefined;
  const body = removeVariables(main.body, slots);
  const expected = main.parameterCount - slots.length;
  return approved.find(
    (t) =>
      t.id !== main.id &&
      t.parameterCount === expected &&
      (t.mediaFormat ?? null) === (main.mediaFormat ?? null) &&
      (t.name === `${main.name}_sem_nome` ||
        (t.body === body && t.header === main.header && t.footer === main.footer)),
  );
}
