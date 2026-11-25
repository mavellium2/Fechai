import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const names = ["tenant", "user", "agent", "tenantAction", "knowledgeDocument", "knowledgeChunk", "lead", "pipeline", "pipelineStage", "leadTransition", "tag", "leadTag", "leadTask", "conversation", "conversationAssignment", "handoffNotice", "teamMemberWhatsapp", "message", "appointment", "whatsappBlockedNumber", "feedback", "tenantLeadValue", "tenantAttendanceCost", "referral", "auditLog", "whatsappInstance", "calendarIntegration", "calendarFeatures"];
  return {
    db: Object.fromEntries(names.map((name) => [name, { findUnique: vi.fn(), findMany: vi.fn() }])),
    auth: vi.fn(), audit: vi.fn(), clinicorp: vi.fn(),
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: mocks.db }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/modules/audit/log", () => ({ recordAudit: mocks.audit }));
vi.mock("@/modules/scheduling/clinicorp", () => ({ getClinicorpStatus: mocks.clinicorp }));

import { GET } from "@/app/api/admin/tenants/[id]/export/route";
import { exportJson } from "@/modules/admin/tenant-export";

const download = () => GET(new Request("https://fechai.test/api/admin/tenants/tenant-1/export"), { params: Promise.resolve({ id: "tenant-1" }) });

beforeEach(() => {
  vi.resetAllMocks();
  for (const model of Object.values(mocks.db)) {
    model.findUnique.mockResolvedValue(null);
    model.findMany.mockResolvedValue([]);
  }
  mocks.auth.mockResolvedValue({ user: { id: "admin-1", role: "SUPERADMIN" } });
  mocks.db.tenant.findUnique.mockResolvedValue({ id: "tenant-1", name: "Clínica", createdAt: new Date("2026-09-01T00:00:00Z"), crmActivationToken: "nao-exportar-preparo-crm" });
  mocks.clinicorp.mockResolvedValue({ checkAvailability: true });
});

describe("download dos dados de um tenant", () => {
  it.each([null, { user: { role: "OWNER", tenantId: "tenant-1" } }])("recusa sessão sem permissão antes de consultar dados", async (session) => {
    mocks.auth.mockResolvedValue(session);
    const response = await download();
    expect(response.status).toBe(session ? 403 : 401);
    expect(mocks.db.tenant.findUnique).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("devolve 404 para conta inexistente", async () => {
    mocks.db.tenant.findUnique.mockResolvedValue(null);
    expect((await download()).status).toBe(404);
    expect(mocks.db.message.findMany).not.toHaveBeenCalled();
  });

  it("baixa JSON completo em páginas, preserva textos longos e isola todas as coleções", async () => {
    const messages = Array.from({ length: 501 }, (_, i) => ({ id: `msg-${i}`, conversationId: "conv-1", content: "a".repeat(5001) }));
    mocks.db.message.findMany.mockImplementation(({ cursor }) => Promise.resolve(cursor ? messages.slice(500) : messages.slice(0, 500)));
    const pipeline = { id: "pipeline-1", tenantId: "tenant-1", key: "default" };
    const stage = { id: "stage-1", tenantId: "tenant-1", pipelineId: pipeline.id, kind: "new" };
    const transition = { id: "transition-1", tenantId: "tenant-1", leadId: "lead-1", toStageId: stage.id, dimension: "stage" };
    mocks.db.pipeline.findMany.mockResolvedValue([pipeline]);
    mocks.db.pipelineStage.findMany.mockResolvedValue([stage]);
    mocks.db.leadTransition.findMany.mockResolvedValue([transition]);
    mocks.db.auditLog.findMany.mockResolvedValue([{ id: "log-1", before: { apiToken: "nunca-exportar", nested: { passwordHash: "hash-secreto" } } }]);
    const response = await download();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Content-Disposition")).toMatch(/attachment; filename="fechai-tenant-tenant-1-.*\.json"/);
    const text = await response.text();
    const data = JSON.parse(text);
    expect(data.completed).toBe(true);
    expect(data.messages).toHaveLength(501);
    expect(data.messages[500].content).toHaveLength(5001);
    expect(data.counts.messages).toBe(501);
    expect(data.pipelines).toEqual([pipeline]);
    expect(data.pipelineStages).toEqual([stage]);
    expect(data.leadTransitions).toEqual([transition]);
    expect(data.counts).toMatchObject({ pipelines: 1, pipelineStages: 1, leadTransitions: 1 });
    expect(data.tenant.createdAt).toBe("2026-09-01T00:00:00.000Z");
    expect(text).not.toContain("nunca-exportar");
    expect(text).not.toContain("hash-secreto");
    expect(text).not.toContain("nao-exportar-preparo-crm");
    expect(mocks.db.tenant.findUnique).toHaveBeenCalledWith({ where: { id: "tenant-1" }, omit: { crmActivationToken: true } });
    for (const [name, model] of Object.entries(mocks.db)) {
      for (const [args] of model.findMany.mock.calls) {
        expect(args.where).toEqual(name === "message" ? { conversation: { tenantId: "tenant-1" } } : { tenantId: "tenant-1" });
      }
    }
    expect(mocks.db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ omit: { passwordHash: true } }));
    expect(mocks.db.teamMemberWhatsapp.findMany).toHaveBeenCalledWith(expect.objectContaining({ omit: { codeHash: true } }));
    expect(mocks.db.handoffNotice.findMany).toHaveBeenCalled();
    expect(mocks.db.calendarIntegration.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: "tenant-1" }, omit: { accessToken: true, refreshToken: true } }));
    expect(mocks.clinicorp).toHaveBeenCalledWith("tenant-1");
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ event: "admin.tenant_export_requested", tenantId: "tenant-1" }));
  });

  it("não entrega um arquivo válido parcial quando a leitura falha", async () => {
    mocks.db.message.findMany.mockRejectedValue(new Error("banco indisponível"));
    const response = await download();
    await expect(response.text()).rejects.toThrow("Não foi possível concluir");
  });

  it("remove credenciais aninhadas sem truncar listas, datas, IDs ou valores", () => {
    const data = JSON.parse(exportJson({
      list: Array.from({ length: 80 }, () => ({ config: { refreshToken: "segredo", metaAccessTokenEncrypted: "cifrado", apiUser: "usuario-api" } })),
      content: "x".repeat(6000), id: BigInt("9223372036854775807"), minutesBefore: 1440,
    }));
    expect(data.list).toHaveLength(80);
    expect(data.list[0].config).toEqual({ refreshToken: "[oculto]", metaAccessTokenEncrypted: "[oculto]", apiUser: "[oculto]" });
    expect(data.content).toHaveLength(6000);
    expect(data.id).toBe("9223372036854775807");
    expect(data.minutesBefore).toBe(1440);
  });
});
