import { prisma } from "@/lib/prisma";
import type { LeadOriginChannel, Prisma } from "@prisma/client";
import { newLeadCrmFields } from "@/modules/crm/admission";
import { moveLeadToStage } from "@/modules/crm/automatic-stage";
import { assumeConversation, claimCrmConversation } from "@/modules/crm/assignments";
import { handoffGroupText, reflectHandoffInGroup, teamMemberName } from "@/modules/crm/handoff-panel";
import { closeHandoffNoticesTimed, markHandoffFirstReply } from "./handoff-notice";
import { leadOfConversation, recordCrmTrail, secondsBetween } from "@/modules/crm/trail";
import { crmReplyPaused, crmWhatsappReplyTarget } from "@/modules/crm/whatsapp-reply";
import { outsideMetaWindow } from "@/modules/scheduling/meta-reminder";
import { getWhatsAppProviderForInstance } from "@/modules/whatsapp/meta-config";
import {
  channelProvider,
  isEvolutionEnabled,
  isReadyChannel,
  isWhatsappProviderName,
  listWhatsappChannels,
  pickWhatsappChannel,
  setConversationChannel,
  type WhatsappChannel,
} from "@/modules/whatsapp/instances";
import { storeVoiceMessage } from "@/modules/voice/storage";
import { withConversationContactLock } from "./conversation-lock";
import { contactPhoneAliases } from "@/modules/whatsapp/contact-phone";
import { recordWhatsappInbound, type WhatsappContactInbound } from "@/modules/whatsapp/inbound-proof";

/**
 * Encontra (ou cria) o lead + conversa de um telefone, dentro do tenant.
 * Sempre isolado por tenantId.
 *
 * `isTest` marca o que veio do chat de teste (sandbox). A marca fica no lead e
 * é espelhada na conversa para as telas filtrarem sem join — sem ela o sandbox
 * era contado como cliente real em Contatos, Conversas e Relatórios.
 */
type ConversationCreation = {
  isTest?: boolean;
  originChannel?: LeadOriginChannel;
  /**
   * Nome do perfil como o WhatsApp mandou. Só o webhook passa, e só de
   * contato (nunca de grupo nem do eco da clínica): é o original guardado em
   * `Lead.whatsappName`, que a equipe não edita.
   */
  whatsappName?: string;
};

export async function getOrCreateConversation(
  tenantId: string,
  phone: string,
  name?: string,
  options: ConversationCreation = {},
) {
  return withConversationContactLock(tenantId, phone, (db) => getOrCreateLockedConversation(db, tenantId, phone, name, options));
}

async function getOrCreateLockedConversation(db: Prisma.TransactionClient, tenantId: string, phone: string, name: string | undefined, options: ConversationCreation) {
  const isTest = options.isTest ?? false;
  const profileName = options.whatsappName?.trim().slice(0, 120) || null;
  let lead = await db.lead.findFirst({
    where: { tenantId, phone },
    include: { conversation: true },
  });

  if (!lead && !isTest) {
    const aliases = contactPhoneAliases(phone).filter((alias) => alias !== phone);
    if (aliases.length) {
      const matches = await db.lead.findMany({ where: { tenantId, phone: { in: aliases } }, include: { conversation: true }, take: 2 });
      if (matches.length > 1) throw new Error("Mais de um contato corresponde a este telefone.");
      lead = matches[0] ?? null;
    }
  }

  if (!lead) {
    lead = await db.lead.create({
      data: {
        tenantId,
        phone,
        name,
        whatsappName: isTest ? null : profileName,
        isTest,
        originChannel: isTest ? null : options.originChannel,
        ...(!isTest && await newLeadCrmFields(db, tenantId)),
        conversation: { create: { tenantId, isTest } },
      },
      include: { conversation: true },
    });
  } else if (!lead.isTest) {
    // Uma conversa iniciada pelo atendente nasce sem nome. O primeiro perfil
    // recebido do próprio contato pode completar esse dado, mas nunca o nome
    // que a equipe definiu (`nameEditedAt`). O original do WhatsApp é sempre
    // registrado à parte, mesmo quando o nome que vale é outro.
    const fillName = !lead.name && !lead.nameEditedAt && name?.trim();
    const newProfile = profileName && profileName !== lead.whatsappName;
    if (fillName || newProfile) {
      lead = await db.lead.update({
        where: { id: lead.id },
        data: { ...(fillName && { name: fillName }), ...(newProfile && { whatsappName: profileName }) },
        include: { conversation: true },
      });
    }
  }

  if (!lead.conversation) {
    const conversation = await db.conversation.create({
      data: { tenantId, leadId: lead.id, isTest: lead.isTest },
    });
    lead = { ...lead, conversation };
  } else if (isTest && !lead.isTest) {
    // Sandbox de contas antigas: o lead "sandbox" já existia sem a marca.
    // Corrigir na leitura evita depender de o backfill ter rodado.
    await db.lead.update({ where: { id: lead.id }, data: { isTest: true } });
    await db.conversation.update({ where: { id: lead.conversation.id }, data: { isTest: true } });
    lead = { ...lead, isTest: true, conversation: { ...lead.conversation, isTest: true } };
  }

  return { lead, conversation: lead.conversation! };
}

