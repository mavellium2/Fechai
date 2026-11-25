import type { LeadOriginChannel } from "@prisma/client";

export const CRM_ORIGIN_OPTIONS = {
  anuncio: "Anúncio",
  whatsapp_qr: "WhatsApp direto (QR)",
  whatsapp_meta: "WhatsApp direto (Meta)",
  widget: "Widget do site",
  manual: "Cadastro manual",
  broadcast: "Cadastro por disparo",
  desconhecida: "Origem não registrada",
} as const;

export function crmOriginFilter(value: unknown): keyof typeof CRM_ORIGIN_OPTIONS | "" {
  return typeof value === "string" && Object.hasOwn(CRM_ORIGIN_OPTIONS, value) ? value as keyof typeof CRM_ORIGIN_OPTIONS : "";
}

export function crmOriginLabel(channel: LeadOriginChannel | null, hasAd: boolean) {
  if (channel === "ad" || (!channel && hasAd)) return CRM_ORIGIN_OPTIONS.anuncio;
  return channel ? CRM_ORIGIN_OPTIONS[channel] : CRM_ORIGIN_OPTIONS.desconhecida;
}
