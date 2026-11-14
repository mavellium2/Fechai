"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { recordAudit, recordChange } from "@/modules/audit/log";
import { requireCampaignActor, type CampaignActor } from "@/modules/campaigns/access";
import { assetFileProblem, cleanAssetName, removeCampaignAssetFile, storeCampaignAsset, ASSET_USAGES, type AssetUsage } from "@/modules/campaigns/assets";
import { attributeLead } from "@/modules/campaigns/attribution";
import type { CampaignActionResult } from "@/modules/campaigns/result";
import { parseCampaignRules, validateCampaignRules } from "@/modules/campaigns/rules";
import { allowedActions, campaignStatus } from "@/modules/campaigns/status";
import { parseKeywords } from "@/modules/campaigns/schema";
import { KEYWORD_MAX, KEYWORDS_MAX } from "@/modules/campaigns/limits";
import { buildAgentPackage, createAgentFromPackage } from "@/modules/agent-engine/transfer";
import { ingestDocument } from "@/modules/knowledge-base/repository";

/**
 * Actions das seções da campanha: regras do agente, anúncios, mídias,
 * disparos e leads. Mesmas regras das actions de `actions.ts`:
 *
 * - conta e usuário vêm da sessão (`requireCampaignActor`), nunca do corpo;
 * - a campanha é lida com `tenantId` — id de outra conta é "não encontrada";
 * - terminada e arquivada ficam só para consulta (`allowedActions(...).edit`),
 *   com uma exceção: adicionar/tirar lead manualmente segue valendo enquanto a
 *   campanha não está arquivada, porque os resultados continuam sendo dela;
 * - toda mudança vai para a auditoria com antes e depois.
 */

type Result = CampaignActionResult;

const AUDIT_TYPE = "Campaign";
const notFound = (): Result => ({ ok: false, error: "Campanha não encontrada." });
const forbidden = (): Result => ({
  ok: false,
  code: "forbidden",
  error: "Só o dono ou um administrador da conta pode alterar campanhas.",
});
const readOnly = (): Result => ({
  ok: false,
  error: "Campanha terminada ou arquivada fica só para consulta.",
});
const serverError = (): Result => ({
  ok: false,
  code: "server",
  error: "Não foi possível salvar agora. Tente de novo em instantes.",
});

function validId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 && id.length <= 64;
}

async function editable(actor: CampaignActor, id: unknown, options: { allowFinished?: boolean } = {}) {
  if (!validId(id)) return { ok: false, error: notFound() } as const;
  const campaign = await prisma.campaign.findFirst({ where: { id, tenantId: actor.tenantId } });
  if (!campaign) return { ok: false, error: notFound() } as const;
  const status = campaignStatus(campaign, new Date());
  const ok = options.allowFinished ? status !== "archived" : allowedActions(status).edit;
  if (!ok) return { ok: false, error: readOnly() } as const;
  return { ok: true, campaign } as const;
}

function touch(campaignId: string, actor: CampaignActor) {
  return prisma.campaign.updateMany({
    where: { id: campaignId, tenantId: actor.tenantId },
    data: { updatedById: actor.userId },
  });
}

function revalidate(id: string) {
  revalidatePath("/campanhas");
  revalidatePath(`/campanhas/${id}`);
}

// ─── Regras do agente ──────────────────────────────────────────────────────

/**
 * Salva as regras (JSON vindo da tela). O que não passa em `parseCampaignRules`
 * cai no padrão; `validateCampaignRules` recusa o que a pessoa digitou errado
 * em vez de jogar fora em silêncio.
 */