/**
 * "Recomeçar" o chat de teste sem perder o histórico: em vez de apagar,
 * arquiva a conversa atual (sai do telefone canônico do sandbox, então o
 * próximo `getOrCreateConversation` não a encontra mais) e deixa um lead novo
 * nascer vazio na próxima mensagem. A arquivada continua no banco, visível em
 * Conversas (aba "Testes") — testar uma persona nova não pode custar o
 * histórico do teste anterior, mas também não pode vazar pro contexto do LLM
 * na próxima rodada.
 */
export async function startFreshTestConversation(tenantId: string, phone: string) {
  const lead = await prisma.lead.findFirst({ where: { tenantId, phone, isTest: true } });
  if (!lead) return;
  await prisma.lead.update({
    where: { id: lead.id },
    data: { phone: `${phone}:archived:${Date.now()}` },
  });
}

export async function appendMessage(
  conversationId: string,
  role: "user" | "assistant" | "system",
  content: string,
  /** Só relevante em `role: "assistant"` — quem gerou a resposta. Ver schema.prisma. */
  sentBy?: "agent" | "human",
  /** key.id no WhatsApp — só existe quando a mensagem foi enviada de verdade pela instância. */
  externalId?: string,
  /** URL do áudio na CDN, quando a mensagem foi entregue como voz. Ver schema. */
  audioUrl?: string | null,
  /** Duração do áudio recebido pelo webhook, em segundos. Ver schema. */
  audioSeconds?: number | null,
  whatsappInbound?: WhatsappContactInbound,
  /** Resposta da equipe pelo celular da clínica (CRM-09): por onde e quem, quando se sabe. */
  human?: { via: "phone"; userId: string | null },
) {
  const message = await prisma.message.create({
    data: {
      conversationId,
      role,
      content,
      sentBy,
      whatsappMessageId: externalId,
      audioUrl: audioUrl ?? null,
      audioSeconds: audioSeconds ?? null,
      ...(human ? { sentVia: human.via, sentByUserId: human.userId } : {}),
    },
  });
  if (role === "user") {
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastInboundAt: new Date() },
    });
    if (whatsappInbound) await recordWhatsappInbound(conversationId, whatsappInbound);
  }
  return message;
}

export type SendManualReplyResult = { ok: true } | { ok: false; error: string };

/**
 * Por que não há por onde responder. Com as duas conexões, "o WhatsApp não está
 * conectado" seria mentira quando só a do contato caiu — e a pessoa precisa
 * saber QUAL reconectar, porque responder pelo outro número seria primeiro
 * contato para o paciente.
 */
function noChannelMessage(channels: readonly WhatsappChannel[], preferred: string | null): string {
  if (isWhatsappProviderName(preferred) && channels.some(isReadyChannel)) {
    return preferred === "meta"
      ? "Este contato fala pela API oficial da Meta, que está desconectada agora. Reconecte em Integrações para responder."
      : "Este contato fala pelo número do QR code, que está desconectado agora. Reconecte em Integrações para responder.";
  }
  return "O WhatsApp não está conectado. Conecte na tela WhatsApp antes de enviar.";
}

