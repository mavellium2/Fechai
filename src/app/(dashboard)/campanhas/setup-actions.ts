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
  const rules = parseCampaignRules(raw);
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
