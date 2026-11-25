import { z } from "zod";
import { MAX_GROUP_NAME, MAX_GROUP_REASON, normalizeGroupId, type HandoffConfig } from "./handoff";

/**
 * O formulário da ação "Transferir para humano" (`HandoffSettings`). Mora fora
 * da action para o teste usar a mesma regra em vez de uma cópia.
 */
export const handoffConfigSchema = z
  .object({
    // O input oculto em `HandoffSettings` manda "on" ou "". Comparação
    // explícita em vez de `z.coerce.boolean()`, que considera verdadeira
    // QUALQUER string não vazia — inclusive "false" e "off", o que inverteria
    // o desligado em silêncio se a tela um dia passasse a mandar esses valores.
    notifyGroup: z
      .string()
      .optional()
      .transform((v) => v === "on" || v === "true"),
    groupId: z.string().trim().optional().default(""),
    groupName: z.string().trim().optional().default(""),
    groupReason: z
      .string()
      .trim()
      .max(MAX_GROUP_REASON, `O motivo pode ter até ${MAX_GROUP_REASON} caracteres.`)
      .optional()
      .default(""),
    // Sem o campo (formulário antigo em cache), a IA continua respondendo.
    whileWaiting: z.enum(["continue", "pause"], { message: "Escolha o que a IA faz enquanto aguarda a equipe." })
      .optional()
      .default("continue"),
  })
  // A recusa vem ANTES da normalização, não depois: se `transform` rodasse
  // primeiro, um ID inválido já teria virado `notifyGroup: false` e o `refine`
  // olharia para um objeto coerente — a tela diria "salvo" com a opção
  // silenciosamente desligada, que é justamente o que o campo obrigatório
  // deveria impedir.
  .superRefine((data, ctx) => {
    if (data.notifyGroup && !normalizeGroupId(data.groupId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["groupId"],
        message: "Escolha o grupo do WhatsApp (ou cole o ID dele) ou desligue a opção.",
      });
    }
  })
  // Desligado, grupo e motivo continuam gravados: desligar é pausar, não
  // descadastrar. Antes o grupo virava null aqui, e o campo escondido que a
  // tela mantinha no envio justamente para preservá-lo não servia de nada.
  .transform((data): HandoffConfig => {
    const groupId = normalizeGroupId(data.groupId);
    return {
      notifyGroup: data.notifyGroup && Boolean(groupId),
      groupId,
      groupName: groupId && data.groupName ? data.groupName.slice(0, MAX_GROUP_NAME) : null,
      groupReason: data.groupReason,
      whileWaiting: data.whileWaiting,
    };
  });
