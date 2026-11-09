import type { BroadcastSummary } from "@/modules/broadcasts/queries";

export type Tone = "neutral" | "iris" | "signal" | "success" | "warn" | "danger";

/** Situação do disparo em palavras de quem usa, não da fila. */
export function campaignStatus(c: Pick<BroadcastSummary, "status" | "scheduledAt" | "nextAttemptAt">): {
  label: string;
  tone: Tone;
} {
  switch (c.status) {
    case "draft":
      return { label: "Rascunho", tone: "neutral" };
    case "queued":
      return c.scheduledAt && new Date(c.scheduledAt).getTime() > Date.now()
        ? { label: "Agendado", tone: "iris" }
        : { label: "Enviando", tone: "iris" };
    case "paused":
      return { label: "Pausado", tone: "warn" };
    case "completed":
      return { label: "Concluído", tone: "success" };
    case "cancelled":
      return { label: "Cancelado", tone: "neutral" };
    default:
      return { label: c.status, tone: "neutral" };
  }
}

export const CAMPAIGN_FILTERS = [
  { value: "", label: "Todas as situações" },
  { value: "draft", label: "Rascunhos" },
  { value: "queued", label: "Enviando" },
  { value: "paused", label: "Pausados" },
  { value: "completed", label: "Concluídos" },
  { value: "cancelled", label: "Cancelados" },
] as const;

type RecipientLike = {
  status: string;
  deliveryStatus?: string | null;
  repliedAt?: Date | string | null;
};

/** Resultado de um contato: o estágio mais avançado que se sabe. */
export function recipientResult(r: RecipientLike): { label: string; tone: Tone } {
  if (r.repliedAt) return { label: "Respondeu", tone: "success" };
  if (r.status === "sent") {
    if (r.deliveryStatus === "read") return { label: "Lido", tone: "success" };
    if (r.deliveryStatus === "delivered") return { label: "Entregue", tone: "iris" };
    if (r.deliveryStatus === "failed") return { label: "Não entregue", tone: "danger" };
    return { label: "Enviado", tone: "iris" };
  }
  switch (r.status) {
    case "pending":
      return { label: "Aguardando", tone: "neutral" };
    case "sending":
      return { label: "Enviando", tone: "neutral" };
    case "failed":
      return { label: "Não enviado", tone: "danger" };
    case "unknown":
      return { label: "Conferir", tone: "warn" };
    case "skipped":
      return { label: "Ignorado", tone: "warn" };
    case "cancelled":
      return { label: "Cancelado", tone: "neutral" };
    default:
      return { label: r.status, tone: "neutral" };
  }
}

/** Explicação curta para quem vê "Conferir" ou "Ignorado". */
export const RESULT_HINT: Record<string, string> = {
  Conferir:
    "Não sabemos se a Meta recebeu (a conexão caiu no meio). Não reenviamos sozinhos para não mandar duas vezes.",
  Ignorado: "Número bloqueado na conta ou contato que pediu para não receber.",
  "Não enviado": "A Meta recusou o envio. Veja o motivo ao lado.",
  "Não entregue": "A Meta aceitou, mas não conseguiu entregar no aparelho.",
};

export const RECIPIENT_FILTERS = [
  { value: "all", label: "Todos" },
  { value: "waiting", label: "Aguardando" },
  { value: "sent", label: "Enviados" },
  { value: "read", label: "Lidos" },
  { value: "replied", label: "Responderam" },
  { value: "problem", label: "Com problema" },
] as const;
export type RecipientFilter = (typeof RECIPIENT_FILTERS)[number]["value"];

export function matchesRecipientFilter(r: RecipientLike, filter: RecipientFilter): boolean {
  switch (filter) {
    case "waiting":
      return r.status === "pending" || r.status === "sending";
    case "sent":
      return r.status === "sent";
    case "read":
      return r.deliveryStatus === "read";
    case "replied":
      return Boolean(r.repliedAt);
    case "problem":
      return (
        ["failed", "unknown", "skipped"].includes(r.status) ||
        r.deliveryStatus === "failed"
      );
    default:
      return true;
  }
}

export const minuteLabel = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

export function formatPhone(phone: string): string {
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(phone);
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : `+${phone}`;
}

export function formatDate(iso: string | null, timeZone = "America/Sao_Paulo") {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
