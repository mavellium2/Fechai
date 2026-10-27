import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ $transaction: vi.fn(), $executeRaw: vi.fn(), knowledgeDocument: { updateMany: vi.fn() }, knowledgeChunk: { deleteMany: vi.fn(), create: vi.fn() } }));
const embeddings = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/bunny", () => ({ deleteFromBunny: vi.fn() }));
vi.mock("@/modules/knowledge-base/embeddings", () => ({ embedTexts: embeddings, isEmbeddingConfigured: () => true }));
import { publishDocumentDraft } from "@/modules/knowledge-base/repository";
import { cosineDistance } from "@/modules/agent-engine/sandbox-draft";
const edit = { title: "Novo", content: "Sábado fechado", baseTitle: "Antigo", baseContent: "Sábado aberto" };
beforeEach(() => { vi.clearAllMocks(); embeddings.mockResolvedValue([[1, 0]]); db.$transaction.mockImplementation(async f => f(db)); db.knowledgeDocument.updateMany.mockResolvedValue({ count: 1 }); db.knowledgeChunk.create.mockResolvedValue({ id: "chunk" }); });
describe("publicação do rascunho", () => {
  it("prepara vetores antes da transação e publica com escopo e versão esperada", async () => { expect(await publishDocumentDraft("tenant", "agent", "doc", edit)).toEqual({ ok: true, status: "ready" }); expect(db.knowledgeDocument.updateMany).toHaveBeenCalledWith({ where: { id: "doc", tenantId: "tenant", agentId: "agent", title: "Antigo", content: "Sábado aberto" }, data: { title: "Novo", content: "Sábado fechado", status: "ready" } }); expect(db.knowledgeChunk.deleteMany).toHaveBeenCalledWith({ where: { tenantId: "tenant", agentId: "agent", documentId: "doc" } }); expect(embeddings.mock.invocationCallOrder[0]).toBeLessThan(db.$transaction.mock.invocationCallOrder[0]); });
  it("conflito de versão não apaga nem troca trechos", async () => { db.knowledgeDocument.updateMany.mockResolvedValue({ count: 0 }); expect((await publishDocumentDraft("tenant", "agent", "doc", edit)).ok).toBe(false); expect(db.knowledgeChunk.deleteMany).not.toHaveBeenCalled(); expect(db.knowledgeChunk.create).not.toHaveBeenCalled(); });
  it("sem embeddings mantém a versão publicada intacta", async () => { embeddings.mockResolvedValue(null); expect((await publishDocumentDraft("tenant", "agent", "doc", edit)).ok).toBe(false); expect(db.$transaction).not.toHaveBeenCalled(); });
  it("falha de preparação não inicia transação", async () => { embeddings.mockRejectedValue(new Error("Provider offline")); await expect(publishDocumentDraft("tenant", "agent", "doc", edit)).rejects.toThrow(); expect(db.$transaction).not.toHaveBeenCalled(); });
  it("distância dos vetores usa cosseno, independentemente da escala", () => { expect(cosineDistance([1, 0], [5, 0])).toBe(0); expect(cosineDistance([1, 0], [0, 1])).toBe(1); expect(cosineDistance([], [])).toBe(1); });
});
