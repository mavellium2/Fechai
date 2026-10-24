import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { recordChange, type RecordAuditInput } from "@/modules/audit/log";
import type { AuditEvent } from "@/modules/audit/events";
import { composeSystemPrompt, type PersonaAnswers } from "./persona";

/**
 * Núcleo de "salvar persona" e "salvar regras", compartilhado por três caminhos:
 *
 * - `savePersona` e `saveRules` do painel (`app/(dashboard)/agentes/actions.ts`);
 * - a aprovação de uma proposta de mudança do MCP (`app/(admin)/admin/agentes/propostas`).
 *
 * Existe para o comportamento ser UM só: o que a pessoa vê no painel e o que o
 * superadmin aplica ao aprovar uma proposta passam pelo mesmo cálculo do prompt,
 * pela mesma gravação e pelo mesmo evento de auditoria. Nenhuma ferramenta MCP
 * chama esta função — só a action de aprovação, depois de um humano decidir.
 */

/** Validação por campo. Fonte única: o painel usa o schema inteiro, o MCP o parcial. */
const PERSONA_FIELD_SCHEMAS = {
  agentName: z.string().trim(),
  businessName: z.string().trim().min(1, "Informe o nome do negócio"),
  sector: z.string().trim(),
  tone: z.string().trim(),
  writingStyle: z.string().trim(),
  offer: z.string().trim(),
  avoid: z.string().trim(),
  objective: z.string().trim(),
} satisfies Record<keyof PersonaAnswers, z.ZodType<string>>;

/** Formulário de persona do painel (o campo `avoid` mora no passo Regras). */
export const personaSchema = z.object({
  agentName: PERSONA_FIELD_SCHEMAS.agentName.default(""),
  businessName: PERSONA_FIELD_SCHEMAS.businessName,
  sector: PERSONA_FIELD_SCHEMAS.sector.default(""),
  tone: PERSONA_FIELD_SCHEMAS.tone.default(""),
  writingStyle: PERSONA_FIELD_SCHEMAS.writingStyle.default(""),
  offer: PERSONA_FIELD_SCHEMAS.offer.default(""),
  avoid: PERSONA_FIELD_SCHEMAS.avoid.default(""),
  objective: PERSONA_FIELD_SCHEMAS.objective.default(""),
});

export const rulesSchema = z.object({
  rules: z.string().trim().default(""),
});

/** Teto por campo nas propostas (o painel não tem; o MCP não deve entupir a fila de revisão). */
export const MAX_PROPOSAL_FIELD_CHARS = 4000;

/**
 * Mudanças de persona vindas do MCP: os mesmos validadores do painel, mas só os
 * campos presentes, sem `default` (campo ausente = não mexe) e sem chave extra.
 */
export const personaChangesSchema = z
  .object({
    agentName: PERSONA_FIELD_SCHEMAS.agentName.max(MAX_PROPOSAL_FIELD_CHARS),
    businessName: PERSONA_FIELD_SCHEMAS.businessName.max(MAX_PROPOSAL_FIELD_CHARS),
    sector: PERSONA_FIELD_SCHEMAS.sector.max(MAX_PROPOSAL_FIELD_CHARS),
    tone: PERSONA_FIELD_SCHEMAS.tone.max(MAX_PROPOSAL_FIELD_CHARS),
    writingStyle: PERSONA_FIELD_SCHEMAS.writingStyle.max(MAX_PROPOSAL_FIELD_CHARS),
    offer: PERSONA_FIELD_SCHEMAS.offer.max(MAX_PROPOSAL_FIELD_CHARS),
    avoid: PERSONA_FIELD_SCHEMAS.avoid.max(MAX_PROPOSAL_FIELD_CHARS),
    objective: PERSONA_FIELD_SCHEMAS.objective.max(MAX_PROPOSAL_FIELD_CHARS),
  })
  .partial()
  .strict();

export const PERSONA_ANSWER_KEYS = Object.keys(PERSONA_FIELD_SCHEMAS) as (keyof PersonaAnswers)[];

/** As oito respostas, com "" no que o rascunho não tem (agente antigo, `personaDraft` nulo). */
export function answersFromDraft(draft: unknown): PersonaAnswers {
  const source = (draft && typeof draft === "object" ? draft : {}) as Partial<Record<keyof PersonaAnswers, unknown>>;
  const out = {} as PersonaAnswers;
  for (const key of PERSONA_ANSWER_KEYS) {
    const value = source[key];
    out[key] = typeof value === "string" ? value : "";
  }
  return out;
}

