import { z } from "zod";

/** Ephemeral knowledge edit. Never accepted by a real-contact channel. */
export const sandboxDraftSchema = z.object({
  documentId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(500_000),
  baseTitle: z.string().max(200).default(""),
  baseContent: z.string().max(500_000).default(""),
  baseRevision: z.string().length(64).optional(),
});
export type SandboxDraft = z.infer<typeof sandboxDraftSchema>;
export type SandboxSource = { documentId: string; title: string; content: string; draft?: boolean };
export type SandboxInspection = { sources: SandboxSource[]; searched: boolean; instructions: string; tools: string[] };

export function cosineDistance(a: number[], b: number[]) {
  if (!a.length || a.length !== b.length) return 1;
  let product = 0, an = 0, bn = 0;
  for (let i = 0; i < a.length; i++) { product += a[i] * b[i]; an += a[i] ** 2; bn += b[i] ** 2; }
  return an && bn ? 1 - product / Math.sqrt(an * bn) : 1;
}
