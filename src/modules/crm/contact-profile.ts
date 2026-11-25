import { prisma } from "@/lib/prisma";
import { allVariableDefinitions } from "@/modules/agent-engine/variable-definitions";
import { parseConversationVariables, parseVariableDefinitions } from "@/modules/agent-engine/variables";
import { lockCrmAdmission } from "./admission";
import { realBoardLeads } from "./lead-scope";
import { recordCrmTrail } from "./trail";
import { CONTACT_NAME_MAX, CONTACT_VALUE_MAX, type ContactProfileData, type ContactProfileField } from "./contact-profile-shape";

/**
 * Dados do contato editáveis pela equipe (CRM e Contatos), sem perder o
 * original do WhatsApp:
 *
 * - **Original, só leitura:** `Lead.whatsappName` (nome do perfil, gravado pelo
 *   webhook) e `Lead.phone` (identidade no WhatsApp, por onde tudo sai).
 * - **O que vale:** `Lead.name` e as variáveis da conversa. Editado pela
 *   equipe, vira "travado" (`Lead.nameEditedAt`, `Conversation.editedVariables`)
 *   e o agente, o resumo e o webhook não sobrescrevem mais.
 * - **Em branco destrava:** o nome volta ao do WhatsApp e a variável volta a
 *   ser preenchida pelo agente.
 *
 * {{nome}} e o nome do contato são a mesma informação: editar o nome grava a
 * variável junto. {{numero}} vem do telefone e não é editável.
 */

const FIXED_KEYS = new Set(["nome", "numero"]);
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export type ContactProfileInput = { name: string; variables: Record<string, string> };
export type ContactProfileVia = "crm" | "contatos";

/** Os dados que o formulário mostra: original do WhatsApp + o que vale. */
export function contactProfileData(lead: {
  name: string | null; whatsappName: string | null; nameEditedAt: Date | null; phone: string;
  conversation: { variables: unknown; editedVariables: string[] } | null;
}, definitions: unknown): ContactProfileData {
  return {
    name: lead.name ?? "",
    nameEdited: Boolean(lead.nameEditedAt),
    whatsappName: lead.whatsappName,
    phone: lead.phone,
    fields: lead.conversation ? contactProfileFields(definitions, lead.conversation.variables, lead.conversation.editedVariables) : null,
  };
}

/** Campos de variável que a tela mostra para edição (sem {{nome}} e {{numero}}). */
export function contactProfileFields(
  definitions: unknown,
  variables: unknown,
  editedVariables: string[],
): ContactProfileField[] {
  const values = parseConversationVariables(variables);
  return allVariableDefinitions(parseVariableDefinitions(definitions))
    .filter(({ key }) => !FIXED_KEYS.has(key))
    .map(({ key, description }) => ({ key, description, value: values[key] ?? "", edited: editedVariables.includes(key) }));
}

/** Lê o formulário: `name` e um `var:<chave>` por variável. Valida formato, não permissão. */
export function readContactProfileForm(form: FormData): ContactProfileInput | { error: string } {
  const rawName = form.get("name");
  const name = typeof rawName === "string" ? rawName.trim().replace(/\s+/g, " ") : "";
  if (name.length > CONTACT_NAME_MAX || CONTROL.test(name)) return { error: `Use um nome de até ${CONTACT_NAME_MAX} caracteres.` };
  const variables: Record<string, string> = {};
  for (const [field, raw] of form.entries()) {
    if (!field.startsWith("var:") || typeof raw !== "string") continue;
    const key = field.slice(4);
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(key) || FIXED_KEYS.has(key)) continue;
    const value = raw.trim();
    if (value.length > CONTACT_VALUE_MAX || CONTROL.test(value)) return { error: `Use até ${CONTACT_VALUE_MAX} caracteres em {{${key}}}.` };
    if (/\{\{|\}\}/.test(value)) return { error: `Não use chaves duplas ({{ }}) em {{${key}}}.` };
    variables[key] = value;
  }
  return { name, variables };
}

export type ContactProfileResult = { status: "ok"; fields: string[] } | { status: "unavailable" };

export async function editContactProfile(input: {
  tenantId: string;
  leadId: string;
  profile: ContactProfileInput;
  via: ContactProfileVia;
  actorUserId?: string;
}): Promise<ContactProfileResult> {
  const { tenantId, leadId, profile, via } = input;
  const result = await prisma.$transaction(async (db): Promise<ContactProfileResult> => {
    if (via === "crm") await lockCrmAdmission(db, tenantId, "shared");
    const lead = await db.lead.findFirst({
      where: via === "crm" ? { ...realBoardLeads(tenantId), id: leadId } : { tenantId, id: leadId, isTest: false },
      select: {
        id: true, name: true, whatsappName: true, nameEditedAt: true,
        conversation: { select: {
          id: true, tenantId: true, variables: true, editedVariables: true,
          agent: { select: { tenantId: true, variableDefinitions: true } },
        } },
      },
    });
    if (!lead) return { status: "unavailable" };
    const changed: string[] = [];

    // Nome: só trava quando muda. Em branco volta ao do WhatsApp e destrava.
    const typed = profile.name || null;
    let nameData: { name: string | null; nameEditedAt: Date | null } | null = null;
    if (typed && typed !== lead.name) nameData = { name: typed, nameEditedAt: new Date() };
    if (!typed && (lead.nameEditedAt || lead.name !== lead.whatsappName)) {
      nameData = { name: lead.whatsappName, nameEditedAt: null };
    }
    if (nameData) {
      await db.lead.update({ where: { id: lead.id }, data: nameData });
      changed.push("nome");
    }

    const conversation = lead.conversation?.tenantId === tenantId ? lead.conversation : null;
    if (conversation) {
      const definitions = conversation.agent?.tenantId === tenantId ? conversation.agent.variableDefinitions : null;
      const allowed = new Set(allVariableDefinitions(parseVariableDefinitions(definitions)).map(({ key }) => key));
      const values = parseConversationVariables(conversation.variables);
      const edited = new Set(conversation.editedVariables);
      for (const [key, value] of Object.entries(profile.variables)) {
        if (!allowed.has(key)) continue;
        if (value) {
          if (value === values[key]) continue;
          values[key] = value;
          edited.add(key);
        } else {
          if (!values[key] && !edited.has(key)) continue;
          delete values[key];
          edited.delete(key);
        }
        changed.push(key);
      }
      if (nameData?.nameEditedAt && nameData.name) {
        values.nome = nameData.name;
        edited.add("nome");
      } else if (nameData) {
        // Destravou: o {{nome}} da equipe sai e o agente volta a perguntar/guardar.
        if (edited.has("nome")) delete values.nome;
        edited.delete("nome");
      }
      if (changed.length) {
        // SQL cru: `updatedAt` da conversa ordena a caixa de entrada, e editar
        // um dado do contato não é atividade da conversa (mesma regra do resumo).
        await db.$executeRaw`
          UPDATE "Conversation"
          SET "variables" = ${JSON.stringify(values)}::jsonb,
              "editedVariables" = ${[...edited]}::text[]
          WHERE "id" = ${conversation.id} AND "tenantId" = ${tenantId}
        `;
      }
    }
    return { status: "ok", fields: changed };
  });

  if (result.status === "ok" && result.fields.length && input.actorUserId) {
    // Só as chaves: o valor digitado (nome, endereço) nunca vai para a trilha.
    await recordCrmTrail({ tenantId, leadId, event: "crm.contact_edited",
      actor: { kind: "user", userId: input.actorUserId }, meta: { fields: result.fields.join(","), via } });
  }
  return result;
}
