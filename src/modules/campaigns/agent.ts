import type { LlmToolSchema } from "@/modules/ai";
import { prisma } from "@/lib/prisma";
import { isOverrideCampaignId } from "@/modules/campaign-override/agent";
import type { ScheduleConfig } from "@/modules/scheduling/config";
import { hasConflictAnywhere, listFreeSlots } from "@/modules/scheduling/repository";
import type { ToolContext } from "@/modules/agent-engine/tools";
import { findLeadCampaign } from "./active";
import { describeAllowedSlots } from "./rules";
import { campaignSlotsContext } from "./slots";

/**
 * O que a campanha acrescenta ao turno do agente: a frase de recusa fora da
 * regra, as vagas da campanha em `list_available_slots`, o envio de arquivos
 * da campanha e o transbordo da campanha (quando `handoff_human` não está
 * ligado no agente).
 */

/** Recusa de horário fora da regra, com o próximo passo que a campanha manda. */
export function campaignOutsideReply(ctx: ToolContext, problem: string): string {
  const rules = ctx.campaign?.rules;
  const arrival = rules?.arrival ? ` Ao confirmar, informe a chegada: ${rules.arrival}.` : "";
  const next =
    rules?.outside === "handoff"
      ? " Não agende. Ofereça as opções da campanha; se o contato não puder em nenhuma, registre o interesse e transfira para um atendente."
      : " Não agende. Ofereça as opções da campanha e explique que nesta campanha só há essas.";
  return `Horário recusado pela regra da campanha. ${problem}${next}${arrival}`;
}

/** As vagas da campanha, para `list_available_slots` e para a recusa por conflito. */
export async function campaignSlotsForTool(ctx: ToolContext, cfg: ScheduleConfig, fromDate: string, days = 14): Promise<string> {
  if (ctx.campaign === undefined) ctx.campaign = await findLeadCampaign(ctx.tenantId, ctx.leadId);
  const campaign = ctx.campaign;
  if (!campaign) return "";
  try {
    return await campaignSlotsContext({
      tenantId: ctx.tenantId,
      cfg,
      rules: campaign.rules,
      campaignName: campaign.campaign.name,
      fromDate,
      days,
      listFreeSlots: (date) => listFreeSlots(ctx.tenantId, cfg, date),
      hasConflict: (startsAt, endsAt) => hasConflictAnywhere(ctx.tenantId, startsAt, endsAt, cfg.timezone),
      // Campanha de implantes sem vaga em nenhum dos dois dias: a conversa vai
      // para a equipe pelo mesmo transbordo de sempre, sem depender de a IA pedir.
      // (As `Campaign` reais seguem como antes: só o texto manda transferir.)
      onNoSlots: isOverrideCampaignId(campaign.campaign.id) && campaign.rules.outside === "handoff" && !ctx.dryRun
        ? async () => {
            const { transferToHuman } = await import("@/modules/agent-engine/tools");
            await transferToHuman(ctx, "Campanha de implantes: sem vaga em 18 ou 19/11");
          }
        : undefined,
    });
  } catch (err) {
    console.error("[campanhas] vagas da campanha indisponíveis", err);
    return `Não consegui conferir as vagas agora. As opções da campanha são: ${describeAllowedSlots(campaign.rules)}. Não confirme horário sem conferir.`;
  }
}

/**
 * A recusa da regra com a saída certa. Na campanha de implantes, quando o
 * horário recusado era uma vaga lotada, já devolve as vagas que sobraram (o
 * outro dia) ou, sem nenhuma, transfere — "esgotado um dia, oferece o outro".
 * `full` = a recusa foi por lotação. As `Campaign` reais não mudam.
 */
export async function campaignRefusalReply(ctx: ToolContext, cfg: ScheduleConfig, problem: string, full: boolean, date: string): Promise<string> {
  const reply = campaignOutsideReply(ctx, problem);
  if (!full || !isOverrideCampaignId(ctx.campaign?.campaign.id)) return reply;
  return `${reply}\n${await campaignSlotsForTool(ctx, cfg, date)}`;
}

export const SEND_CAMPAIGN_MEDIA ="send_campaign_media";
export const CAMPAIGN_HANDOFF = "campaign_handoff";

/** Só existe no turno de lead com campanha que tem arquivo para o agente. */
export function sendCampaignMediaSchema(assetIds: string[]): LlmToolSchema {
  return {
    name: SEND_CAMPAIGN_MEDIA,
    description:
      "Envia ao contato um arquivo da campanha (imagem, vídeo, PDF ou áudio) logo depois da sua resposta. Use só quando a instrução do arquivo pedir ou o contato quiser ver. Não envie o mesmo arquivo duas vezes.",
    parameters: {
      type: "object",
      properties: { assetId: { type: "string", enum: assetIds, description: "Id do arquivo da campanha" } },
      required: ["assetId"],
    },
  };
}

/** Transbordo da campanha, para agente sem `handoff_human` ligado. */
export const campaignHandoffSchema: LlmToolSchema = {
  name: CAMPAIGN_HANDOFF,
  description:
    "Passa a conversa para a equipe quando o contato da campanha não pode em nenhuma das datas/horários da campanha. Registre o interesse antes. Depois, diga que a equipe vai entrar em contato.",
  parameters: {
    type: "object",
    properties: { reason: { type: "string", description: "O que o contato pediu (ex.: quer outra data)." } },
  },
};

/**
 * Põe o arquivo na fila de envio do turno (sai depois do texto, pelo mesmo
 * número da conversa). Grava no vínculo do lead que já foi enviado, para não
 * repetir em outro turno. Nunca lança.
 */
export async function queueCampaignMedia(ctx: ToolContext, args: Record<string, unknown>): Promise<string> {
  if (ctx.campaign === undefined) ctx.campaign = await findLeadCampaign(ctx.tenantId, ctx.leadId);
  const campaign = ctx.campaign;
  const assetId = typeof args.assetId === "string" ? args.assetId : "";
  const asset = campaign?.assets.find((a) => a.id === assetId);
  if (!campaign || !asset) return "Arquivo não encontrado nesta campanha. Não diga que enviou.";
  if (campaign.sentAssetIds.includes(asset.id) || ctx.outgoingMedia?.some((m) => m.assetId === asset.id)) {
    return "Esse arquivo já foi enviado a este contato. Não envie de novo.";
  }
  if (ctx.dryRun) return `Simulação: o arquivo "${asset.name}" seria enviado depois da sua resposta.`;
  ctx.outgoingMedia = [
    ...(ctx.outgoingMedia ?? []),
    { assetId: asset.id, url: asset.url, kind: asset.kind, name: asset.name, mime: asset.mime },
  ];
  await prisma.campaignLead
    .updateMany({
      where: { campaignId: campaign.campaign.id, leadId: ctx.leadId, tenantId: ctx.tenantId },
      data: { sentAssetIds: { push: asset.id } },
    })
    .catch((err) => console.error("[campanhas] envio de arquivo não registrado", err));
  return `O arquivo "${asset.name}" será enviado logo depois da sua resposta. Pode mencioná-lo.`;
}
