import { afterEach, describe, expect, it, vi } from "vitest";
import { HISTORY_PAGE_SIZE, historyPhoneAliases, readEvolutionHistoryPage, readHistoryMessage } from "@/modules/whatsapp/evolution-history";

const since = new Date("2026-09-26T12:00:00Z");
const until = new Date("2026-10-26T12:00:00Z");
const row = (overrides: Record<string, unknown> = {}) => ({
  id: "source-1", key: { id: "wa-1", fromMe: false, remoteJid: "5511987654321@s.whatsapp.net" },
  pushName: "Contato", messageTimestamp: Date.parse("2026-10-10T11:26:00Z") / 1000,
  message: { ephemeralMessage: { message: { extendedTextMessage: { text: "Quero informações" } } } }, ...overrides,
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Fonte do histórico de toda a instância", () => {
  it("consulta sem filtro de contato, com janela ISO e paginação limitada", async () => {
    vi.stubEnv("EVOLUTION_API_URL", "https://evolution.test/"); vi.stubEnv("EVOLUTION_API_KEY", "secret");
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => ({ messages: { total: 101, pages: 2, currentPage: 2, records: [row()] } }) }));
    vi.stubGlobal("fetch", fetcher);
    await readEvolutionHistoryPage("instance/name", since, until, 2);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://evolution.test/chat/findMessages/instance%2Fname");
    expect(JSON.parse(String(init.body))).toEqual({ where: { messageTimestamp: { gte: since.toISOString(), lte: until.toISOString() } }, page: 2, offset: HISTORY_PAGE_SIZE });
  });
  it.each([{}, { messages: {} }, { messages: { total: 101, pages: 1, records: [] } }, { messages: { total: 0, pages: 0, currentPage: 99, records: [] } }])("não trata resposta incompleta como histórico vazio", async (body) => {
    vi.stubEnv("EVOLUTION_API_URL", "https://evolution.test"); vi.stubEnv("EVOLUTION_API_KEY", "secret");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => body })));
    await expect(readEvolutionHistoryPage("clinic", since, until, 1)).rejects.toThrow(/incompleto/);
  });
  it("mantém id, data original e fala temporária do contato", () => {
    expect(readHistoryMessage(row(), "clinic", since, until)).toMatchObject({ message: {
      id: "wa-1", sourceId: "source-1", phone: "5511987654321", text: "Quero informações", fromMe: false, at: new Date("2026-10-10T11:26:00Z"),
    } });
  });
  it("não transforma LID sem telefone em número, nem nome da clínica em nome do contato", () => {
    expect(readHistoryMessage(row({ key: { id: "wa", fromMe: false, remoteJid: "123456789012345@lid" } }), "clinic", since, until)).toEqual({ skipped: "unresolvedPhone" });
    expect(readHistoryMessage(row({ key: { id: "wa", fromMe: true, remoteJid: "5511987654321@s.whatsapp.net" } }), "clinic", since, until)).toMatchObject({ message: { fromMe: true, name: undefined } });
  });
  it("confere a janela localmente e exige id, autoria e timestamp reais", () => {
    expect(readHistoryMessage(row({ messageTimestamp: 1 }), "clinic", since, until)).toEqual({ skipped: "outsideWindow" });
    for (const overrides of [{ messageTimestamp: undefined }, { messageTimestamp: {} }, { key: { id: "wa", remoteJid: "5511987654321@s.whatsapp.net" } }, { id: "" }]) {
      expect(readHistoryMessage(row(overrides), "clinic", since, until)).toEqual({ skipped: "invalid" });
    }
  });
  it("não inventa transcrição nem arquivo, mas preserva legenda e duração", () => {
    expect(readHistoryMessage(row({ message: { audioMessage: { seconds: 18 } } }), "clinic", since, until)).toMatchObject({ message: { text: "[Áudio]", audioSeconds: 18, mediaWithoutFile: true } });
    expect(readHistoryMessage(row({ message: { imageMessage: { caption: "Minha dúvida" } } }), "clinic", since, until)).toMatchObject({ message: { text: "[Imagem] Minha dúvida", mediaWithoutFile: true } });
  });
  it("exclui grupos, status e reações", () => {
    expect(readHistoryMessage(row({ key: { id: "wa", fromMe: false, remoteJid: "123@g.us" } }), "clinic", since, until)).toEqual({ skipped: "ignored" });
    expect(readHistoryMessage(row({ message: { reactionMessage: { text: "👍" } } }), "clinic", since, until)).toEqual({ skipped: "ignored" });
  });
  it("não amplia aliases para fixos ou estrangeiros", () => {
    expect(historyPhoneAliases("5511987654321")).toEqual(["5511987654321", "551187654321"]);
    expect(historyPhoneAliases("551187654321")).toEqual(["551187654321", "5511987654321"]);
    expect(historyPhoneAliases("551132345678")).toEqual(["551132345678"]);
    expect(historyPhoneAliases("14155552671")).toEqual(["14155552671"]);
  });
});
