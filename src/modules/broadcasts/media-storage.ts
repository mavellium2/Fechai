import { randomUUID } from "node:crypto";
import { isBunnyConfigured, uploadToBunny } from "@/lib/bunny";
import {
  cleanFilename,
  mediaFileProblem,
  mediaMime,
  MEDIA_RULES,
  parseCampaignMedia,
  type CampaignMedia,
  type MediaFormat,
  type UploadedMedia,
} from "./media";
import { isBroadcastSimulation } from "./simulation";

/**
 * Arquivo único do disparo ("o mesmo para todos"). Fica na CDN, num caminho
 * aleatório por conta, porque quem baixa é a Meta e ela pede um link público
 * (o id de mídia da Meta vence em 30 dias — um disparo pausado ou agendado
 * para longe ficaria sem arquivo).
 *
 * Na Meta simulada sem CDN configurada, o link é falso: nada sai para a
 * internet, então ninguém tenta baixá-lo.
 */
const SIMULATED_HOST = "simulado.invalid";

function baseUrl(): string | null {
  if (isBunnyConfigured()) return `https://${process.env.BUNNY_PULL_ZONE}`;
  return isBroadcastSimulation() ? `https://${SIMULATED_HOST}` : null;
}

function prefix(tenantId: string): string | null {
  const base = baseUrl();
  return base ? `${base}/disparos/${tenantId}/` : null;
}

export async function storeBroadcastMedia(
  tenantId: string,
  format: MediaFormat,
  file: File,
): Promise<{ ok: true; media: UploadedMedia } | { ok: false; error: string }> {
  const problem = mediaFileProblem(format, file);
  if (problem) return { ok: false, error: problem };
  const mime = mediaMime(format, file)!;
  const path = `disparos/${tenantId}/${randomUUID()}.${MEDIA_RULES[format].mimes[mime]}`;
  const filename = cleanFilename(file.name);
  if (!isBunnyConfigured()) {
    if (!isBroadcastSimulation())
      return {
        ok: false,
        error: "O armazenamento de arquivos não está configurado no servidor. Use o link por contato na planilha.",
      };
    return {
      ok: true,
      media: { format, mode: "file", url: `https://${SIMULATED_HOST}/${path}`, filename, mime, size: file.size },
    };
  }
  const uploaded = await uploadToBunny(path, Buffer.from(await file.arrayBuffer()), mime);
  if (!uploaded.ok)
    return { ok: false, error: "Não foi possível guardar o arquivo agora. Tente de novo." };
  return { ok: true, media: { format, mode: "file", url: uploaded.url, filename, mime, size: file.size } };
}

/**
 * Confere o arquivo que a tela devolveu: só vale o que foi enviado por esta
 * conta, no formato da mensagem. Coluna da planilha só com `allowColumn`.
 */
export function checkBroadcastMedia(
  tenantId: string,
  format: MediaFormat,
  raw: unknown,
  options: { column?: string } = {},
): { ok: true; media: CampaignMedia } | { ok: false; error: string } {
  const media = parseCampaignMedia(raw);
  if (media?.mode === "column") {
    if (!options.column)
      return { ok: false, error: "Escolha a coluna da planilha com o link do arquivo." };
    return { ok: true, media: { format, mode: "column", column: options.column } };
  }
  const own = prefix(tenantId);
  if (
    !media ||
    media.format !== format ||
    !own ||
    !media.url.startsWith(own) ||
    !MEDIA_RULES[format].mimes[media.mime]
  )
    return {
      ok: false,
      error: `Envie ${format === "IMAGE" ? "a imagem" : format === "VIDEO" ? "o vídeo" : "o documento"} do topo da mensagem.`,
    };
  return { ok: true, media };
}
