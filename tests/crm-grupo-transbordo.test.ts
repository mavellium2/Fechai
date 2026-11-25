import { describe, expect, it } from "vitest";
import { handoffGroupReplies, parseHandoffGroupCommand } from "@/modules/crm/handoff-group";
import { EvolutionProvider } from "@/modules/whatsapp/evolution";

/** CRM-08: o que conta como comando no grupo de transbordo e o que o parser lê. */

const GROUP = "120363012345678901@g.us";

describe("comandos do grupo de transbordo", () => {
  it.each(["assumo", "Assumo!", "  ASSUMO  ", "eu", "Eu.", "pego", "eu pego", "deixa comigo", "Deixa comigo!!", "eu assumo"])(
    "%j assume", (text) => expect(parseHandoffGroupCommand(text, false)).toBe("assume"));

  it.each(["#ia", "#IA", " #ia ", "#ia!"])("%j devolve para a IA", (text) =>
    expect(parseHandoffGroupCommand(text, false)).toBe("return"));

  it.each(["", "assumo esse e o outro", "eu não", "quem assume?", "ia", "# ia", "ok", "👍"])(
    "%j não é comando", (text) => expect(parseHandoffGroupCommand(text, false)).toBeNull());

  it.each(["👍", "👍🏻", "👍🏽", "👍🏿", "👍️"])("reação %j assume", (emoji) =>
    expect(parseHandoffGroupCommand(emoji, true)).toBe("assume"));

  it.each(["❤️", "👎", "🙏", "assumo", "#ia"])("reação %j não é comando", (emoji) =>
    expect(parseHandoffGroupCommand(emoji, true)).toBeNull());

  it("mostra só o final do número de quem não está vinculado", () => {
    const text = handoffGroupReplies.assumedUnlinked("5511987654321");
    expect(text).toContain("final 4321");
    expect(text).not.toContain("987654321");
    expect(handoffGroupReplies.assumedUnlinked(null)).not.toContain("final");
  });
});

describe("parser da Evolution em grupo", () => {
  const provider = new EvolutionProvider();
  const parse = (data: Record<string, unknown>) => provider.parseWebhook({ event: "messages.upsert", instance: "inst", data });

  it("lê a mensagem citada numa resposta de grupo", () => {
    const incoming = parse({
      key: { remoteJid: GROUP, participant: "5511987654321@s.whatsapp.net", fromMe: false, id: "CMD1" },
      message: { extendedTextMessage: { text: "assumo", contextInfo: { stanzaId: "AVISO1" } } },
    });
    expect(incoming).toMatchObject({ isGroup: true, text: "assumo", quotedMessageId: "AVISO1", groupSender: { phone: "5511987654321" } });
    expect(incoming?.reactionTargetId).toBeUndefined();
  });

  it("aceita o contexto repetido fora de message, como algumas versões mandam", () => {
    const incoming = parse({
      key: { remoteJid: GROUP, participant: "5511987654321@s.whatsapp.net", id: "CMD2" },
      message: { conversation: "eu" },
      contextInfo: { stanzaId: "AVISO2" },
    });
    expect(incoming?.quotedMessageId).toBe("AVISO2");
  });

  it("lê o alvo da reação em grupo", () => {
    const incoming = parse({
      key: { remoteJid: GROUP, participant: "123456789012345@lid", id: "REA1" },
      message: { reactionMessage: { text: "👍", key: { remoteJid: GROUP, id: "AVISO1", fromMe: true } } },
    });
    expect(incoming).toMatchObject({ isReaction: true, reactionTargetId: "AVISO1", groupSender: { lid: "123456789012345" } });
    expect(incoming?.quotedMessageId).toBeUndefined();
  });

  it("fora de grupo não lê citação nem alvo de reação", () => {
    const incoming = parse({
      key: { remoteJid: "5511987654321@s.whatsapp.net", id: "PRIV1" },
      message: { extendedTextMessage: { text: "oi", contextInfo: { stanzaId: "QUALQUER" } } },
    });
    expect(incoming?.quotedMessageId).toBeUndefined();
    const reaction = parse({
      key: { remoteJid: "5511987654321@s.whatsapp.net", fromMe: true, id: "PRIV2" },
      message: { reactionMessage: { text: "👍", key: { id: "MSG" } } },
    });
    expect(reaction?.reactionTargetId).toBeUndefined();
  });

  it("ignora um id citado que não parece id de mensagem", () => {
    const incoming = parse({
      key: { remoteJid: GROUP, participant: "5511987654321@s.whatsapp.net", id: "CMD3" },
      message: { extendedTextMessage: { text: "assumo", contextInfo: { stanzaId: "x".repeat(300) } } },
    });
    expect(incoming?.quotedMessageId).toBeUndefined();
  });
});
