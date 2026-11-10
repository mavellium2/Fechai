/**
 * Mídia nos Disparos: imagem, vídeo ou documento no topo da mensagem aprovada.
 *
 * A Meta só deixa iniciar conversa com modelo aprovado, e o modelo só aceita
 * mídia no cabeçalho, em três formatos: imagem, vídeo e documento. **Áudio não
 * existe em modelo** — só dentro das 24h abertas pelo contato —, então não é
 * oferecido aqui.
 *
 * Sem prisma nem rede: a tela e o servidor usam as mesmas regras.
 */

export const MEDIA_FORMATS = ["IMAGE", "VIDEO", "DOCUMENT"] as const;
export type MediaFormat = (typeof MEDIA_FORMATS)[number];

export function isMediaFormat(value: unknown): value is MediaFormat {
  return MEDIA_FORMATS.includes(value as MediaFormat);
}

const MB = 1024 * 1024;

/** Limites da Cloud API para cada formato (o documento fica abaixo do teto das actions). */
export const MEDIA_RULES: Record<
  MediaFormat,
  { label: string; tag: string; mimes: Record<string, string>; maxBytes: number; hint: string }
> = {
  IMAGE: {
    label: "Imagem",
    tag: "[Imagem]",
    mimes: { "image/jpeg": "jpg", "image/png": "png" },
    maxBytes: 5 * MB,
    hint: "JPG ou PNG, até 5 MB",
  },
  VIDEO: {
    label: "Vídeo",
    tag: "[Vídeo]",
    mimes: { "video/mp4": "mp4", "video/3gpp": "3gp" },
    maxBytes: 16 * MB,
    hint: "MP4, até 16 MB",
  },
  DOCUMENT: {
    label: "Documento",
    tag: "[Documento]",
    mimes: {
      "application/pdf": "pdf",
      "application/msword": "doc",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
      "application/vnd.ms-excel": "xls",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
      "application/vnd.ms-powerpoint": "ppt",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
      "text/plain": "txt",
    },
    maxBytes: 30 * MB,
    hint: "PDF, Word, Excel, PowerPoint ou TXT, até 30 MB",
  },
};

/** `accept` do `<input type="file">` para o formato. */
export function mediaAccept(format: MediaFormat): string {
  const rules = MEDIA_RULES[format];
  return [...Object.keys(rules.mimes), ...Object.values(rules.mimes).map((e) => `.${e}`)].join(",");
}

/**
 * Tipo do arquivo pelo `type` do navegador ou, quando ele vem vazio (comum no
 * Windows para .docx), pela extensão do nome.
 */
export function mediaMime(format: MediaFormat, file: { name: string; type: string }): string | null {
  const { mimes } = MEDIA_RULES[format];
  if (file.type && mimes[file.type]) return file.type;
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  if (extension === "jpeg" && format === "IMAGE") return "image/jpeg";
  return Object.entries(mimes).find(([, ext]) => ext === extension)?.[0] ?? null;
}

/** Problema do arquivo escolhido, em uma frase; `null` quando serve. */
export function mediaFileProblem(
  format: MediaFormat,
  file: { name: string; type: string; size: number },
): string | null {
  const rules = MEDIA_RULES[format];
  if (!file.size) return "O arquivo está vazio.";
  if (!mediaMime(format, file)) return `Formato não aceito para ${rules.label.toLowerCase()}. Use ${rules.hint}.`;
  if (file.size > rules.maxBytes) return `Arquivo grande demais. Use ${rules.hint}.`;
  return null;
}

/**
 * Link de arquivo vindo da planilha. Quem baixa é a Meta, não o fechai: só
 * precisa ser `https`, público e em uma linha.
 */
export function mediaLinkProblem(link: string): string | null {
  if (!link) return "Preencha o link do arquivo.";
  if (link.length > 1024 || /\s/.test(link)) return "Link do arquivo inválido.";
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return "Link do arquivo inválido. Use um endereço que comece com https://";
  }
  if (url.protocol !== "https:") return "O link do arquivo precisa começar com https://";
  if (url.username || url.password) return "O link do arquivo não pode ter usuário e senha.";
  return null;
}

/** Nome que o contato vê no documento: o fim do link, sem a query. */
export function mediaFilenameFromUrl(link: string): string | null {
  try {
    const last = decodeURIComponent(new URL(link).pathname.split("/").pop() ?? "").trim();
    return last ? last.slice(0, 120) : null;
  } catch {
    return null;
  }
}

/** Nome de arquivo limpo, para o documento e a tela. */
export function cleanFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
  return (cleaned || "arquivo").slice(0, 120);
}

/** O arquivo do disparo, guardado em `BroadcastCampaign.media`. */
export type CampaignMedia =
  | {
      format: MediaFormat;
      mode: "file";
      url: string;
      filename: string;
      mime: string;
      size: number;
    }
  | { format: MediaFormat; mode: "column"; column: string };

/** Arquivo enviado pela tela, antes de virar parte do disparo. */
export type UploadedMedia = Extract<CampaignMedia, { mode: "file" }>;

export function parseCampaignMedia(raw: unknown): CampaignMedia | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (!isMediaFormat(value.format)) return null;
  if (value.mode === "column" && typeof value.column === "string")
    return { format: value.format, mode: "column", column: value.column };
  if (
    value.mode === "file" &&
    typeof value.url === "string" &&
    typeof value.filename === "string" &&
    typeof value.mime === "string" &&
    typeof value.size === "number"
  )
    return {
      format: value.format,
      mode: "file",
      url: value.url,
      filename: value.filename,
      mime: value.mime,
      size: value.size,
    };
  return null;
}

/** "2,4 MB" */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}
