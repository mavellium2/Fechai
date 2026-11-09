"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  requireBroadcastActor,
  requireBroadcastAccess,
} from "@/modules/broadcasts/access";
import { getBroadcastConnection } from "@/modules/broadcasts/connection";
import {
  inspectBroadcastFile,
  parseBroadcastFile,
  parseBroadcastRows,
  type ColumnMapping,
  type ImportResult,
} from "@/modules/broadcasts/import";
import {
  listBroadcastPage,
  type BroadcastFilter,
} from "@/modules/broadcasts/queries";
import {
  sameBroadcastTemplate,
  type BroadcastTemplate,
} from "@/modules/broadcasts/template";
import ExcelJS from "exceljs";
import {
  parseBroadcastSchedule,
  nextBroadcastTime,
  type ScheduleInput,
} from "@/modules/broadcasts/schedule";
import { normalizeBroadcastPhone } from "@/modules/broadcasts/phone";
import { sendBroadcastRecipient } from "@/modules/broadcasts/send";
import { recentlyContacted } from "@/modules/broadcasts/recent";
import { broadcastCsv } from "@/modules/broadcasts/csv";

export async function loadBroadcastTemplates() {
  const tenantId = await requireBroadcastAccess();
  const connection = await getBroadcastConnection(tenantId);
  if (!connection)
    return {
      ok: false as const,
      error:
        "Conecte a API oficial da Meta em Integrações para preparar disparos.",
    };
  try {
    return {
      ok: true as const,
      templates: await connection.provider.listBroadcastTemplates(),
    };
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof Error
          ? error.message
          : "Não foi possível carregar os templates.",
    };
  }
}

export async function prepareBroadcast(form: FormData) {
  const tenantId = await requireBroadcastAccess();
  const name = String(form.get("name") ?? "").trim();
  const templateId = String(form.get("templateId") ?? "");
  const file = form.get("file");
  if (!name || name.length > 100)
    return {
      ok: false as const,
      error: "Dê um nome ao disparo (até 100 caracteres).",
    };
  if (!(file instanceof File))
    return { ok: false as const, error: "Selecione um arquivo Excel ou JSON." };
  const connection = await getBroadcastConnection(tenantId);
  if (!connection)
    return {
      ok: false as const,
      error: "Conecte a API oficial da Meta em Integrações.",
    };
  let template: BroadcastTemplate | undefined;
  let parsed: Awaited<ReturnType<typeof parseBroadcastFile>>;
  try {
    template = (await connection.provider.listBroadcastTemplates()).find(
      (t) => t.id === templateId,
    );
    if (!template)
      return {
        ok: false as const,
        error: "Selecione um template aprovado e compatível. Atualize a lista.",
      };
    const mapping = form.get("mapping");
    parsed = await parseBroadcastFile(
      file,
      template,
      mapping ? (JSON.parse(String(mapping)) as ColumnMapping) : undefined,
    );
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof Error
          ? error.message
          : "Não foi possível ler o arquivo.",
    };
  }
  return createBroadcastDraft(tenantId, connection, name, template, parsed);
}

/** Rascunho a partir de uma lista já validada — arquivo e digitação passam aqui. */
async function createBroadcastDraft(
  tenantId: string,
  connection: NonNullable<Awaited<ReturnType<typeof getBroadcastConnection>>>,
  name: string,
  template: BroadcastTemplate,
  parsed: ImportResult,
) {
  // Nunca descarta erros silenciosamente nem envia só parte de uma lista inválida.
  if (parsed.issues.length)
    return {
      ok: false as const,
      error: `Corrija as ${parsed.issues.length} linhas inválidas antes de continuar.`,
      issues: parsed.issues,
    };
  if (!parsed.recipients.length)
    return {
      ok: false as const,
      error: "Nenhum destinatário válido encontrado.",
    };
  const campaign = await prisma.broadcastCampaign.create({
    data: {
      tenantId,
      name,
      phoneNumberId: connection.phoneNumberId,
      template,
      recipients: { createMany: { data: parsed.recipients } },
    },
  });
  revalidatePath("/disparos");
  return {
    ok: true as const,
    id: campaign.id,
    name,
    template,
    ...parsed,
    recentPhones: await recentlyContacted(
      tenantId,
      parsed.recipients.map((r) => r.phone),
      campaign.id,
    ),
  };
}

/** Teto da digitação: lista maior que isso é trabalho para o arquivo. */
const MAX_MANUAL_CONTACTS = 200;