export async function saveCampaignRules(campaignId: string, raw: unknown): Promise<Result> {
  const actor = await requireCampaignActor();
  if (!actor.canEdit) return forbidden();
  const found = await editable(actor, campaignId);
  if (!found.ok) return found.error;
  const { campaign } = found;

  if (!raw || typeof raw !== "object") return { ok: false, code: "validation", error: "Regras inválidas." };
  // Cada passo da tela salva só a parte dele (agenda, ou o que o agente fala):
  // o resto das regras gravadas fica como está.
  const merged = { ...parseCampaignRules(campaign.rules), ...(raw as Record<string, unknown>) };
  const rules = parseCampaignRules(merged);
  const problem = validateCampaignRules(rules, raw as { times?: unknown; dates?: unknown });
  if (problem) return { ok: false, code: "validation", error: problem };

  const before = parseCampaignRules(campaign.rules);
  if (JSON.stringify(before) === JSON.stringify(rules)) return { ok: true, id: campaign.id, info: "Nenhuma alteração para salvar." };

  try {
    await prisma.campaign.updateMany({
      where: { id: campaign.id, tenantId: actor.tenantId },
      data: { rules, updatedById: actor.userId },
    });
  } catch (err) {
    console.error("[campanhas] regras não gravadas", err);
    return serverError();
  }
  await recordAudit({
    event: "campaign.rules_updated",
    target: { type: AUDIT_TYPE, id: campaign.id, label: campaign.name },
    before: { rules: before },
    after: { rules },
  });
  revalidate(campaign.id);
  return { ok: true, id: campaign.id, info: "Regras salvas." };
}

// ─── Anúncios ──────────────────────────────────────────────────────────────

const AD_ID = /^\d{5,25}$/;

/** Vincula um anúncio: escolhido da lista capturada ou digitado. */
export async function linkCampaignAd(
  campaignId: string,
  input: { adId?: string; adsetId?: string; metaCampaignId?: string; code?: string; displayName?: string },
): Promise<Result> {
  const actor = await requireCampaignActor();
  if (!actor.canEdit) return forbidden();
  const found = await editable(actor, campaignId);
  if (!found.ok) return found.error;
  const { campaign } = found;

  const clean = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const adId = clean(input?.adId);
  const adsetId = clean(input?.adsetId);
  const metaCampaignId = clean(input?.metaCampaignId);
  const code = clean(input?.code).slice(0, 40);
  const displayName = clean(input?.displayName).slice(0, 120);
  for (const [label, value] of [["anúncio", adId], ["conjunto", adsetId], ["campanha da Meta", metaCampaignId]] as const) {
    if (value && !AD_ID.test(value)) return { ok: false, code: "validation", error: `O id do ${label} tem só números (copie do Gerenciador de Anúncios).` };
  }
  if (!adId && !adsetId && !metaCampaignId && !code) {
    return { ok: false, code: "validation", error: "Informe o id do anúncio, do conjunto, da campanha da Meta ou o código do anúncio." };
  }
  if (!adId && !code) {
    return {
      ok: false,
      code: "validation",
      error: "Para os leads entrarem sozinhos, informe o id do anúncio ou o código escrito nele (o WhatsApp só entrega esses dois).",
    };
  }

  const duplicate = await prisma.campaignAd.findFirst({
    where: { campaignId: campaign.id, tenantId: actor.tenantId, OR: [...(adId ? [{ adId }] : []), ...(code ? [{ code: { equals: code, mode: "insensitive" as const } }] : [])] },
    select: { id: true },
  });
  if (duplicate) return { ok: false, code: "validation", error: "Este anúncio já está vinculado à campanha." };

  const name = displayName || (code ? code : `Anúncio ${adId.slice(-6)}`);
  try {
    const ad = await prisma.campaignAd.create({
      data: {
        tenantId: actor.tenantId,
        campaignId: campaign.id,
        adId: adId || null,
        adsetId: adsetId || null,
        metaCampaignId: metaCampaignId || null,
        code: code || null,
        displayName: name,
      },
    });
    await touch(campaign.id, actor);
    await recordAudit({
      event: "campaign.ad_linked",
      target: { type: AUDIT_TYPE, id: campaign.id, label: campaign.name },
      after: { ad: { id: ad.id, adId: ad.adId, code: ad.code, displayName: ad.displayName } },
    });
  } catch (err) {
    console.error("[campanhas] anúncio não vinculado", err);
    return serverError();
  }

  // Leads que JÁ chegaram por esse anúncio durante a campanha entram agora.
  const origins = await prisma.leadAdOrigin.findMany({
    where: {
      tenantId: actor.tenantId,
      OR: [...(adId ? [{ sourceId: adId }] : []), ...(code ? [{ code: { equals: code, mode: "insensitive" as const } }] : [])],
      ...(campaign.startsAt ? { firstAdAt: { gte: campaign.startsAt } } : {}),
      lead: { isTest: false },
    },
    select: { leadId: true, firstAdAt: true },
    take: 5000,
  });
  let added = 0;
  for (const origin of origins) {
    const { created } = await attributeLead({
      tenantId: actor.tenantId, campaignId: campaign.id, leadId: origin.leadId, source: "anuncio", at: origin.firstAdAt,
    });
    if (created) added++;
  }

  revalidate(campaign.id);
  return { ok: true, id: campaign.id, info: added ? `Anúncio vinculado. ${added} lead${added === 1 ? "" : "s"} que já veio dele entrou na campanha.` : "Anúncio vinculado." };
}

