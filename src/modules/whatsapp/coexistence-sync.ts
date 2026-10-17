export type SyncStep = { status: "unknown" | "requested"; requestId?: string };
export type CoexistenceSync = {
  phoneNumberId: string;
  contacts?: SyncStep;
  history?: SyncStep;
  offboardedAt?: string;
  lastRemovalAt?: number;
  previousRequests?: {
    contacts?: string;
    history?: string;
    offboardedAt: string;
  };
};

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function step(value: unknown): SyncStep | undefined {
  if (value === undefined) return;
  const record = object(value);
  return record?.status === "requested" &&
    typeof record.requestId === "string" &&
    record.requestId
    ? { status: "requested", requestId: record.requestId }
    : { status: "unknown" }; // Registro incompleto nunca autoriza outro pedido.
}

function parse(value: unknown, phoneNumberId: string): CoexistenceSync {
  const record = object(value);
  if (record?.phoneNumberId !== phoneNumberId) return { phoneNumberId };
  const contacts = step(record.contacts),
    history = step(record.history);
  return {
    phoneNumberId,
    ...(contacts ? { contacts } : {}),
    ...(history ? { history } : {}),
    ...(typeof record.offboardedAt === "string"
      ? { offboardedAt: record.offboardedAt }
      : {}),
    ...(typeof record.lastRemovalAt === "number"
      ? { lastRemovalAt: record.lastRemovalAt }
      : {}),
    ...(object(record.previousRequests)
      ? {
          previousRequests:
            record.previousRequests as CoexistenceSync["previousRequests"],
        }
      : {}),
  };
}

/** Só uma remoção confirmada pela Meta abre uma nova geração de pedidos. */
export function syncForOnboarding(
  value: unknown,
  phoneNumberId: string,
): CoexistenceSync {
  const prior = parse(value, phoneNumberId);
  if (!prior.offboardedAt) return prior;
  return {
    phoneNumberId,
    ...(prior.lastRemovalAt ? { lastRemovalAt: prior.lastRemovalAt } : {}),
    previousRequests: {
      ...(prior.contacts?.requestId
        ? { contacts: prior.contacts.requestId }
        : {}),
      ...(prior.history?.requestId ? { history: prior.history.requestId } : {}),
      offboardedAt: prior.offboardedAt,
    },
  };
}

export function hasPendingCoexistence(
  value: unknown,
  phoneNumberId: string,
): boolean {
  if (object(value)?.phoneNumberId !== phoneNumberId) return false;
  const sync = parse(value, phoneNumberId);
  return (
    Boolean(sync.offboardedAt) ||
    sync.contacts?.status !== "requested" ||
    sync.history?.status !== "requested"
  );
}

export function isRepeatedCoexistenceRemoval(
  value: unknown,
  time: unknown,
): boolean {
  const record = object(value);
  return (
    typeof time === "number" &&
    Number.isFinite(time) &&
    typeof record?.lastRemovalAt === "number" &&
    time <= record.lastRemovalAt
  );
}

export function markCoexistenceRemoved(
  value: unknown,
  time?: unknown,
): CoexistenceSync | null {
  const record = object(value);
  if (typeof record?.phoneNumberId !== "string") return null;
  return {
    ...parse(value, record.phoneNumberId),
    offboardedAt: new Date().toISOString(),
    ...(typeof time === "number" && Number.isFinite(time)
      ? { lastRemovalAt: time }
      : {}),
  };
}