/**
 * Contatos digitados na tela. Mesmas regras do arquivo (`parseBroadcastRows`:
 * DDI+DDD obrigatórios, variáveis preenchidas, duplicados únicos) — o cliente
 * só monta as linhas, quem decide o que entra é o servidor. `row` é a posição
 * na tabela da tela, para o erro apontar a linha certa.
 */
export async function prepareBroadcastManual(input: {
  name: string;
  templateId: string;
  contacts: { row: number; phone: string; name: string; parameters: string[] }[];
}) {
  const tenantId = await requireBroadcastAccess();
  const name = String(input?.name ?? "").trim();
  if (!name || name.length > 100)
    return {
      ok: false as const,
      error: "Dê um nome ao disparo (até 100 caracteres).",
    };
  const contacts = input?.contacts;
  if (!Array.isArray(contacts) || !contacts.length)
    return { ok: false as const, error: "Adicione ao menos um contato." };
  if (contacts.length > MAX_MANUAL_CONTACTS)
    return {
      ok: false as const,
      error: `Digite até ${MAX_MANUAL_CONTACTS} contatos. Para listas maiores, use um arquivo.`,
    };
  const wellFormed = contacts.every(
    (c) =>
      c &&
      Number.isInteger(c.row) &&
      c.row > 0 &&
      typeof c.phone === "string" &&
      typeof c.name === "string" &&
      Array.isArray(c.parameters) &&
      c.parameters.every((p) => typeof p === "string"),
  );
  if (!wellFormed)
    return { ok: false as const, error: "Contatos em formato inválido." };
  const connection = await getBroadcastConnection(tenantId);
  if (!connection)
    return {
      ok: false as const,
      error: "Conecte a API oficial da Meta em Integrações.",
    };
  let template: BroadcastTemplate | undefined;
  let parsed: ImportResult;
  try {
    template = (await connection.provider.listBroadcastTemplates()).find(
      (t) => t.id === input.templateId,
    );
    if (!template)
      return {
        ok: false as const,
        error: "Selecione um template aprovado e compatível. Atualize a lista.",
      };
    parsed = parseBroadcastRows(
      contacts.map((c) => ({
        row: c.row,
        value: {
          telefone: c.phone,
          nome: c.name,
          ...Object.fromEntries(
            c.parameters.map((p, i) => [`var_${i + 1}`, p]),
          ),
        },
      })),
      template,
    );
  } catch (error) {
    return {
      ok: false as const,
      error:
        error instanceof Error
          ? error.message
          : "Não foi possível validar os contatos.",
    };
  }
  // Na tela não existe coluna `var_1`: o erro fala da variável da mensagem.
  parsed.issues = parsed.issues.map((i) => ({
    ...i,
    error: i.error.replace(/var_(\d+)/g, "a variável {{$1}}"),
  }));
  // Quem digita "(11) 98765-4321" esquece o DDI, e sem o 55 o número passaria
  // como estrangeiro (11 dígitos começando em 1 = EUA). Número brasileiro sem
  // 55 e sem "+" é barrado; estrangeiro exige "+" explícito.
  const missingCountry = contacts
    .filter((c) => {
      const text = c.phone.trim();
      const digits = text.replace(/\D/g, "");
      return (
        !text.startsWith("+") &&
        !digits.startsWith("55") &&
        /^[1-9]\d(?:9\d{8}|[2-9]\d{7})$/.test(digits)
      );
    })
    .map((c) => ({
      row: c.row,
      error: "Falta o DDI. Para o Brasil, comece com +55 (ex.: +55 11 98765-4321).",
    }));
  if (missingCountry.length) {
    const flagged = new Set(missingCountry.map((i) => i.row));
    parsed.issues = [
      ...missingCountry,
      ...parsed.issues.filter((i) => !flagged.has(i.row)),
    ].sort((a, b) => a.row - b.row);
  }
  return createBroadcastDraft(tenantId, connection, name, template, parsed);
}