export async function unlinkCampaignAd(campaignId: string, adLinkId: string): Promise<Result> {
  const actor = await requireCampaignActor();
  if (!actor.canEdit) return forbidden();
  const found = await editable(actor, campaignId);
  if (!found.ok) return found.error;
  if (!validId(adLinkId)) return { ok: false, error: "Anúncio não encontrado." };
  const ad = await prisma.campaignAd.findFirst({ where: { id: adLinkId, campaignId: found.campaign.id, tenantId: actor.tenantId } });
  if (!ad) return { ok: false, error: "Anúncio não encontrado." };
  await prisma.campaignAd.deleteMany({ where: { id: ad.id, tenantId: actor.tenantId } });
  await touch(found.campaign.id, actor);
  await recordAudit({
    event: "campaign.ad_unlinked",
    target: { type: AUDIT_TYPE, id: found.campaign.id, label: found.campaign.name },
    before: { ad: { id: ad.id, adId: ad.adId, code: ad.code, displayName: ad.displayName } },
  });
  revalidate(found.campaign.id);
  // Os leads que já entraram por ele continuam na campanha: o resultado é dela.
  return { ok: true, id: found.campaign.id, info: "Anúncio desvinculado. Os leads que já vieram dele continuam na campanha." };
}

// ─── Mídias ────────────────────────────────────────────────────────────────

function parseUsage(value: unknown): AssetUsage {
  return ASSET_USAGES.includes(value as AssetUsage) ? (value as AssetUsage) : "agent";
}

export async function uploadCampaignAsset(formData: FormData): Promise<Result> {
  const actor = await requireCampaignActor();
  if (!actor.canEdit) return forbidden();
  const found = await editable(actor, formData.get("campaignId"));
  if (!found.ok) return found.error;
  const { campaign } = found;

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, code: "validation", error: "Escolha um arquivo." };
  const problem = assetFileProblem(file);
  if (problem) return { ok: false, code: "validation", error: problem };
  const instruction = String(formData.get("instruction") ?? "").replace(/\r\n?/g, "\n").trim().slice(0, 500) || null;
  const usage = parseUsage(formData.get("usage"));

  const count = await prisma.campaignAsset.count({ where: { campaignId: campaign.id } });
  if (count >= 30) return { ok: false, code: "validation", error: "A campanha pode ter até 30 mídias." };

  const stored = await storeCampaignAsset(actor.tenantId, file);
  if (!stored.ok) return { ok: false, error: stored.error };
  try {
    const asset = await prisma.campaignAsset.create({
      data: {
        tenantId: actor.tenantId,
        campaignId: campaign.id,
        kind: stored.kind,
        url: stored.url,
        path: stored.path,
        name: cleanAssetName(file.name),
        mime: stored.mime,
        size: file.size,
        usage,
        instruction,
      },
    });
    await touch(campaign.id, actor);
    await recordAudit({
      event: "campaign.asset_added",
      target: { type: AUDIT_TYPE, id: campaign.id, label: campaign.name },
      after: { asset: { id: asset.id, name: asset.name, kind: asset.kind, usage, instruction } },
    });
  } catch (err) {
    console.error("[campanhas] mídia não gravada", err);
    await removeCampaignAssetFile(stored.path);
    return serverError();
  }
  revalidate(campaign.id);
  return { ok: true, id: campaign.id, info: "Mídia adicionada." };
}