/**
 * Núcleo de "um humano respondeu pelo painel" — compartilhado por
 * `conversas/actions.ts` (`sendManualMessage`, a partir de uma conversa já
 * aberta) e `contatos/actions.ts` (`sendMessageToContact`, a partir de um
 * lead). As duas telas faziam essa lógica em duplicado antes desta função
 * existir, cada uma só com metade do cuidado: nenhuma marcava `sentBy` nem
 * pausava o agente por conversa.
 *
 * Numa conversa real, envia de verdade pelo `WhatsAppProvider` — do número em
 * que o contato escreveu, quando a conta tem as duas conexões; numa de teste
 * (sandbox), só grava — sem WhatsApp real envolvido. Sempre grava com
 * `sentBy: "human"` e liga `agentPaused`, para `runAgentTurn` não responder
 * por cima na machine seguinte.
 *
 * Com `audio`, a mensagem sai como **voz** (PTT) em vez de texto. O `text`
 * continua obrigatório e continua sendo o que fica no histórico: é ele que vai
 * para o contexto do LLM, para o resumo e para a busca (ver `Message.audioUrl`
 * no schema). Quem chama decide de onde esse texto vem — do que foi digitado
 * (texto→voz) ou da transcrição do que foi gravado.
 */
export async function sendManualReply(
  tenantId: string,
  conversationId: string,
  text: string,
  /** Manda como mensagem de voz. Sem isto, envio de texto normal. */
  audio?: { buffer: Buffer; mime: string },
  crm?: { leadId: string; userId: string },
  /** Quem respondeu pelo painel, para o aviso de transbordo saber quem assumiu. */
  actorUserId?: string,
): Promise<SendManualReplyResult> {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "Escreva algo antes de enviar." };

  let target = crm ? await crmWhatsappReplyTarget(tenantId, crm.leadId, conversationId) : null;
  if (target && target.status !== "ready") return { ok: false, error: crmReplyPaused[target.status] };
  if (crm) {
    const claim = await claimCrmConversation({ tenantId, conversationId, ...crm });
    if (claim === "unavailable") return { ok: false, error: "Esta conversa está indisponível no CRM." };
    if (claim === "assigned_elsewhere") return { ok: false, error: "Outra pessoa já está atendendo esta conversa." };
    // Repete a leitura depois de assumir: a conexão e a janela podem mudar entre as duas etapas.
    target = await crmWhatsappReplyTarget(tenantId, crm.leadId, conversationId);
    if (target.status !== "ready") return { ok: false, error: crmReplyPaused[target.status] };
  }

  const conversation = target?.conversation ?? await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    select: { id: true, isTest: true, whatsappProvider: true, lead: { select: { phone: true } } },
  });
  if (!conversation) return { ok: false, error: "Conversa não encontrada." };

  let externalId: string | null = null;
  if (!conversation.isTest) {
    // Sai pelo número em que o contato escreveu (ver `pickWhatsappChannel`).
    const channels = target ? [] : await listWhatsappChannels(tenantId);
    const instance = target?.channel ?? pickWhatsappChannel(channels, conversation.whatsappProvider);
    if (!instance?.externalId) {
      // "Reconecte em Integrações" seria enganoso: o QR foi desligado pelo admin
      // e a conta não consegue religá-lo sozinha.
      if (conversation.whatsappProvider !== "meta" && !(await isEvolutionEnabled(tenantId))) {
        return {
          ok: false,
          error: "O WhatsApp por QR code foi desativado pelo administrador para esta conta. Fale com o suporte.",
        };
      }
      return { ok: false, error: noChannelMessage(channels, conversation.whatsappProvider) };
    }
    const toPhone = target?.proof.sender ?? ("lead" in conversation ? conversation.lead.phone : null);
    if (!toPhone) return { ok: false, error: "Telefone do contato indisponível." };
    try {
      // Grava o key.id da mensagem que acabamos de enviar: o webhook reentrega
      // tudo que a instância manda como fromMe, e sem esse id a resposta
      // manual apareceria duas vezes no histórico.
      const provider = getWhatsAppProviderForInstance(instance);
      if (target?.proof.provider === "evolution" && await provider.getConnectedPhone?.(instance.externalId) !== target.proof.receiver) {
        return { ok: false, error: "Aguarde o contato escrever para o número de WhatsApp conectado." };
      }
      if (target?.proof.provider === "meta" && outsideMetaWindow(target.at, new Date())) {
        return { ok: false, error: crmReplyPaused.window_closed };
      }
      externalId = audio
        ? await provider.sendAudio(instance.externalId, toPhone, {
            base64: audio.buffer.toString("base64"),
            mime: audio.mime,
          })
        : await provider.sendMessage(instance.externalId, toPhone, trimmed);
    } catch (err) {
      if (crm) {
        console.error("[crm] não foi possível confirmar a resposta pelo WhatsApp");
        return { ok: false, error: "Não foi possível confirmar o envio. Confira a conversa antes de tentar novamente." };
      }
      console.error("[agent-engine] falha ao enviar mensagem manual", err);
      return {
        ok: false,
        error: audio
          ? "Não foi possível enviar o áudio pelo WhatsApp. Tente de novo."
          : "Não foi possível enviar pelo WhatsApp. Tente de novo.",
      };
    }
    // Contato sem canal registrado (cadastrado à mão): o número por onde a
    // primeira mensagem saiu passa a ser o dele, e o follow-up segue por ali.
    await setConversationChannel(conversation, channelProvider(instance), { onlyIfUnset: true });
  }

  // Só guarda na CDN DEPOIS do envio: se o WhatsApp recusar, não sobra arquivo
  // órfão de uma mensagem que nunca existiu. Falhar aqui não desfaz o envio —
  // a mensagem entra no histórico com o texto e sem player (ver storage.ts).
  let audioUrl: string | null = null;
  if (audio) {
    audioUrl = await storeVoiceMessage({
      tenantId,
      conversationId,
      audio: audio.buffer,
      mime: audio.mime,
    });
  }

  const sent = await appendMessage(
    conversationId,
    "assistant",
    trimmed,
    "human",
    externalId ?? undefined,
    audioUrl,
  );
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { needsHuman: false, agentPaused: true },
  });
  // Respondeu por Conversas ou Contatos: quem respondeu assume, se ninguém
  // estava com a conversa (o CRM já assumiu antes do envio, acima). Assumir
  // fecha a espera e conta no grupo.
  if (!crm && actorUserId && !conversation.isTest) {
    await assumeConversation({ tenantId, conversationId, userId: actorUserId })
      .catch((error) => console.error("[conversas] resposta enviada sem registrar quem assumiu", error));
  }
  // Respondeu pelo painel: a espera da equipe acabou e tem nome. Se ainda havia
  // uma aberta (outra pessoa já era a responsável), o grupo também fica sabendo.
  const replier = crm?.userId ?? actorUserId ?? null;
  const repliedAt = sent?.createdAt ?? new Date();
  const wait = await closeHandoffNoticesTimed(tenantId, conversationId, { status: "assumed", via: "panel", userId: replier }, repliedAt);
  if (wait.closed > 0 && !conversation.isTest) {
    // A resposta encerrou a espera sem passar pelo Assumir (a conversa já era de
    // outra pessoa, ou de quem respondeu): um evento de assunção na trilha (CRM-11).
    if (replier) {
      await recordCrmTrail({
        tenantId, event: "handoff.assumed", actor: { kind: "user", userId: replier }, leadId: await leadOfConversation(tenantId, conversationId),
        meta: { via: "panel", action: "reply", conversationId, waitSeconds: secondsBetween(wait.since, repliedAt) },
      });
    }
    await reflectHandoffInGroup(tenantId, conversationId, handoffGroupText.assumed(await teamMemberName(tenantId, replier)));
  }
  if (!conversation.isTest) {
    await markHandoffFirstReply(tenantId, conversationId, repliedAt);
    await moveLeadToStage(tenantId, null, "human", "user", { reason: "human_reply", conversationId, userId: crm?.userId, key: sent?.id, at: sent?.createdAt });
  }

  return { ok: true };
}

export async function getRecentMessages(conversationId: string, limit = 10) {
  const rows = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: limit,
    // createdAt: o orquestrador avisa o LLM quando o histórico começa em outro
    // dia (ver `time-context.ts`).
    select: { role: true, content: true, createdAt: true },
  });
  return rows.reverse();
}
