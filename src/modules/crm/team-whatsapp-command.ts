import { rateLimit } from "@/lib/rate-limit";
import type { IncomingMessage, WhatsAppProvider } from "@/modules/whatsapp/provider";
import { confirmTeamWhatsappLink, learnTeamMemberLid, parseTeamLinkCommand, type ConfirmTeamLinkResult } from "./team-whatsapp";

const REPLIES: Record<ConfirmTeamLinkResult["status"], (name?: string) => string> = {
  verified: (name) => `Pronto, ${name}: este WhatsApp agora está ligado ao seu usuário no Fechai.`,
  invalid: () => "Código inválido ou vencido. Gere um novo em Configurações › Seu WhatsApp na equipe.",
  taken: () => "Este número já está ligado a outra pessoa da equipe no Fechai.",
  no_phone: () => "Não consegui ver o seu número neste grupo. Mande o mesmo código no privado para este WhatsApp.",
};

/**
 * Mensagem `#vincular CÓDIGO` mandada por alguém da equipe ao número da
 * clínica (só QR), no privado ou num grupo. Roda **antes** de abrir conversa,
 * cadastro ou turno do agente: um comando da equipe nunca vira lead nem gasta
 * IA.
 *
 * A resposta sai **só no grupo**. No privado o Fechai fica calado e a tela de
 * Configurações mostra a confirmação: o eco (`fromMe`) de uma resposta privada
 * chegaria ao webhook como "a equipe escreveu pelo celular" e abriria cadastro
 * e conversa para o número da pessoa. O eco de grupo já é descartado.
 *
 * `handled: true` sempre que a mensagem é o comando, mesmo com falha no
 * caminho: não pode cair no atendimento. **Nunca lança.**
 */
export async function handleTeamLinkCommand(input: {
  tenantId: string;
  incoming: IncomingMessage;
  provider: WhatsAppProvider;
}): Promise<{ handled: boolean }> {
  const { tenantId, incoming, provider } = input;
  if (provider.name !== "evolution" || incoming.isFromMe || incoming.isReaction || incoming.hasAudio) {
    return { handled: false };
  }
  const code = parseTeamLinkCommand(incoming.text);
  if (!code) return { handled: false };

  try {
    // Reentrega da mesma mensagem não responde duas vezes.
    if (incoming.messageKeyId && !(await rateLimit("crm:team-link:msg", incoming.messageKeyId, 1, 86_400)).allowed) {
      return { handled: true };
    }
    const sender = incoming.isGroup
      ? incoming.groupSender
      : { phone: incoming.fromPhone, lid: incoming.contactLid };
    const senderKey = sender?.phone ?? sender?.lid ?? incoming.fromPhone;
    if (!(await rateLimit("crm:team-link", `${tenantId}:${senderKey}`, 5, 900)).allowed) {
      return { handled: true };
    }

    const result = await confirmTeamWhatsappLink({ tenantId, code, senderPhone: sender?.phone, senderLid: sender?.lid });
    if (result.status === "verified") {
      // Import sob demanda: a auditoria puxa a sessão (next-auth), que o caminho
      // comum do webhook não precisa carregar.
      const { recordAudit } = await import("@/modules/audit/log");
      await recordAudit({
        event: "account.whatsapp_verified",
        tenantId,
        actor: { id: result.userId, role: "OWNER" },
        target: { type: "User", id: result.userId, label: result.name },
        meta: { via: incoming.isGroup ? "group" : "private" },
      });
    } else if (sender?.phone && sender.lid) {
      // Mesmo sem confirmar nada, um evento com os dois identificadores ensina o LID.
      await learnTeamMemberLid(tenantId, sender.phone, sender.lid);
    }
    await reply(input, REPLIES[result.status](result.status === "verified" ? result.name : undefined));
  } catch (error) {
    console.error("[crm] falha ao confirmar o WhatsApp de alguém da equipe", error);
  }
  return { handled: true };
}

async function reply(input: { incoming: IncomingMessage; provider: WhatsAppProvider }, text: string) {
  const { incoming, provider } = input;
  if (!incoming.isGroup) return;
  try {
    await provider.sendGroupMessage?.(incoming.instanceExternalId, `${incoming.fromPhone}@g.us`, text);
  } catch (error) {
    console.error("[crm] falha ao responder o #vincular no grupo", error);
  }
}