export async function updateCampaignAsset(
  campaignId: string,
  assetId: string,
  input: { usage?: string; instruction?: string },
): Promise<Result> {
  const actor = await requireCampaignActor();
  if (!actor.canEdit) return forbidden();
  const found = await editable(actor, campaignId);
  if (!found.ok) return found.error;
  if (!validId(assetId)) return { ok: false, error: "Mídia não encontrada." };
  const asset = await prisma.campaignAsset.findFirst({ where: { id: assetId, campaignId: found.campaign.id, tenantId: actor.tenantId } });
  if (!asset) return { ok: false, error: "Mídia não encontrada." };
  const usage = parseUsage(input?.usage);
  const instruction =
    typeof input?.instruction === "string" ? input.instruction.replace(/\r\n?/g, "\n").trim().slice(0, 500) || null : asset.instruction;
  if (usage === asset.usage && instruction === asset.instruction) return { ok: true, info: "Nenhuma alteração para salvar." };
  await prisma.campaignAsset.updateMany({ where: { id: asset.id, tenantId: actor.tenantId }, data: { usage, instruction } });
  await touch(found.campaign.id, actor);
  await recordChange({
    event: "campaign.asset_updated",
    target: { type: AUDIT_TYPE, id: found.campaign.id, label: found.campaign.name },
    before: { usage: asset.usage, instruction: asset.instruction },
    after: { usage, instruction },
    meta: { assetId: asset.id, name: asset.name },
  });
  revalidate(found.campaign.id);
  return { ok: true, info: "Mídia atualizada." };
}

export async function removeCampaignAsset(campaignId: string, assetId: string): Promise<Result> {
  const actor = await requireCampaignActor();
  if (!actor.canEdit) return forbidden();
  const found = await editable(actor, campaignId);
  if (!found.ok) return found.error;
  if (!validId(assetId)) return { ok: false, error: "Mídia não encontrada." };
  const asset = await prisma.campaignAsset.findFirst({ where: { id: assetId, campaignId: found.campaign.id, tenantId: actor.tenantId } });
  if (!asset) return { ok: false, error: "Mídia não encontrada." };
  await prisma.campaignAsset.deleteMany({ where: { id: asset.id, tenantId: actor.tenantId } });
  await removeCampaignAssetFile(asset.path);
  await touch(found.campaign.id, actor);
  await recordAudit({
    event: "campaign.asset_removed",
    target: { type: AUDIT_TYPE, id: found.campaign.id, label: found.campaign.name },
    before: { asset: { id: asset.id, name: asset.name, kind: asset.kind, usage: asset.usage } },
  });
  revalidate(found.campaign.id);
  return { ok: true, info: "Mídia removida." };
}

// ─── Disparos ──────────────────────────────────────────────────────────────

/** Um disparo pertence a no máximo uma campanha: vincular a outra é recusado. */
export async function linkCampaignBroadcast(campaignId: string, broadcastId: string): Promise<Result> {
  const actor = await requireCampaignActor();
  if (!actor.canEdit) return forbidden();
  const found = await editable(actor, campaignId);
  if (!found.ok) return found.error;
  if (!validId(broadcastId)) return { ok: false, error: "Disparo não encontrado." };
  const broadcast = await prisma.broadcastCampaign.findFirst({
    where: { id: broadcastId, tenantId: actor.tenantId },
    select: { id: true, name: true, campaignId: true },
  });
  if (!broadcast) return { ok: false, error: "Disparo não encontrado." };
  if (broadcast.campaignId === found.campaign.id) return { ok: true, info: "Este disparo já está na campanha." };
  if (broadcast.campaignId) return { ok: false, error: "Este disparo já pertence a outra campanha. Desvincule lá primeiro." };
  const written = await prisma.broadcastCampaign.updateMany({
    where: { id: broadcast.id, tenantId: actor.tenantId, campaignId: null },
    data: { campaignId: found.campaign.id },
  });
  if (!written.count) return { ok: false, error: "O disparo mudou. Atualize a página e tente de novo." };
  await touch(found.campaign.id, actor);
  await recordAudit({
    event: "campaign.broadcast_linked",
    target: { type: AUDIT_TYPE, id: found.campaign.id, label: found.campaign.name },
    after: { broadcast: { id: broadcast.id, name: broadcast.name } },
  });
  revalidate(found.campaign.id);
  return { ok: true, info: "Disparo vinculado. Quem responder a ele entra na campanha." };
}