type HashableAgent = {
  name: string;
  systemPrompt: string;
  objective: string;
  personaDraft: unknown;
};

/**
 * Impressão digital do que uma proposta de persona/regras mexe. Ordem de chaves
 * fixa: o mesmo estado sempre dá o mesmo hash. Mudou no painel depois da
 * proposta = outro hash = a proposta é `stale` e não se aplica.
 */
export function agentBaseHash(agent: HashableAgent): string {
  const canonical = JSON.stringify({
    name: agent.name,
    systemPrompt: agent.systemPrompt,
    objective: agent.objective,
    persona: PERSONA_ANSWER_KEYS.map((key) => answersFromDraft(agent.personaDraft)[key]),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export type PersonaActor = NonNullable<RecordAuditInput["actor"]> | null;

export type ApplyPersonaOptions = {
  /** Vai para o `meta` da auditoria (ex.: `{ via: "mcp", proposalId }`). */
  meta?: Record<string, unknown>;
  /**
   * Só a aprovação de proposta passa isto: recusa se o agente mudou desde a
   * proposta e grava com `updatedAt` na condição, para uma edição no meio do
   * caminho não ser sobrescrita.
   */
  expectedBaseHash?: string;
};

export type ApplyPersonaResult =
  | { ok: true; event: AuditEvent; systemPrompt: string }
  | { ok: false; reason: "not_found" | "stale" };

/**
 * Aplica respostas de persona e/ou regras num agente DA CONTA (`tenantId` na
 * consulta e na gravação).
 *
 * - Só `avoid` presente = "salvar regras" (não mexe em nome nem objetivo,
 *   evento `agent.rules_updated`).
 * - Qualquer outro campo = "salvar persona" (nome do agente na lista e objetivo
 *   acompanham a resposta, evento `agent.persona_updated`).
 * - Campos ausentes mantêm o que o rascunho já tinha.
 *
 * `actor`: `null` deixa a auditoria resolver quem agiu pela sessão (painel, com
 * personificação); um ator explícito é para caminhos que não são o dono da conta.
 * A auditoria nunca lança (ver `audit/log.ts`).
 */
export async function applyPersonaAnswers(
  tenantId: string,
  agentId: string,
  answers: Partial<PersonaAnswers>,
  actor: PersonaActor,
  options: ApplyPersonaOptions = {},
): Promise<ApplyPersonaResult> {
  const agent = await prisma.agent.findFirst({ where: { id: agentId, tenantId } });
  if (!agent) return { ok: false, reason: "not_found" };
  if (options.expectedBaseHash && agentBaseHash(agent) !== options.expectedBaseHash) {
    return { ok: false, reason: "stale" };
  }

  const given = Object.fromEntries(
    Object.entries(answers).filter(([, value]) => typeof value === "string"),
  ) as Partial<PersonaAnswers>;
  const merged: PersonaAnswers = { ...answersFromDraft(agent.personaDraft), ...given };
  const rulesOnly = Object.keys(given).length > 0 && Object.keys(given).every((key) => key === "avoid");
  const systemPrompt = composeSystemPrompt(merged);

  const next = rulesOnly
    ? { systemPrompt, personaDraft: merged }
    : {
        // O nome do agente na lista acompanha o que a pessoa respondeu no wizard.
        name: merged.agentName || agent.name,
        systemPrompt,
        objective: merged.objective,
        personaDraft: merged,
      };

  const updated = await prisma.agent.updateMany({
    where: {
      id: agent.id,
      tenantId,
      ...(options.expectedBaseHash ? { updatedAt: agent.updatedAt } : {}),
    },
    data: next,
  });
  if (updated.count === 0) {
    return { ok: false, reason: options.expectedBaseHash ? "stale" : "not_found" };
  }

  const event: AuditEvent = rulesOnly ? "agent.rules_updated" : "agent.persona_updated";
  await recordChange({
    event,
    target: { type: "Agent", id: agent.id, label: agent.name },
    before: rulesOnly
      ? { systemPrompt: agent.systemPrompt, personaDraft: agent.personaDraft }
      : {
          name: agent.name,
          systemPrompt: agent.systemPrompt,
          objective: agent.objective,
          personaDraft: agent.personaDraft,
        },
    after: next,
    meta: options.meta,
    tenantId,
    actor: actor ?? undefined,
  });

  return { ok: true, event, systemPrompt };
}
