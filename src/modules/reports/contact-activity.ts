/** A contact enters the attended cohort only after inbound + a attributed reply. */
export type ActivityMessage = { id?: string; role: string; sentBy: string | null; createdAt: Date };

/**
 * Quem respondeu o contato depois da chegada, numa das três formas:
 * - `ai_only`: só o agente respondeu e não houve transbordo registrado;
 * - `ai_and_human`: o agente respondeu e uma pessoa também (ou o agente passou para a equipe);
 * - `human_only`: só a equipe respondeu, o agente não falou.
 * `ai_only` é exatamente o contrário de `contactWasTransferred`, então só IA + transferidas
 * continuam somando os atendidos.
 */
export type Resolution = "ai_only" | "ai_and_human" | "human_only";
export const RESOLUTION_LABEL: Record<Resolution, string> = {
  ai_only: "Só IA",
  ai_and_human: "IA + humano",
  human_only: "Só humano",
};

/**
 * `automated`: ids de mensagens que a conta enviou por operação registrada
 * (lembrete, disparo, follow-up). Elas não são resposta ao contato, mesmo
 * gravadas como da equipe — o disparo sai com `sentBy: "human"` e o eco de um
 * lembrete pode ter sido gravado assim. A prova é o id, nunca o texto.
 */
export function contactActivity<T extends ActivityMessage>(input: readonly T[], automated?: ReadonlySet<string>) {
  const messages = [...input].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const first = messages.find((m) => m.role === "user");
  const replies = first ? messages.filter((m) => m.role === "assistant"
    && (m.sentBy === "agent" || m.sentBy === "human") && m.createdAt >= first.createdAt
    && !(m.id && automated?.has(m.id))) : [];
  return { first, replies, messages };
}

export function contactWasTransferred(replies: readonly ActivityMessage[], handoffs: number) {
  return handoffs > 0 || replies.some((m) => m.sentBy === "human");
}

export function resolutionOf(replies: readonly ActivityMessage[], handoffs: number): Resolution | null {
  if (!replies.length) return null;
  if (!replies.some((m) => m.sentBy === "agent")) return "human_only";
  return contactWasTransferred(replies, handoffs) ? "ai_and_human" : "ai_only";
}

export function periodContactActivity(messages: readonly (ActivityMessage & { conversationId: string })[], handoffIds: readonly string[] = [],
  automated?: ReadonlySet<string>) {
  const grouped = new Map<string, typeof messages[number][]>();
  for (const m of messages) {
    const group = grouped.get(m.conversationId) ?? [];
    group.push(m);
    grouped.set(m.conversationId, group);
  }
  const contacts = new Map<string, ReturnType<typeof contactActivity>>();
  const handoffs = new Set(handoffIds);
  const active = new Set<string>(), attended = new Set<string>(), aiOnly = new Set<string>(), human = new Set<string>(), transferred = new Set<string>();
  const resolution = new Map<string, Resolution>();
  for (const [id, group] of grouped) {
    const contact = contactActivity(group, automated);
    const { first, replies } = contact;
    if (!first) continue;
    active.add(id);
    if (!replies.length) continue;
    attended.add(id);
    contacts.set(id, contact);
    if (replies.some((m) => m.sentBy === "human")) human.add(id);
    if (contactWasTransferred(replies, handoffs.has(id) ? 1 : 0)) transferred.add(id);
    else aiOnly.add(id);
    resolution.set(id, resolutionOf(replies, handoffs.has(id) ? 1 : 0)!);
  }
  return { active, attended, aiOnly, human, transferred, resolution, contacts, responseRate: active.size ? attended.size / active.size : 0 };
}