export async function unlinkCampaignBroadcast(campaignId: string, broadcastId: string): Promise<Result> {
  const actor = await requireCampaignActor();
  if (!actor.canEdit) return forbidden();
  const found = await editable(actor, campaignId);
  if (!found.ok) return found.error;
  if (!validId(broadcastId)) return { ok: false, error: "Disparo não encontrado." };
  const broadcast = await prisma.broadcastCampaign.findFirst({
    where: { id: broadcastId, tenantId: actor.tenantId, campaignId: found.campaign.id },
    select: { id: true, name: true },
  });
  if (!broadcast) return { ok: false, error: "Disparo não encontrado nesta campanha." };
  await prisma.broadcastCampaign.updateMany({
    where: { id: broadcast.id, tenantId: actor.tenantId, campaignId: found.campaign.id },
    data: { campaignId: null },
  });
  await touch(found.campaign.id, actor);
  await recordAudit({
    event: "campaign.broadcast_unlinked",
    target: { type: AUDIT_TYPE, id: found.campaign.id, label: found.campaign.name },
    before: { broadcast: { id: broadcast.id, name: broadcast.name } },
  });
  revalidate(found.campaign.id);
  return { ok: true, info: "Disparo desvinculado." };
}

// ─── Leads ─────────────────────────────────────────────────────────────────

/** Busca contatos da conta para adicionar à mão (nome ou telefone). */
export async function searchLeadsForCampaign(
  campaignId: string,
  query: string,
): Promise<{ ok: true; leads: { id: string; name: string; phone: string; inCampaign: boolean }[] } | { ok: false; error: string }> {
  const actor = await requireCampaignActor();
  if (!validId(campaignId)) return { ok: false, error: "Campanha não encontrada." };
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, tenantId: actor.tenantId }, select: { id: true } });
  if (!campaign) return { ok: false, error: "Campanha não encontrada." };
  const term = typeof query === "string" ? query.trim().slice(0, 60) : "";
  if (term.length < 2) return { ok: true, leads: [] };
  const digits = term.replace(/\D/g, "");
  const leads = await prisma.lead.findMany({
    where: {
      tenantId: actor.tenantId,
      isTest: false,
      OR: [{ name: { contains: term, mode: "insensitive" } }, ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : [])],
    },
    select: { id: true, name: true, phone: true, campaignLinks: { where: { campaignId: campaign.id }, select: { id: true } } },
    orderBy: { updatedAt: "desc" },
    take: 10,
  });
  return {
    ok: true,
    leads: leads.map((lead) => ({
      id: lead.id,
      name: lead.name ?? "Sem nome",
      phone: lead.phone.includes(":archived:") ? "" : lead.phone,
      inCampaign: lead.campaignLinks.length > 0,
    })),
  };
}

/**
 * Adicionar lead à mão. Pela spec o atendente também pode — hoje todo usuário
 * da conta é o dono, então quem tem acesso ao produto adiciona.
 */
