/**
 * Tipos, rótulos e limites das mídias da campanha, sem dependência de servidor:
 * a tela (componente de cliente) importa daqui. Upload e CDN ficam em `assets.ts`.
 */

export type AssetKind = "image" | "video" | "pdf" | "audio";
export type AssetUsage = "agent" | "broadcast" | "both";

export const ASSET_USAGES: AssetUsage[] = ["agent", "broadcast", "both"];
export const ASSET_USAGE_LABEL: Record<AssetUsage, string> = {
  agent: "Agente (na conversa)",
  broadcast: "Disparo",
  both: "Agente e disparo",
};
export const ASSET_KIND_LABEL: Record<AssetKind, string> = { image: "Imagem", video: "Vídeo", pdf: "PDF", audio: "Áudio" };

const MB = 1024 * 1024;

export const ASSET_RULES: Record<string, { kind: AssetKind; ext: string; max: number }> = {
  "image/jpeg": { kind: "image", ext: "jpg", max: 5 * MB },
  "image/png": { kind: "image", ext: "png", max: 5 * MB },
  "video/mp4": { kind: "video", ext: "mp4", max: 16 * MB },
  "application/pdf": { kind: "pdf", ext: "pdf", max: 100 * MB },
  "audio/ogg": { kind: "audio", ext: "ogg", max: 16 * MB },
  "audio/mpeg": { kind: "audio", ext: "mp3", max: 16 * MB },
  "audio/mp4": { kind: "audio", ext: "m4a", max: 16 * MB },
  "audio/aac": { kind: "audio", ext: "aac", max: 16 * MB },
};

/** O `accept` do `<input type="file">`. */
export const ASSET_ACCEPT = Object.keys(ASSET_RULES).join(",");

export const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  mp4: "video/mp4",
  pdf: "application/pdf",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
};

