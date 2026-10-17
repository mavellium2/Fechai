export type SignupAssets = { wabaId: string; phoneNumberId?: string };
export type SignupEvent =
  | { kind: "finish"; assets: SignupAssets }
  | { kind: "cancel" | "error" };
const id = (value: unknown): value is string =>
  typeof value === "string" && /^\d{5,30}$/.test(value);

/** O evento é uma indicação; o servidor ainda confere os ativos na Graph API. */
export function readEmbeddedSignupEvent(
  origin: string,
  raw: unknown,
): SignupEvent | null {
  try {
    const url = new URL(origin);
    if (
      url.protocol !== "https:" ||
      url.port ||
      !(
        url.hostname === "facebook.com" ||
        url.hostname.endsWith(".facebook.com")
      )
    )
      return null;
    const event = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!event || event.type !== "WA_EMBEDDED_SIGNUP") return null;
    if (event.event === "CANCEL") return { kind: "cancel" };
    if (event.event === "ERROR") return { kind: "error" };
    // Este botão integra o app Business existente; outros fluxos não fazem register aqui.
    if (
      event.event !== "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" ||
      !id(event.data?.waba_id)
    )
      return null;
    const phone = event.data?.phone_number_id;
    if (phone !== undefined && !id(phone)) return null;
    return {
      kind: "finish",
      assets: { wabaId: event.data.waba_id, phoneNumberId: phone },
    };
  } catch {
    return null;
  }
}