export async function addLeadToCampaign(campaignId: string, leadId: string): Promise<Result> {
  const actor = await requireCampaignActor();
  const found = await editable(actor, campaignId, { allowFinished: true });
  if (!found.ok) return found.error;
  if (!validId(leadId)) return { ok: false, error: "Contato não encontrado." };
  const lead = await prisma.lead.findFirst({ where: { id: leadId, tenantId: actor.tenantId, isTest: false }, select: { id: true, name: true } });
  if (!lead) return { ok: false, error: "Contato não encontrado." };
  const { created } = await attributeLead({
    tenantId: actor.tenantId, campaignId: found.campaign.id, leadId: lead.id, source: "manual", assignedById: actor.userId,
  });
  if (!created) return { ok: true, info: "Este contato já está na campanha." };
  await touch(found.campaign.id, actor);
  await recordAudit({
    event: "campaign.lead_added",
    target: { type: AUDIT_TYPE, id: found.campaign.id, label: found.campaign.name },
    after: { leadId: lead.id, source: "manual" },
  });
  revalidate(found.campaign.id);
  revalidatePath("/conversas");
  return { ok: true, info: "Contato adicionado à campanha." };
}

/**
 * "Usar o lead de teste desta campanha": liga o lead do chat de teste (sandbox)
 * da conta à campanha, para o dono conferir as regras no chat. Só quando a
 * pessoa clica, com origem manual. Relatórios e resultados já ignoram `isTest`.
 * O chat de teste precisa ter sido aberto ao menos uma vez (não cria lead aqui).
 */
export async function linkTestLeadToCampaign(campaignId: string): Promise<Result> {
  const actor = await requireCampaignActor();
  if (!actor.canEdit) return forbidden();
  const found = await editable(actor, campaignId, { allowFinished: true });
  if (!found.ok) return found.error;
  const leads = await prisma.lead.findMany({
    where: { tenantId: actor.tenantId, isTest: true, phone: { startsWith: "sandbox" } },
    select: { id: true, phone: true },
    take: 20,
  });
  const live = leads.filter((lead) => !lead.phone.includes(":archived:"));
  if (!live.length) return { ok: false, error: "Abra o chat de teste do agente uma vez e tente de novo." };
  let added = 0;
  for (const lead of live) {
    const { created } = await attributeLead({
      tenantId: actor.tenantId, campaignId: found.campaign.id, leadId: lead.id, source: "manual", assignedById: actor.userId,
    });
    if (created) added++;
  }
  if (!added) return { ok: true, info: "O lead de teste já está nesta campanha." };
  await touch(found.campaign.id, actor);
  await recordAudit({
    event: "campaign.lead_added",
    target: { type: AUDIT_TYPE, id: found.campaign.id, label: found.campaign.name },
    after: { test: true, count: added, source: "manual" },
  });
  revalidate(found.campaign.id);
  return { ok: true, info: "Lead de teste ligado à campanha. No chat de teste, o agente segue as regras dela." };
}

export async function removeLeadFromCampaign(campaignId: string, leadId: string): Promise<Result> {
  const actor = await requireCampaignActor();
  if (!actor.canEdit) return forbidden();
  const found = await editable(actor, campaignId, { allowFinished: true });
  if (!found.ok) return found.error;
  if (!validId(leadId)) return { ok: false, error: "Contato não encontrado." };
  const link = await prisma.campaignLead.findFirst({
    where: { campaignId: found.campaign.id, leadId, tenantId: actor.tenantId },
    select: { id: true, source: true },
  });
  if (!link) return { ok: false, error: "Este contato não está na campanha." };
  await prisma.campaignLead.deleteMany({ where: { id: link.id, tenantId: actor.tenantId } });
  await touch(found.campaign.id, actor);
  await recordAudit({
    event: "campaign.lead_removed",
    target: { type: AUDIT_TYPE, id: found.campaign.id, label: found.campaign.name },
    before: { leadId, source: link.source },
  });
  revalidate(found.campaign.id);
  revalidatePath("/conversas");
  return { ok: true, info: "Contato tirado da campanha. As regras dela deixam de valer para ele." };
}

// ─── Palavras-chave ────────────────────────────────────────────────────────

