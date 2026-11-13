import { randomUUID } from "node:crypto";
import { deleteFromBunny, isBunnyConfigured, uploadToBunny } from "@/lib/bunny";

/**
 * Arquivos da campanha na CDN (o mesmo armazenamento dos Disparos). O link é
 * público porque quem baixa é o provedor do WhatsApp (Evolution ou Meta), e o
 * caminho é aleatório por conta. Os limites são os da Meta, que é o mais
 * restrito dos dois: o arquivo que passa aqui sai pelos dois números.
 */

import {
  ASSET_KIND_LABEL,
  ASSET_RULES as RULES,
  EXT_MIME,
  type AssetKind,
} from "./asset-types";

export { ASSET_ACCEPT, ASSET_KIND_LABEL, ASSET_USAGE_LABEL, ASSET_USAGES, type AssetKind, type AssetUsage } from "./asset-types";

const MB = 1024 * 1024;

/** O tipo vem do navegador; sem ele (alguns celulares), pela extensão. */
function mimeOf(file: { name: string; type: string }): string | null {
  const type = file.type.split(";")[0].trim().toLowerCase();
  if (RULES[type]) return type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXT_MIME[ext] ?? null;
}

export function assetFileProblem(file: { name: string; type: string; size: number }): string | null {
  const mime = mimeOf(file);
  if (!mime) return "Envie imagem (JPG ou PNG), vídeo (MP4), PDF ou áudio (OGG, MP3, M4A ou AAC).";
  const rule = RULES[mime];
  if (file.size === 0) return "O arquivo está vazio.";
  if (file.size > rule.max) return `${ASSET_KIND_LABEL[rule.kind]} pode ter até ${Math.round(rule.max / MB)} MB.`;
  return null;
}

/** Nome para mostrar e para o documento no WhatsApp: sem caminho e sem controle. */
export function cleanAssetName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "arquivo";
  return base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120) || "arquivo";
}

export async function storeCampaignAsset(
  tenantId: string,
  file: File,
): Promise<{ ok: true; url: string; path: string; kind: AssetKind; mime: string } | { ok: false; error: string }> {
  const problem = assetFileProblem(file);
  if (problem) return { ok: false, error: problem };
  if (!isBunnyConfigured()) return { ok: false, error: "O armazenamento de arquivos não está configurado no servidor." };
  const mime = mimeOf(file)!;
  const rule = RULES[mime];
  const path = `campanhas/${tenantId}/${randomUUID()}.${rule.ext}`;
  const uploaded = await uploadToBunny(path, Buffer.from(await file.arrayBuffer()), mime);
  if (!uploaded.ok) return { ok: false, error: "Não foi possível guardar o arquivo agora. Tente de novo." };
  return { ok: true, url: uploaded.url, path, kind: rule.kind, mime };
}

/** Apaga da CDN; nunca lança (a linha já saiu do banco). */
export async function removeCampaignAssetFile(path: string | null): Promise<void> {
  if (!path) return;
  await deleteFromBunny(path).catch((err) => console.error("[campanhas] arquivo não apagado da CDN", path, err));
}