export async function startBroadcast(
  id: string,
  consent: boolean,
  input: ScheduleInput = {},
  acknowledgeRecent = false,
) {
  const { tenantId, userId, label } = await requireBroadcastActor();
  if (consent !== true)
    return {
      ok: false,
      error:
        "Confirme que os contatos autorizaram o recebimento das mensagens.",
    };
  const campaign = await prisma.broadcastCampaign.findFirst({
    where: { id, tenantId },
  });
  if (!campaign) return { ok: false, error: "Disparo não encontrado." };
  if (campaign.status === "cancelled")
    return {
      ok: false,
      error: "Este disparo foi cancelado. Prepare um novo disparo.",
    };
  if (campaign.status !== "draft") return { ok: true }; // confirmação repetida nunca reabre a fila
  const connection = await getBroadcastConnection(tenantId);
  if (!connection || connection.phoneNumberId !== campaign.phoneNumberId)
    return {
      ok: false,
      error: "A conexão Meta mudou. Prepare um novo disparo.",
    };
  try {
    const saved = campaign.template as BroadcastTemplate;
    const current = (await connection.provider.listBroadcastTemplates()).find(
      (t) => t.id === saved.id,
    );
    if (!current || !sameBroadcastTemplate(current, saved))
      return {
        ok: false,
        error:
          "O template mudou ou não está mais aprovado. Prepare um novo disparo.",
      };
  } catch {
    return {
      ok: false,
      error: "Não foi possível validar o template na Meta. Tente novamente.",
    };
  }
  let schedule;
  try {
    schedule = parseBroadcastSchedule(input);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Agenda inválida.",
    };
  }
  const recipients = await prisma.broadcastRecipient.findMany({
    where: { campaignId: id, isTest: false },
    select: { phone: true },
  });
  const recentPhones = await recentlyContacted(
    tenantId,
    recipients.map((r) => r.phone),
    id,
  );
  if (recentPhones.length && acknowledgeRecent !== true)
    return {
      ok: false,
      error: `${recentPhones.length} contatos têm envios nos últimos 7 dias. Confirme o aviso antes de continuar.`,
      recentPhones,
    };
  const started = await prisma.broadcastCampaign.updateMany({
    where: { id, tenantId, status: "draft" },
    data: {
      status: "queued",
      confirmedAt: new Date(),
      confirmedBy: userId,
      confirmedByLabel: label,
      consentVersion: "whatsapp-opt-in-v1",
      ...schedule,
      nextAttemptAt: nextBroadcastTime(schedule),
    },
  });
  if (!started.count) {
    const current = await prisma.broadcastCampaign.findFirst({
      where: { id, tenantId, status: { in: ["queued", "completed"] } },
      select: { id: true },
    });
    if (!current)
      return {
        ok: false,
        error: "O disparo foi cancelado durante a confirmação.",
      };
  }
  revalidatePath("/disparos");
  return { ok: true };
}

export async function cancelBroadcast(id: string) {
  const tenantId = await requireBroadcastAccess();
  await prisma.$transaction(async (tx) => {
    await tx.broadcastCampaign.updateMany({
      where: { id, tenantId, status: { in: ["draft", "queued", "paused"] } },
      data: { status: "cancelled", finishedAt: new Date() },
    });
    await tx.broadcastRecipient.updateMany({
      where: {
        campaignId: id,
        campaign: { tenantId, status: "cancelled" },
        status: "pending",
      },
      data: { status: "cancelled" },
    });
  });
  revalidatePath("/disparos");
  return { ok: true };
}

export async function refreshBroadcasts(filter: BroadcastFilter = {}) {
  return listBroadcastPage(await requireBroadcastAccess(), filter);
}

export async function getBroadcastDetails(id: string) {
  const tenantId = await requireBroadcastAccess();
  return prisma.broadcastRecipient.findMany({
    where: { campaignId: id, campaign: { tenantId } },
    orderBy: { row: "asc" },
    take: 1010,
    select: {
      id: true,
      row: true,
      phone: true,
      name: true,
      content: true,
      status: true,
      error: true,
      isTest: true,
      deliveryStatus: true,
      deliveryError: true,
      sentAt: true,
      deliveredAt: true,
      readAt: true,
      repliedAt: true,
      qualifiedAt: true,
      appointmentId: true,
    },
  });
}

export async function getBroadcastReview(id: string) {
  const tenantId = await requireBroadcastAccess();
  const campaign = await prisma.broadcastCampaign.findFirst({
    where: { id, tenantId, status: "draft" },
    include: {
      recipients: { where: { isTest: false }, orderBy: { row: "asc" } },
    },
  });
  if (!campaign) return null;
  return {
    id: campaign.id,
    name: campaign.name,
    template: campaign.template as BroadcastTemplate,
    duplicates: 0,
    recentPhones: await recentlyContacted(
      tenantId,
      campaign.recipients.map((r) => r.phone),
      id,
    ),
    recipients: campaign.recipients.map((r) => ({
      row: r.row,
      phone: r.phone,
      name: r.name,
      parameters: r.parameters as string[],
      content: r.content,
    })),
  };
}