export async function saveCampaignKeywords(campaignId: string, value: string): Promise<Result> {
  const actor = await requireCampaignActor();
  if (!actor.canEdit) return forbidden();
  const found = await editable(actor, campaignId);
  if (!found.ok) return found.error;
  const keywords = parseKeywords(typeof value === "string" ? value : "");
  if (keywords.length > KEYWORDS_MAX) return { ok: false, code: "validation", error: `Use até ${KEYWORDS_MAX} palavras-chave.` };
  if (keywords.some((k) => k.length > KEYWORD_MAX)) {
    return { ok: false, code: "validation", error: `Cada palavra-chave pode ter até ${KEYWORD_MAX} caracteres.` };
  }
  const before = found.campaign.keywords;
  if (JSON.stringify(before) === JSON.stringify(keywords)) return { ok: true, info: "Nenhuma alteração para salvar." };
  await prisma.campaign.updateMany({ where: { id: found.campaign.id, tenantId: actor.tenantId }, data: { keywords, updatedById: actor.userId } });
  await recordChange({
    event: "campaign.updated",
    target: { type: AUDIT_TYPE, id: found.campaign.id, label: found.campaign.name },
    before: { keywords: before },
    after: { keywords },
  });
  revalidate(found.campaign.id);
  return { ok: true, info: "Palavras-chave salvas." };
}

// ─── Agente da campanha ────────────────────────────────────────────────────

/**
 * Quem atende os leads da campanha. `null` = o agente que já atende cada
 * conversa. Escolher outro agente não mexe em nenhum agente: só diz quem
 * responde aos leads da campanha enquanto ela vale.
 */
export async function setCampaignAgent(campaignId: string, agentId: string | null): Promise<Result> {
  const actor = await requireCampaignActor();
  if (!actor.canEdit) return forbidden();
  const found = await editable(actor, campaignId);
  if (!found.ok) return found.error;
  const { campaign } = found;
  let next: string | null = null;
  if (agentId) {
    if (!validId(agentId)) return { ok: false, error: "Agente não encontrado." };
    const agent = await prisma.agent.findFirst({ where: { id: agentId, tenantId: actor.tenantId, archived: false }, select: { id: true } });
    if (!agent) return { ok: false, error: "Agente não encontrado." };
    next = agent.id;
  }
  if (next === campaign.agentId) return { ok: true, info: "Nenhuma alteração para salvar." };
  // Trocar de agente desfaz o vínculo "cópia ↔ original": o aprendizado a
  // levar de volta é só o da cópia criada para esta campanha.
  await prisma.campaign.updateMany({
    where: { id: campaign.id, tenantId: actor.tenantId },
    data: { agentId: next, baseAgentId: null, agentCopiedAt: null, mergedDocIds: [], updatedById: actor.userId },
  });
  await recordChange({
    event: "campaign.agent_changed",
    target: { type: AUDIT_TYPE, id: campaign.id, label: campaign.name },
    before: { agentId: campaign.agentId },
    after: { agentId: next },
  });
  revalidate(campaign.id);
  return { ok: true, info: next ? "Agente da campanha definido." : "Os leads da campanha seguem com o agente de sempre." };
}

/**
 * Cria uma cópia do agente escolhido só para a campanha (mesma persona, base,
 * habilidades e agenda) e a deixa como agente da campanha. A cópia nasce
 * ligada mas não é a principal: só atende os leads da campanha.
 */
