"use server";

import { revalidatePath } from "next/cache";
import { requireBroadcastAccess } from "@/modules/broadcasts/access";
import { getBroadcastConnection } from "@/modules/broadcasts/connection";
import {
  templatePayload,
  validateTemplateDraft,
  type ManagedTemplate,
  type TemplateDraftErrors,
} from "@/modules/broadcasts/template-draft";
import { MetaTemplateRejected } from "@/modules/whatsapp/meta";

const NOT_CONNECTED =
  "Conecte a API oficial da Meta em Integrações para criar modelos.";

/** Lista para o botão "Atualizar status": a Meta decide a aprovação depois do envio. */
export async function listMessageTemplates(): Promise<
  { ok: true; templates: ManagedTemplate[] } | { ok: false; error: string }
> {
  const tenantId = await requireBroadcastAccess();
  const connection = await getBroadcastConnection(tenantId);
  if (!connection) return { ok: false, error: NOT_CONNECTED };
  try {
    return { ok: true, templates: await connection.provider.listManagedTemplates() };
  } catch (error) {
    console.error("[modelos] falha ao listar modelos da Meta", error);
    return {
      ok: false,
      error: "Não foi possível consultar os modelos na Meta. Tente de novo em instantes.",
    };
  }
}

export type CreateTemplateState = {
  ok?: boolean;
  error?: string;
  info?: string;
  code?: "validation" | "server";
  errors?: TemplateDraftErrors;
} | null;

/**
 * Cria o modelo na conta do WhatsApp da clínica e o envia para análise da Meta.
 * O tenant vem da sessão e a conexão é a Meta da própria conta — o formulário
 * não escolhe conta nem token.
 */
export async function createMessageTemplate(
  _prev: CreateTemplateState,
  form: FormData,
): Promise<CreateTemplateState> {
  const tenantId = await requireBroadcastAccess();
  const checked = validateTemplateDraft({
    name: form.get("name"),
    category: form.get("category"),
    header: form.get("header"),
    body: form.get("body"),
    footer: form.get("footer"),
    examples: form.getAll("examples"),
  });
  if (!checked.ok) {
    return {
      ok: false,
      code: "validation",
      error: "Revise os campos destacados.",
      errors: checked.errors,
    };
  }

  const connection = await getBroadcastConnection(tenantId);
  if (!connection) return { ok: false, error: NOT_CONNECTED };

  try {
    const created = await connection.provider.createMessageTemplate(
      templatePayload(checked.draft),
    );
    revalidatePath("/disparos/modelos");
    return {
      ok: true,
      info:
        created.status === "APPROVED"
          ? `Modelo ${checked.draft.name} aprovado pela Meta.`
          : `Modelo ${checked.draft.name} enviado. A Meta costuma responder em minutos ou algumas horas.`,
    };
  } catch (error) {
    if (error instanceof MetaTemplateRejected) {
      return { ok: false, code: "validation", error: error.message };
    }
    console.error("[modelos] falha ao criar modelo na Meta", error);
    return {
      ok: false,
      code: "server",
      error: "A Meta não confirmou o envio do modelo. Atualize a lista antes de tentar de novo.",
    };
  }
}