export async function downloadBroadcastExample(
  format: "xlsx" | "json",
  parameterCount: number,
) {
  await requireBroadcastAccess();
  if (
    !Number.isInteger(parameterCount) ||
    parameterCount < 0 ||
    parameterCount > 20
  )
    throw new Error("Quantidade de variáveis inválida.");
  const row = {
    telefone: "5511987654321",
    nome: "Ana",
    ...Object.fromEntries(
      Array.from({ length: parameterCount }, (_, i) => [
        `var_${i + 1}`,
        i === 0 ? "Ana" : "Exemplo",
      ]),
    ),
  };
  if (format === "json")
    return Buffer.from(JSON.stringify([row], null, 2)).toString("base64");
  if (format !== "xlsx") throw new Error("Formato inválido.");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Contatos");
  sheet.addRow(Object.keys(row));
  sheet.addRow(Object.values(row));
  sheet.columns.forEach((column) => {
    column.width = 24;
    column.numFmt = "@";
  });
  sheet.getRow(1).font = { bold: true };
  return Buffer.from(await workbook.xlsx.writeBuffer()).toString("base64");
}

export async function inspectBroadcastImport(form: FormData) {
  await requireBroadcastAccess();
  const file = form.get("file");
  if (!(file instanceof File))
    return { ok: false as const, error: "Selecione um arquivo." };
  try {
    return { ok: true as const, ...(await inspectBroadcastFile(file)) };
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Arquivo inválido.",
    };
  }
}

export async function pauseBroadcast(id: string) {
  const tenantId = await requireBroadcastAccess();
  await prisma.broadcastCampaign.updateMany({
    where: { id, tenantId, status: "queued" },
    data: {
      status: "paused",
      pausedAt: new Date(),
      error: "Pausado pelo responsável da conta.",
    },
  });
  revalidatePath("/disparos");
  return { ok: true };
}

export async function resumeBroadcast(id: string) {
  const tenantId = await requireBroadcastAccess();
  const campaign = await prisma.broadcastCampaign.findFirst({
    where: { id, tenantId, status: "paused" },
  });
  if (!campaign) return { ok: false, error: "Disparo pausado não encontrado." };
  const connection = await getBroadcastConnection(tenantId);
  if (!connection || connection.phoneNumberId !== campaign.phoneNumberId)
    return {
      ok: false,
      error: "Reconecte o mesmo número da Meta usado neste disparo.",
    };
  try {
    const saved = campaign.template as BroadcastTemplate;
    const current = (await connection.provider.listBroadcastTemplates()).find(
      (t) => t.id === saved.id,
    );
    if (!current || !sameBroadcastTemplate(saved, current))
      return {
        ok: false,
        error: "O template original precisa estar aprovado e sem alterações.",
      };
  } catch {
    return {
      ok: false,
      error: "Não foi possível consultar a Meta. Tente novamente.",
    };
  }
  await prisma.broadcastCampaign.updateMany({
    where: { id, tenantId, status: "paused" },
    data: {
      status: "queued",
      pausedAt: null,
      error: null,
      retryCount: 0,
      nextAttemptAt: nextBroadcastTime(campaign),
    },
  });
  revalidatePath("/disparos");
  return { ok: true };
}