export async function copyAgentForCampaign(campaignId: string, sourceAgentId: string): Promise<Result> {
  const actor = await requireCampaignActor();
  if (!actor.canEdit) return forbidden();
  const found = await editable(actor, campaignId);
  if (!found.ok) return found.error;
  const { campaign } = found;
  if (!validId(sourceAgentId)) return { ok: false, error: "Agente não encontrado." };
  const source = await prisma.agent.findFirst({
    where: { id: sourceAgentId, tenantId: actor.tenantId, archived: false },
    select: { id: true, name: true },
  });
  if (!source) return { ok: false, error: "Agente não encontrado." };

  const pkg = await buildAgentPackage(source.id, actor.tenantId);
  if (!pkg) return { ok: false, error: "Agente não encontrado." };
  const name = `${source.name} – ${campaign.name}`.slice(0, 60);
  const created = await createAgentFromPackage({ tenantId: actor.tenantId, package: pkg, name });
  if (!created.ok) {
    return {
      ok: false,
      error: created.error.includes("limite")
        ? `${created.error.replace("A empresa de destino", "A conta")} Escolha um agente que já existe ou arquive um que não usa.`
        : created.error,
    };
  }
  const copiedAt = new Date();
  await prisma.agent.updateMany({ where: { id: created.agentId, tenantId: actor.tenantId }, data: { enabled: true } });
  await prisma.campaign.updateMany({
    where: { id: campaign.id, tenantId: actor.tenantId },
    data: { agentId: created.agentId, baseAgentId: source.id, agentCopiedAt: copiedAt, mergedDocIds: [], updatedById: actor.userId },
  });
  await recordAudit({
    event: "campaign.agent_copied",
    target: { type: AUDIT_TYPE, id: campaign.id, label: campaign.name },
    after: { agentId: created.agentId, agentName: created.name, baseAgentId: source.id, baseAgentName: source.name },
  });
  revalidate(campaign.id);
  revalidatePath("/agentes");
  return {
    ok: true,
    info: `Cópia “${created.name}” criada. Ajuste o jeito de falar e a base dela; a ${source.name} não muda.`,
  };
}

/**
 * Leva para o agente original o que a cópia aprendeu (documentos que entraram
 * na base dela depois da cópia, incluindo as perguntas respondidas em
 * Perguntas). Só o que a pessoa marcou; cada documento vai uma vez.
 */
export async function mergeCampaignLearning(campaignId: string, docIds: string[]): Promise<Result> {
  const actor = await requireCampaignActor();
  if (!actor.canEdit) return forbidden();
  if (!validId(campaignId)) return notFound();
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, tenantId: actor.tenantId } });
  if (!campaign || campaign.archivedAt) return notFound();
  if (!campaign.agentId || !campaign.baseAgentId || !campaign.agentCopiedAt) {
    return { ok: false, error: "Esta campanha não usa uma cópia de agente." };
  }
  const base = await prisma.agent.findFirst({ where: { id: campaign.baseAgentId, tenantId: actor.tenantId, archived: false }, select: { id: true, name: true } });
  if (!base) return { ok: false, error: "O agente original não existe mais." };
  const wanted = (Array.isArray(docIds) ? docIds : []).filter(validId).filter((id) => !campaign.mergedDocIds.includes(id));
  if (!wanted.length) return { ok: false, code: "validation", error: "Marque pelo menos um item para levar." };
  const docs = await prisma.knowledgeDocument.findMany({
    where: { id: { in: wanted }, tenantId: actor.tenantId, agentId: campaign.agentId, createdAt: { gt: campaign.agentCopiedAt } },
    select: { id: true, title: true, content: true },
  });
  if (!docs.length) return { ok: false, error: "Nada encontrado para levar." };
  const merged: string[] = [];
  for (const doc of docs) {
    try {
      await ingestDocument({ tenantId: actor.tenantId, agentId: base.id, title: doc.title, content: doc.content });
      merged.push(doc.id);
    } catch (err) {
      console.error("[campanhas] documento não levado ao agente original", doc.id, err);
    }
  }
  if (merged.length) {
    await prisma.campaign.updateMany({
      where: { id: campaign.id, tenantId: actor.tenantId },
      data: { mergedDocIds: { push: merged }, updatedById: actor.userId },
    });
    await recordAudit({
      event: "campaign.learning_merged",
      target: { type: AUDIT_TYPE, id: campaign.id, label: campaign.name },
      after: { baseAgentId: base.id, documents: docs.filter((d) => merged.includes(d.id)).map((d) => d.title) },
    });
  }
  revalidate(campaign.id);
  return merged.length === docs.length
    ? { ok: true, info: `${merged.length} item(ns) levado(s) para a base da ${base.name}.` }
    : { ok: false, error: `Só ${merged.length} de ${docs.length} itens foram levados. Tente de novo os que faltaram.` };
}
