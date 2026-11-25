import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn(), move: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/require-product", () => ({ requireProductAccess: mocks.access }));
vi.mock("@/modules/crm/lead-stage", () => ({ setLeadStage: mocks.move }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));

import { moveCrmCard } from "@/app/(dashboard)/crm/actions";

function cardForm(reason?: string, note?: string) {
  const form = new FormData();
  form.set("leadId", "lead-1");
  form.set("stageId", "destino-1");
  form.set("fromStageId", "etapa-1");
  form.set("tenantId", "outra-conta");
  form.set("userId", "outro-usuario");
  if (reason) form.set("reason", reason);
  if (note) form.set("lossReasonNote", note);
  return form;
}

describe("ação de movimentar card no CRM", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ user: {} });
    mocks.access.mockResolvedValue({ session: { user: { id: "autor-real", tenantId: "conta-real", role: "OWNER" } } });
  });

  it("deriva conta e ator da sessão e exige origem da movimentação", async () => {
    mocks.move.mockResolvedValue("moved");
    expect(await moveCrmCard(null, cardForm("preco", "Cliente confirmou a decisão."))).toMatchObject({ ok: true });
    expect(mocks.move).toHaveBeenCalledWith({ tenantId: "conta-real", userId: "autor-real", leadId: "lead-1",
      expectedStageId: "etapa-1", stageId: "destino-1", source: "user", reason: "preco", lossReasonNote: "Cliente confirmou a decisão." });
    expect(mocks.revalidate).toHaveBeenCalledWith("/crm");
  });

  it("recusa envio sem sessão ou com motivo livre", async () => {
    mocks.auth.mockResolvedValueOnce(null);
    expect(await moveCrmCard(null, cardForm())).toMatchObject({ code: "auth" });
    expect(await moveCrmCard(null, cardForm("texto livre"))).toMatchObject({ code: "validation" });
    expect(mocks.move).not.toHaveBeenCalled();
  });

  it("mostra a recusa da regra de justificativa ao mover para Perdido", async () => {
    mocks.move.mockResolvedValue("loss_note_required");
    expect(await moveCrmCard(null, cardForm("preco"))).toMatchObject({
      ok: false, code: "validation", error: expect.stringContaining("justificativa"),
    });
  });
});