export async function sendBroadcastTest(id: string, rawPhone: string) {
  const tenantId = await requireBroadcastAccess();
  const phone = normalizeBroadcastPhone(rawPhone);
  if (!phone)
    return { ok: false, error: "Informe o número de teste com DDI e DDD." };
  const campaign = await prisma.broadcastCampaign.findFirst({
    where: { id, tenantId, status: "draft" },
    include: {
      recipients: {
        where: { isTest: false },
        orderBy: { row: "asc" },
        take: 1,
      },
    },
  });
  if (!campaign?.recipients[0])
    return { ok: false, error: "Rascunho não encontrado." };
  const existing = await prisma.broadcastRecipient.findUnique({
    where: { campaignId_phone_isTest: { campaignId: id, phone, isTest: true } },
  });
  // `skipped` = barrado por bloqueio/pedido de parar ANTES de qualquer chamada à
  // Meta. Nada saiu, então o teste é reavaliado: quem desbloqueou o número não
  // pode continuar vendo o veredito antigo. Os demais estados continuam
  // valendo (`sent`, `unknown`, `failed`: reenviar poderia duplicar).
  if (existing && existing.status !== "skipped")
    return {
      ok: existing.status === "sent",
      error:
        existing.status === "sent"
          ? undefined
          : (existing.error ??
            "O teste para este número já foi solicitado. Confira o histórico."),
      status: existing.status,
    };
  const connection = await getBroadcastConnection(tenantId);
  if (!connection || connection.phoneNumberId !== campaign.phoneNumberId)
    return {
      ok: false,
      error: "Reconecte o número da Meta usado neste rascunho.",
    };
  try {
    const template = campaign.template as BroadcastTemplate;
    const current = (await connection.provider.listBroadcastTemplates()).find(
      (t) => t.id === template.id,
    );
    if (!current || !sameBroadcastTemplate(template, current))
      return { ok: false, error: "O template mudou. Prepare outro rascunho." };
  } catch {
    return { ok: false, error: "Não foi possível validar o template na Meta." };
  }
  const sample = campaign.recipients[0];
  const recipient = await prisma.$transaction(async (tx) => {
    const locked = await tx.broadcastCampaign.updateMany({
      where: {
        id,
        tenantId,
        status: "draft",
        OR: [
          { lastTestAt: null },
          { lastTestAt: { lt: new Date(Date.now() - 30_000) } },
        ],
      },
      data: { lastTestAt: new Date() },
    });
    if (
      !locked.count ||
      (await tx.broadcastRecipient.count({
        where: { campaignId: id, isTest: true },
      })) >= 5
    )
      return null;
    if (existing)
      await tx.broadcastRecipient.updateMany({
        where: { id: existing.id, status: "skipped" },
        data: { status: "pending", error: null, attemptedAt: null },
      });
    return tx.broadcastRecipient.upsert({
      where: {
        campaignId_phone_isTest: { campaignId: id, phone, isTest: true },
      },
      update: {},
      create: {
        campaignId: id,
        phone,
        isTest: true,
        row: 0,
        name: "Teste",
        parameters: sample.parameters!,
        content: sample.content,
      },
    });
  });
  if (!recipient)
    return {
      ok: false,
      error:
        "Aguarde 30 segundos entre testes. Cada rascunho permite até 5 números de teste.",
    };
  const accepted = await sendBroadcastRecipient(
    campaign,
    recipient,
    connection,
  );
  const result = await prisma.broadcastRecipient.findUnique({
    where: { id: recipient.id },
    select: { status: true, error: true },
  });
  revalidatePath("/disparos");
  return {
    ok: accepted || result?.status === "sent",
    status: result?.status,
    error:
      result?.error ??
      (accepted
        ? undefined
        : "Teste não enviado. Confira os contatos do disparo."),
  };
}

export async function exportBroadcast(id: string) {
  // getBroadcastDetails também valida o tenant; guarda explícito para esta action pública.
  const tenantId = await requireBroadcastAccess();
  const campaign = await prisma.broadcastCampaign.findFirst({
    where: { id, tenantId },
    select: { confirmedAt: true, confirmedByLabel: true, consentVersion: true },
  });
  if (!campaign) throw new Error("Disparo não encontrado.");
  const rows = await getBroadcastDetails(id);
  const iso = (date: Date | null) => date?.toISOString() ?? "";
  return Buffer.from(
    broadcastCsv([
      [
        "linha",
        "telefone",
        "nome",
        "teste",
        "envio",
        "entrega",
        "erro",
        "aceito_em",
        "entregue_em",
        "lido_em",
        "respondeu_em",
        "oportunidade_em",
        "agendamento",
        "confirmado_por",
        "confirmado_em",
        "consentimento",
      ],
      ...rows.map((r) => [
        r.row,
        r.phone,
        r.name,
        r.isTest ? "sim" : "não",
        r.status,
        r.deliveryStatus,
        r.deliveryError ?? r.error,
        iso(r.sentAt),
        iso(r.deliveredAt),
        iso(r.readAt),
        iso(r.repliedAt),
        iso(r.qualifiedAt),
        r.appointmentId,
        campaign.confirmedByLabel,
        iso(campaign.confirmedAt),
        campaign.consentVersion,
      ]),
    ]),
  ).toString("base64");
}
