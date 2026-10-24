import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  appointmentReschedule: { create: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
  tenantAction: { findFirst: vi.fn(), findUnique: vi.fn() },
  appointment: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  conversation: { update: vi.fn(), updateMany: vi.fn() },
  lead: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
}));
const mirrors = vi.hoisted(() => ({ googlePush: vi.fn(), googleDelete: vi.fn(), clinicorpPush: vi.fn(), clinicorpCancel: vi.fn(), clinicorpConflict: vi.fn(), clinicorpBusy: vi.fn(), clinicorpPending: vi.fn() }));
const icloud = vi.hoisted(() => ({ push: vi.fn(), update: vi.fn(), remove: vi.fn(), busy: vi.fn(), conflict: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/modules/scheduling/icloud", () => ({
  pushEventToIcloud: icloud.push, updateIcloudEvent: icloud.update, deleteIcloudEvent: icloud.remove,
  listIcloudBusyBlocks: icloud.busy, hasIcloudConflict: icloud.conflict,
}));
vi.mock("@/modules/scheduling/google", () => ({ pushEventToGoogle: mirrors.googlePush, deleteEventFromGoogle: mirrors.googleDelete }));
vi.mock("@/modules/scheduling/clinicorp", () => ({ pushAppointmentToClinicorp: mirrors.clinicorpPush, cancelAppointmentInClinicorp: mirrors.clinicorpCancel, hasClinicorpConflict: mirrors.clinicorpConflict, listClinicorpBusyBlocks: mirrors.clinicorpBusy, clinicorpConfirmationPending: mirrors.clinicorpPending }));
vi.mock("@/modules/scheduling/clinicorp-sync", () => ({
  syncAppointmentToClinicorp: (tenantId: string, _id: string, input: unknown) => mirrors.clinicorpPush(tenantId, input),
}));
vi.mock("@/modules/agent-engine/handoff", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/agent-engine/handoff")>()),
  notifyHandoffGroup: vi.fn(),
}));

import { getToolSchemas, runToolHandler, type ToolContext } from "@/modules/agent-engine/tools";
import { parseScheduleConfig } from "@/modules/scheduling/config";
import { leadAppointmentsContext, offerAlternativeSlots } from "@/modules/agent-engine/scheduling-tools";
import { emptyWeek } from "@/modules/scheduling/weekly-availability";

const ctx = { tenantId: "conta-1", leadId: "cliente-1", agentId: "agente-1", conversationId: "conversa-1" };
const cfg = parseScheduleConfig({ allowCancellation: true, allowRescheduling: true, breaks: [{ label: "Almoço", startTime: "12:00", endTime: "13:00" }] });
const appointment = {
  id: "consulta-1", tenantId: ctx.tenantId, leadId: ctx.leadId, status: "scheduled",
  startsAt: new Date("2026-09-17T13:00:00Z"), endsAt: new Date("2026-09-17T13:30:00Z"),
  title: "Consulta", notes: null, googleEventId: "google-antigo", clinicorpAppointmentId: "123",
  remindersSent: [1440], reminderSentAt: new Date("2026-09-16T11:00:00Z"),
};
const cancel = (args = {}) => runToolHandler("cancel_meeting", ctx, { appointmentId: appointment.id, confirmed: true, ...args });
const reschedule = (args = {}) => runToolHandler("reschedule_meeting", ctx, { appointmentId: appointment.id, date: "2026-09-18", time: "14:00", confirmed: true, ...args });

beforeEach(() => {
  vi.clearAllMocks();
  delete (ctx as ToolContext).replyOverride;
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-16T12:00:00Z"));
  db.tenantAction.findFirst.mockResolvedValue({ config: cfg });
  db.tenantAction.findUnique.mockResolvedValue({ config: cfg });
  db.appointment.findFirst.mockImplementation(async ({ where }) => where.id === appointment.id && where.tenantId === ctx.tenantId && where.leadId === ctx.leadId ? { ...appointment } : null);
  db.appointment.findMany.mockResolvedValue([appointment]);
  db.appointment.updateMany.mockResolvedValue({ count: 1 });
  db.$transaction.mockImplementation((work: (tx: typeof db) => Promise<unknown>) => work(db));
  db.appointmentReschedule.create.mockResolvedValue({ id: "historico-1" });
  db.appointmentReschedule.deleteMany.mockResolvedValue({ count: 1 });
  db.lead.findFirst.mockResolvedValue({ name: "Cliente", phone: "5511999999999" });
  mirrors.googleDelete.mockResolvedValue(true);
  mirrors.clinicorpCancel.mockResolvedValue(true);
  mirrors.googlePush.mockResolvedValue("google-novo");
  mirrors.clinicorpPush.mockResolvedValue({ status: "synced", appointmentId: "456" });
  mirrors.clinicorpConflict.mockResolvedValue(false);
  mirrors.clinicorpBusy.mockResolvedValue([]);
  mirrors.clinicorpPending.mockResolvedValue(false);
  icloud.push.mockResolvedValue({ status: "skipped" });
  icloud.update.mockResolvedValue({ status: "skipped" });
  icloud.remove.mockResolvedValue(true);
  icloud.busy.mockResolvedValue([]);
  icloud.conflict.mockResolvedValue(false);
});
afterEach(() => vi.useRealTimers());

describe("agenda externa sem disponibilidade confirmada", () => {
  it("busca o próximo dia e respeita a duração inteira ao oferecer alternativas", async () => {
    const week = emptyWeek();
    week[4] = [{ start: 840, end: 900 }];
    week[5] = [{ start: 840, end: 1080 }];
    db.appointment.findMany.mockResolvedValue([]);
    mirrors.clinicorpBusy.mockImplementation(async (_tenant, date) => date === "2026-09-18"
      ? [{ startsAt: new Date("2026-09-18T17:30Z"), endsAt: new Date("2026-09-18T18:00Z") }] : []);
    const turn: ToolContext = { ...ctx };
    const reply = await offerAlternativeSlots(turn, { ...cfg, weeklyAvailability: week }, new Date("2026-09-17T17:00Z"), 60);
    expect(reply).toContain("18 de set.");
    expect(reply).toContain("15:00");
    expect(reply).toContain("16:00");
    expect(reply).not.toContain("14:00");
    expect(db.appointment.create).not.toHaveBeenCalled();
    expect(db.conversation.updateMany).not.toHaveBeenCalled();
  });
  it("marca a alternativa escolhida em uma nova resposta do cliente após recusa", async () => {
    db.appointment.findMany.mockResolvedValue([]);
    db.appointment.create.mockResolvedValue({ id: "tentativa" });
    db.appointment.update.mockResolvedValue({});
    db.lead.findUnique.mockResolvedValue({ name: "Paciente", phone: "5511999999999" });
    db.lead.update.mockResolvedValue({});
    mirrors.clinicorpPush.mockResolvedValueOnce({ status: "failed", reason: "conflict", error: "Horário ocupado" });
    const first = await runToolHandler("schedule_meeting", { ...ctx }, { date: "2026-09-18", time: "14:00", patientName: "Paciente" });
    expect(first).toContain("Qual fica melhor");
    const second = await runToolHandler("schedule_meeting", { ...ctx }, { date: "2026-09-18", time: "09:00", patientName: "Paciente" });
    expect(second).toContain("Agendado para");
    expect(db.lead.update).toHaveBeenCalledOnce();
    expect(db.conversation.updateMany).not.toHaveBeenCalled();
    expect(mirrors.googlePush).toHaveBeenCalledOnce();
  });
  it("não oferece horários quando não consegue ler a agenda", async () => {
    const turn: ToolContext = { ...ctx };
    mirrors.clinicorpBusy.mockResolvedValue(null);
    const result = await runToolHandler("list_available_slots", turn, { date: "2026-09-17", days: 1 });
    expect(result).toContain("Não foi possível conferir");
    expect(turn.replyOverride).toContain("Ainda não confirmei");
    expect(db.appointment.create).not.toHaveBeenCalled();
  });
  it("não cria reserva se a checagem final falha", async () => {
    db.appointment.findMany.mockResolvedValue([]);
    mirrors.clinicorpConflict.mockResolvedValue(null);
    const turn: ToolContext = { ...ctx };
    await runToolHandler("schedule_meeting", turn, { date: "2026-09-17", time: "14:00", patientName: "Paciente" });
    expect(turn.replyOverride).toContain("Ainda não confirmei");
    expect(db.appointment.create).not.toHaveBeenCalled();
    expect(mirrors.clinicorpPush).not.toHaveBeenCalled();
  });
  it("preserva o horário original quando não consegue conferir o reagendamento", async () => {
    mirrors.clinicorpConflict.mockResolvedValue(null);
    expect(await reschedule()).toContain("Não foi possível conferir");
    expect(db.appointment.updateMany).not.toHaveBeenCalled();
    expect(mirrors.clinicorpCancel).not.toHaveBeenCalled();
    delete (ctx as ToolContext).replyOverride;
  });
  it.each(["schedule_meeting", "reschedule_meeting"])("oferece alternativas sem transferir após recusa por conflito: %s", async (tool) => {
    const turn: ToolContext = { ...ctx };
    db.appointment.findMany.mockResolvedValue([]);
    db.appointment.create.mockResolvedValue({ id: "nova-consulta" });
    db.appointment.update.mockResolvedValue({});
    db.lead.findUnique.mockResolvedValue({ name: "Paciente", phone: "5511999999999" });
    db.lead.update.mockResolvedValue({});
    mirrors.clinicorpPush.mockResolvedValueOnce({ status: "failed", reason: "conflict", error: "O horário solicitado encontra-se ocupado" });
    const result = await runToolHandler(tool, turn, { appointmentId: appointment.id, confirmed: true, date: "2026-09-18", time: "14:00", patientName: "Paciente" });
    expect(result).toContain("Encontrei estas opções disponíveis");
    expect(turn.replyOverride).toContain("Qual fica melhor para você?");
    expect(result).not.toContain("14:00");
    expect(db.conversation.updateMany).not.toHaveBeenCalled();
    if (tool === "schedule_meeting") {
      expect(db.appointment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: "canceled", reminderOverride: [] }),
      }));
      expect(db.lead.update).not.toHaveBeenCalled();
      expect(mirrors.googlePush).not.toHaveBeenCalled();
    } else {
      expect(db.appointment.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ startsAt: appointment.startsAt, endsAt: appointment.endsAt,
          remindersSent: { set: appointment.remindersSent }, reminderSentAt: appointment.reminderSentAt }),
      }));
      expect(mirrors.clinicorpPush).toHaveBeenLastCalledWith(ctx.tenantId, expect.objectContaining({ startsAt: appointment.startsAt, endsAt: appointment.endsAt }));
    }
  });
});

describe("permissões dentro de Agendar horário", () => {
  it("expõe cada ferramenta só com a opção habilitada e a ação principal ativa", () => {
    const names = (keys: string[], config = cfg) => getToolSchemas(keys, config).map((s) => s.name);
    expect(names([])).toEqual([]);
    expect(names(["schedule_meeting"])).toEqual(expect.arrayContaining(["list_appointments", "cancel_meeting", "reschedule_meeting"]));
    expect(names(["schedule_meeting"], { ...cfg, allowCancellation: false })).not.toContain("cancel_meeting");
    expect(names(["schedule_meeting"], { ...cfg, allowRescheduling: false })).not.toContain("reschedule_meeting");
  });
  it("recusa execução direta com a ação principal desligada", async () => {
    db.tenantAction.findFirst.mockResolvedValue(null);
    expect(await cancel()).toContain("desabilitado");
    expect(db.appointment.findFirst).not.toHaveBeenCalled();
    expect(db.tenantAction.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: ctx.tenantId, agentId: ctx.agentId, key: "schedule_meeting", enabled: true } }));
  });
  it.each(["cancel_meeting", "reschedule_meeting"])("recusa %s com a opção desligada", async (name) => {
    db.tenantAction.findFirst.mockResolvedValue({ config: { ...cfg, allowCancellation: false, allowRescheduling: false } });
    expect(await runToolHandler(name, ctx, { appointmentId: appointment.id, confirmed: true })).toContain("desabilitada");
    expect(db.appointment.updateMany).not.toHaveBeenCalled();
  });
  it("não altera consulta de outra pessoa nem outra conta", async () => {
    for (const scope of [{ ...ctx, leadId: "outro-cliente" }, { ...ctx, tenantId: "outra-conta" }]) {
      expect(await runToolHandler("cancel_meeting", scope, { appointmentId: appointment.id, confirmed: true })).toContain("não encontrada");
    }
    expect(db.appointment.updateMany).not.toHaveBeenCalled();
  });
});

describe("cancelamento", () => {
  it("preserva observações anteriores e registra apenas o motivo informado", async () => {
    db.appointment.findFirst.mockResolvedValue({ ...appointment, notes: "Avaliação de implante. Não apagar." });
    await cancel({ reason: "Não posso ir por causa do trabalho" });
    const change = db.appointment.updateMany.mock.calls[0][0];
    expect(change.data.notes).toBe("Avaliação de implante. Não apagar.\n\nCancelado em 16/09/2026 às 09:00 (America/Sao_Paulo) pelo agente. Motivo informado: Não posso ir por causa do trabalho");
    expect(change.data).not.toHaveProperty("startsAt");
    expect(change.data).not.toHaveProperty("endsAt");
    expect(change.where.notes).toBe("Avaliação de implante. Não apagar.");
  });
  it("não inventa motivo nem confirma conclusão externa quando o Clinicorp falha", async () => {
    mirrors.clinicorpCancel.mockResolvedValue(false);
    const reply = await cancel();
    expect(reply).toContain("Clinicorp não confirmou");
    expect(reply).not.toContain("Cancelamento feito");
    expect(db.appointment.updateMany.mock.calls[0][0].data.notes).not.toContain("Motivo");
  });
  it("não chama espelhos quando a consulta ou suas observações mudam durante o cancelamento", async () => {
    db.appointment.updateMany.mockResolvedValue({ count: 0 });
    expect(await cancel()).toContain("mudou");
    expect(mirrors.clinicorpCancel).not.toHaveBeenCalled();
    expect(mirrors.googleDelete).not.toHaveBeenCalled();
  });
  it.each([false, undefined, "true"])("não cancela sem confirmação explícita (%s)", async (confirmed) => {
    expect(await cancel({ confirmed })).toContain("Nenhuma alteração");
    expect(db.appointment.updateMany).not.toHaveBeenCalled();
    expect(mirrors.clinicorpCancel).not.toHaveBeenCalled();
  });
  it("cancela a consulta identificada e remove seus espelhos", async () => {
    expect(await cancel()).toContain("Cancelamento feito");
    expect(db.appointment.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: ctx.tenantId, leadId: ctx.leadId, id: appointment.id, status: "scheduled" }), data: { status: "canceled", notes: expect.stringContaining("Cancelado em 16/09/2026 às 09:00 (America/Sao_Paulo) pelo agente.") } }));
    expect(mirrors.googleDelete).toHaveBeenCalledWith(ctx.tenantId, "google-antigo");
    expect(mirrors.clinicorpCancel).toHaveBeenCalledWith(ctx.tenantId, "123");
  });
  it("remove também o evento do Calendário da Apple, no endereço gravado", async () => {
    db.appointment.findFirst.mockResolvedValue({ ...appointment, icloudEventUrl: "https://p1-caldav.icloud.com/c/fechai-consulta-1.ics" });
    expect(await cancel()).toContain("Cancelamento feito");
    expect(icloud.remove).toHaveBeenCalledWith(ctx.tenantId, "https://p1-caldav.icloud.com/c/fechai-consulta-1.ics", appointment.id);
  });
  it("sem endereço gravado ainda pede a remoção (o evento pode existir sem ter sido anotado)", async () => {
    await cancel();
    expect(icloud.remove).toHaveBeenCalledWith(ctx.tenantId, null, appointment.id);
  });
  it("repetir cancelamento não repete a alteração", async () => {
    db.appointment.findFirst.mockResolvedValue({ ...appointment, status: "canceled" });
    expect(await cancel()).toContain("já está cancelada");
    expect(db.appointment.updateMany).not.toHaveBeenCalled();
  });
});

describe("reagendamento", () => {
  it("guarda o dia original com a nova data e as observações na mesma transação", async () => {
    db.appointment.findFirst.mockImplementation(async ({ where }) => where.id === appointment.id ? { ...appointment, notes: "Observação anterior" } : null);
    expect(await reschedule()).toContain("reagendada");
    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(db.appointmentReschedule.create).toHaveBeenCalledWith({ data: {
      tenantId: ctx.tenantId, appointmentId: appointment.id,
      startsAt: appointment.startsAt, endsAt: appointment.endsAt,
      nextStartsAt: new Date("2026-09-18T17:00:00Z"), nextEndsAt: new Date("2026-09-18T17:30:00Z"),
      notes: "Observação anterior", clinicorpAppointmentId: "123", createdAt: new Date(),
    } });
    expect(db.appointment.create).not.toHaveBeenCalled();
    expect(db.appointment.updateMany.mock.calls[0][0].data).toMatchObject({ remindersSent: { set: [] }, reminderSentAt: null });
  });
  it("não chama os espelhos quando não consegue preservar o histórico", async () => {
    db.appointmentReschedule.create.mockRejectedValueOnce(new Error("Histórico indisponível"));
    expect(await reschedule()).toContain("Consulte a agenda antes de afirmar");
    expect(mirrors.clinicorpCancel).not.toHaveBeenCalled();
    expect(mirrors.googleDelete).not.toHaveBeenCalled();
  });
  it("não cria histórico quando outra operação já mudou a consulta", async () => {
    db.appointment.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await reschedule()).toContain("mudou");
    expect(db.appointmentReschedule.create).not.toHaveBeenCalled();
  });
  it("uma nova troca preserva também a data intermediária", async () => {
    await reschedule();
    const intermediate = { ...appointment, startsAt: new Date("2026-09-18T17:00:00Z"), endsAt: new Date("2026-09-18T17:30:00Z") };
    db.appointment.findFirst.mockImplementation(async ({ where }) => where.id === appointment.id ? intermediate : null);
    await reschedule({ date: "2026-09-21", time: "14:00" });
    expect(db.appointmentReschedule.create).toHaveBeenCalledTimes(2);
    expect(db.appointmentReschedule.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({
      startsAt: intermediate.startsAt, nextStartsAt: new Date("2026-09-21T17:00:00Z"),
    }) });
  });
  it("recusa externa por conflito não deixa uma remarcação falsa no histórico", async () => {
    mirrors.clinicorpPush.mockResolvedValueOnce({ status: "failed", reason: "conflict", error: "ocupado" });
    expect(await reschedule()).toContain("ocupado");
    expect(db.appointmentReschedule.deleteMany).toHaveBeenCalledWith({ where: { id: "historico-1", tenantId: ctx.tenantId, appointmentId: appointment.id } });
  });
  it("preserva ID e duração original, liberando os espelhos anteriores", async () => {
    expect(await reschedule()).toContain("reagendada");
    expect(db.appointment.create).not.toHaveBeenCalled();
    expect(db.appointment.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ id: appointment.id, tenantId: ctx.tenantId, leadId: ctx.leadId }),
      data: expect.objectContaining({ startsAt: new Date("2026-09-18T17:00:00Z"), endsAt: new Date("2026-09-18T17:30:00Z") }),
    }));
    expect(mirrors.clinicorpConflict).toHaveBeenCalledWith(ctx.tenantId, new Date("2026-09-18T17:00:00Z"), new Date("2026-09-18T17:30:00Z"), cfg.timezone, "123");
    expect(mirrors.clinicorpCancel).toHaveBeenCalledWith(ctx.tenantId, "123");
    expect(mirrors.clinicorpPush).toHaveBeenCalledOnce();
  });
  it("move o evento do iPhone para o novo horário, no mesmo endereço", async () => {
    const url = "https://p1-caldav.icloud.com/c/fechai-consulta-1.ics";
    db.appointment.findFirst.mockImplementation(async ({ where }) => where.id === appointment.id ? { ...appointment, icloudEventUrl: url, patientName: "Maria" } : null);
    icloud.update.mockResolvedValue({ status: "synced", url });
    expect(await reschedule()).toContain("reagendada");
    expect(icloud.update).toHaveBeenCalledWith(ctx.tenantId, url, expect.objectContaining({
      appointmentId: appointment.id, startsAt: new Date("2026-09-18T17:00:00Z"), endsAt: new Date("2026-09-18T17:30:00Z"), phone: "5511999999999",
    }), { agentId: null });
    expect(db.appointment.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.not.objectContaining({ icloudEventUrl: null }) }));
  });
  it("iCloud fora do ar na remarcação: esquece o endereço para a varredura reenviar", async () => {
    db.appointment.findFirst.mockImplementation(async ({ where }) => where.id === appointment.id ? { ...appointment, icloudEventUrl: "https://p1-caldav.icloud.com/c/x.ics" } : null);
    icloud.update.mockResolvedValue({ status: "failed", reason: "transient" });
    expect(await reschedule()).toContain("reagendada");
    expect(db.appointment.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ icloudEventUrl: null, icloudSyncAttempts: 0, icloudNextAttemptAt: expect.any(Date) }),
    }));
  });
  it("consulta que nunca foi ao iCloud não é enviada na remarcação: a varredura lê o horário novo", async () => {
    await reschedule();
    expect(icloud.update).not.toHaveBeenCalled();
  });
  it("recusa do Clinicorp por conflito não mexe no evento do iPhone", async () => {
    db.appointment.findFirst.mockImplementation(async ({ where }) => where.id === appointment.id ? { ...appointment, icloudEventUrl: "https://p1-caldav.icloud.com/c/x.ics" } : null);
    mirrors.clinicorpPush.mockResolvedValueOnce({ status: "failed", reason: "conflict", error: "ocupado" });
    await reschedule();
    expect(icloud.update).not.toHaveBeenCalled();
  });
  it("não altera horário sem confirmação", async () => {
    expect(await reschedule({ confirmed: false })).toContain("Nenhuma alteração");
    expect(db.appointment.updateMany).not.toHaveBeenCalled();
  });
  it.each(["11:45", "12:00", "18:00"])("preserva original quando %s atravessa pausa ou fechamento", async (time) => {
    expect(await reschedule({ time })).toContain("original continua reservado");
    expect(db.appointment.updateMany).not.toHaveBeenCalled();
  });
  it("preserva original em conflito local", async () => {
    db.appointment.findFirst.mockImplementation(async ({ where }) => where.id === appointment.id ? appointment : { id: "outra-consulta" });
    expect(await reschedule()).toContain("ocupado");
    expect(db.appointment.updateMany).not.toHaveBeenCalled();
    expect(mirrors.clinicorpCancel).not.toHaveBeenCalled();
  });
  it("preserva original em conflito no Clinicorp", async () => {
    mirrors.clinicorpConflict.mockResolvedValue(true);
    expect(await reschedule()).toContain("ocupado");
    expect(db.appointment.updateMany).not.toHaveBeenCalled();
  });
  it("não desfaz reagendamento local quando o novo espelho falha", async () => {
    mirrors.clinicorpPush.mockResolvedValue({ status: "failed", error: "indisponível" });
    expect(await reschedule()).toContain("Ainda não consegui confirmar");
    expect((ctx as ToolContext).replyOverride).toContain("precisa ser conferida");
    expect(db.appointment.updateMany).toHaveBeenCalled();
  });
  it("não duplica espelhos se a remoção anterior falhar e preserva seus IDs", async () => {
    mirrors.googleDelete.mockResolvedValue(false);
    mirrors.clinicorpCancel.mockResolvedValue(false);
    expect(await reschedule()).toContain("Ainda não consegui confirmar");
    expect(mirrors.googlePush).not.toHaveBeenCalled();
    expect(mirrors.clinicorpPush).not.toHaveBeenCalled();
    expect(db.appointment.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: { googleEventId: "google-antigo", clinicorpAppointmentId: "123" } }));
  });
  it("não altera consulta que mudou durante a operação", async () => {
    db.appointment.updateMany.mockResolvedValue({ count: 0 });
    expect(await reschedule()).toContain("mudou");
    expect(mirrors.clinicorpCancel).not.toHaveBeenCalled();
    expect(mirrors.googlePush).not.toHaveBeenCalled();
  });
});

describe("retorno de contato com consulta", () => {
  it("não confirma nem repete uma reserva sem confirmação do Clinicorp", async () => {
    mirrors.clinicorpPending.mockResolvedValue(true);
    db.appointment.findFirst.mockResolvedValue({ ...appointment, clinicorpAppointmentId: null });
    const turn: ToolContext = { ...ctx };
    const result = await runToolHandler("schedule_meeting", turn, { date: "2026-09-17", time: "10:00", patientName: "Cliente" });
    expect(result).toBe(turn.replyOverride);
    expect(result).toContain("concluindo automaticamente");
    expect(db.appointment.create).not.toHaveBeenCalled();
    expect(mirrors.clinicorpPush).not.toHaveBeenCalled();
  });

  it("identifica reserva pendente no contexto de um próximo turno", async () => {
    mirrors.clinicorpPending.mockResolvedValue(true);
    db.appointment.findMany.mockResolvedValue([{ ...appointment, clinicorpAppointmentId: null }]);
    expect(await leadAppointmentsContext(ctx, cfg)).toContain("Registro automático no Clinicorp em andamento");
  });

  it("encerra o turno com resposta fiel quando a criação no Clinicorp falha", async () => {
    db.appointment.findMany.mockResolvedValue([]);
    db.appointment.findFirst.mockResolvedValue(null);
    db.appointment.create.mockResolvedValue({ id: "nova-consulta" });
    db.appointment.update.mockResolvedValue({});
    db.lead.findUnique.mockResolvedValue({ name: "Paciente", phone: "5511999999999" });
    db.lead.update.mockResolvedValue({});
    mirrors.clinicorpPush.mockResolvedValue({ status: "failed", automatic: true, error: "Sem identificador" });
    const turn: ToolContext = { ...ctx };
    const result = await runToolHandler("schedule_meeting", turn, { date: "2026-09-17", time: "14:00", patientName: "Cliente" });
    expect(result).toBe(turn.replyOverride);
    expect(result).toContain("concluindo automaticamente");
    expect(result).not.toContain("confirmada");
    expect(db.appointment.create).toHaveBeenCalledOnce();
  });

  it("consulta o contato na conta, sem depender do histórico da conversa", async () => {
    expect(await leadAppointmentsContext(ctx, cfg)).toContain(appointment.id);
    expect(db.appointment.findMany).toHaveBeenCalledWith({ where: { tenantId: ctx.tenantId, leadId: ctx.leadId, status: "scheduled", startsAt: { gte: expect.any(Date) } }, orderBy: { startsAt: "asc" } });
  });
  it("não cria duplicata para confirmar ou contornar reagendamento", async () => {
    expect(await runToolHandler("schedule_meeting", ctx, { date: "2026-09-18", time: "14:00", patientName: "Cliente" })).toContain("já tem consulta");
    expect(db.appointment.create).not.toHaveBeenCalled();
  });
});

describe("nome da pessoa atendida", () => {
  it("registra avaliação selecionada para lembretes mesmo sem duração própria", async () => {
    const selected = { ...cfg, durations: [], durationMinutes: 15, reminderAudience: "selected_types", reminderTypes: ["Avaliação"] };
    db.tenantAction.findUnique.mockResolvedValue({ config: selected });
    db.appointment.findMany.mockResolvedValue([]);
    db.appointment.findFirst.mockResolvedValue(null);
    db.appointment.create.mockResolvedValue({ id: "nova-consulta" });
    db.appointment.update.mockResolvedValue({});
    db.lead.findUnique.mockResolvedValue({ name: "Paciente", phone: "5511999999999", isTest: false });
    db.lead.update.mockResolvedValue({});
    const result = await runToolHandler("schedule_meeting", ctx, {
      date: "2026-09-17", time: "14:00", patientName: "Maria Souza", tipoAtendimento: "avaliacao",
    });
    expect(result).toContain("Avaliação, 15 min");
    expect(db.appointment.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      serviceType: "Avaliação", endsAt: new Date("2026-09-17T17:15:00Z"),
    }) }));
  });
  it("expõe e exige patientName na ferramenta", () => {
    const schema = getToolSchemas(["schedule_meeting"], cfg).find((tool) => tool.name === "schedule_meeting")!;
    expect(schema.parameters.required).toContain("patientName");
    expect(schema.parameters.properties).toHaveProperty("patientName");
  });

  it("recusa marcar sem saber quem é o paciente", async () => {
    db.appointment.findMany.mockResolvedValue([]);
    expect(await runToolHandler("schedule_meeting", ctx, { date: "2026-09-17", time: "14:00" }))
      .toContain("nome da pessoa que será atendida");
    expect(db.appointment.create).not.toHaveBeenCalled();
  });

  it("grava a paciente no título e no campo próprio, sem usar o nome do contato", async () => {
    db.appointment.findMany.mockResolvedValue([]);
    db.appointment.findFirst.mockResolvedValue(null);
    db.appointment.create.mockResolvedValue({ id: "nova-consulta" });
    db.appointment.update.mockResolvedValue({});
    db.lead.findUnique.mockResolvedValue({ name: "Thalita", phone: "5511999999999", isTest: false });
    db.lead.update.mockResolvedValue({});

    const result = await runToolHandler("schedule_meeting", ctx, {
      date: "2026-09-17", time: "14:00", patientName: "Maria Souza", notes: "Primeira consulta",
    });

    expect(result).toContain("Agendado");
    expect(db.appointment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ title: "Maria Souza", patientName: "Maria Souza", notes: "Primeira consulta" }),
    }));
    expect(mirrors.clinicorpPush).toHaveBeenCalledWith(ctx.tenantId, expect.objectContaining({
      patientName: "Maria Souza", lead: expect.objectContaining({ name: "Thalita" }),
    }));
  });

  it("envia ao iCloud sem o telefone quando o contato é do chat de teste, com o endereço gravado", async () => {
    db.appointment.findMany.mockResolvedValue([]);
    db.appointment.findFirst.mockResolvedValue(null);
    db.appointment.create.mockResolvedValue({ id: "nova-consulta" });
    db.appointment.update.mockResolvedValue({});
    db.lead.findUnique.mockResolvedValue({ name: "Teste", phone: "5511999999999", isTest: true });
    db.lead.update.mockResolvedValue({});
    icloud.push.mockResolvedValue({ status: "synced", url: "https://p1-caldav.icloud.com/c/fechai-nova-consulta.ics" });

    await runToolHandler("schedule_meeting", ctx, { date: "2026-09-17", time: "14:00", patientName: "Maria Souza", procedimento: "Implante" });

    expect(icloud.push).toHaveBeenCalledWith(ctx.tenantId, expect.objectContaining({
      appointmentId: "nova-consulta", patientName: "Maria Souza", procedure: "Implante", phone: null, isTest: true,
    }), { agentId: ctx.agentId });
    expect(db.appointment.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ icloudEventUrl: "https://p1-caldav.icloud.com/c/fechai-nova-consulta.ics" }),
    }));
  });

  it("falha do iCloud não desfaz a consulta", async () => {
    db.appointment.findMany.mockResolvedValue([]);
    db.appointment.findFirst.mockResolvedValue(null);
    db.appointment.create.mockResolvedValue({ id: "nova-consulta" });
    db.appointment.update.mockResolvedValue({});
    db.lead.findUnique.mockResolvedValue({ name: "Thalita", phone: "5511999999999", isTest: false });
    db.lead.update.mockResolvedValue({});
    icloud.push.mockResolvedValue({ status: "failed", reason: "transient" });

    expect(await runToolHandler("schedule_meeting", ctx, { date: "2026-09-17", time: "14:00", patientName: "Maria Souza" })).toContain("Agendado");
    expect(db.appointment.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.not.objectContaining({ icloudEventUrl: expect.anything() }) }));
  });

  it("preserva o nome da paciente ao reagendar", async () => {
    db.appointment.findFirst.mockImplementation(async ({ where }) =>
      where.id === appointment.id ? { ...appointment, patientName: "Maria Souza" } : null,
    );
    db.lead.findFirst.mockResolvedValue({ name: "Thalita", phone: "5511999999999", isTest: false });

    expect(await reschedule()).toContain("reagendada");
    expect(mirrors.clinicorpPush).toHaveBeenCalledWith(ctx.tenantId, expect.objectContaining({
      patientName: "Maria Souza", lead: expect.objectContaining({ name: "Thalita" }),
    }));
  });
});

describe("follow-up depois do agendamento", () => {
  // A tool só registra COMO o contato deixou a conversa; quem manda é o
  // worker. Quem apenas sumiu é reengajado sem a tool ser chamada.
  it("não põe na esteira de recusa quem já tem consulta futura", async () => {
    db.appointment.findMany.mockResolvedValue([appointment]);

    const result = await runToolHandler("follow_up", ctx, { motivo: "nao_quer_agendar" });

    expect(result).toContain("já tem uma consulta futura");
    expect(db.conversation.updateMany).not.toHaveBeenCalled();
  });

  it("registra a recusa para a esteira espaçada, escopado pela conta", async () => {
    db.appointment.findMany.mockResolvedValue([]);

    expect(await runToolHandler("follow_up", ctx, { motivo: "nao_quer_agendar" })).toContain("espaçado");
    expect(db.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: ctx.conversationId, tenantId: ctx.tenantId },
      data: { followUpReason: "declined" },
    });
  });

  it("\"pare de me mandar mensagem\" vale mesmo com consulta marcada", async () => {
    db.appointment.findMany.mockResolvedValue([appointment]);

    expect(await runToolHandler("follow_up", ctx, { motivo: "pediu_para_parar" })).toContain("não receberá");
    expect(db.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: ctx.conversationId, tenantId: ctx.tenantId },
      data: { followUpReason: "stop" },
    });
  });

  it("recusa motivo desconhecido sem gravar nada", async () => {
    expect(await runToolHandler("follow_up", ctx, {})).toContain("Informe o motivo");
    expect(db.conversation.updateMany).not.toHaveBeenCalled();
  });
});

// Relato: o agente sugeria um horário já marcado, o contato aceitava e só
// então ouvia "esse já está ocupado, escolha outro".
describe("horários livres antes de sugerir", () => {
  const slots = (args: Record<string, unknown>) => runToolHandler("list_available_slots", ctx, args);

  it("usa a grade do dia, inclusive o último bloco até meia-noite", async () => {
    const week = emptyWeek();
    week[4] = [{ start: 1380, end: 1440 }];
    week[5] = [{ start: 840, end: 900 }];
    db.tenantAction.findFirst.mockResolvedValue({ config: { ...cfg, weeklyAvailability: week } });
    db.appointment.findMany.mockResolvedValue([]);
    expect(await slots({ date: "2026-09-17" })).toContain(": 23:00");
    expect(await slots({ date: "2026-09-18" })).toContain(": 14:00");
    expect(await slots({ date: "2026-09-19" })).toContain("não atendemos");
  });

  it("reagendamento não usa o expediente antigo quando a grade fecha o dia", async () => {
    db.tenantAction.findFirst.mockResolvedValue({ config: { ...cfg, weeklyAvailability: emptyWeek() } });
    expect(await reschedule()).toContain("original continua reservado");
    expect(db.appointment.updateMany).not.toHaveBeenCalled();
  });

  it("fica disponível sempre que o agendamento está ligado", () => {
    expect(getToolSchemas(["schedule_meeting"], { ...cfg, allowCancellation: false, allowRescheduling: false }).map((s) => s.name)).toContain("list_available_slots");
  });
  it("tira consultas nossas, bloqueios do Clinicorp e a pausa, e encaixa depois de cada ocupado", async () => {
    // Nossa consulta 10:00–10:30 e Clinicorp 14:00–15:30 (horário de SP).
    mirrors.clinicorpBusy.mockResolvedValue([{ startsAt: new Date("2026-09-17T17:00:00Z"), endsAt: new Date("2026-09-17T18:30:00Z") }]);
    const result = await slots({ date: "2026-09-17", days: 1 });
    const free = result.split("horários livres: ")[1];
    expect(free).toBe("09:00, 10:30, 11:00, 13:00, 15:30, 16:00, 17:00");
    expect(free).not.toMatch(/10:00|12:00|14:00|15:00,/);
    expect(mirrors.clinicorpBusy).toHaveBeenCalledWith(ctx.tenantId, "2026-09-17", cfg.timezone);
  });
  it("respeita a antecedência mínima e o limite exato aceito pela gravação", async () => {
    db.appointment.findMany.mockResolvedValue([]);
    // Agora são 09:00 em SP, antecedência de 2h: 11:00 ainda pode ser marcado.
    expect(await slots({ date: "2026-09-16" })).toContain(": 11:00, 13:00");
  });
  it("diferencia dia sem atendimento de dia lotado", async () => {
    expect(await slots({ date: "2026-09-19", days: 1 })).toContain("não atendemos");
    db.appointment.findMany.mockResolvedValue([{ startsAt: new Date("2026-09-17T12:00:00Z"), endsAt: new Date("2026-09-17T21:00:00Z") }]);
    expect(await slots({ date: "2026-09-17" })).toContain("sem horário livre");
  });
  it("consulta duas semanas por padrão e limita a busca a 14 dias", async () => {
    await slots({ date: "2026-09-17", days: 30 });
    expect(mirrors.clinicorpBusy).toHaveBeenCalledWith(ctx.tenantId, "2026-09-30", cfg.timezone);
    expect(mirrors.clinicorpBusy).not.toHaveBeenCalledWith(ctx.tenantId, "2026-10-01", cfg.timezone);
  });
  it("mostra expediente e horários reais de cada alternativa", async () => {
    db.appointment.findMany.mockResolvedValue([]);
    const result = await slots({ date: "2026-09-17", days: 1 });
    expect(result).toContain("funcionamento 09:00–12:00, 13:00–18:00");
    expect(result).toContain("horários livres: 09:00");
  });
  it("não devolve quinta ou sexta recusadas e avança para o próximo dia útil", async () => {
    db.appointment.findMany.mockResolvedValue([]);
    const result = await slots({
      date: "2026-09-17",
      excludeWeekdays: [4, 5],
    });
    expect(result).toContain("Dias da semana descartados pelo contato (não ofereça novamente): Quinta, Sexta");
    expect(result).toContain("(2026-09-21) — funcionamento");
    expect(result).not.toContain("qui., 17 de set. (2026-09-17) — funcionamento");
    expect(result).not.toContain("sex., 18 de set. (2026-09-18) — funcionamento");
  });
  it("recusa por conflito já traz os livres do dia e não grava", async () => {
    db.appointment.findMany.mockResolvedValueOnce([]).mockResolvedValue([appointment]);
    mirrors.clinicorpConflict.mockResolvedValue(true);
    const result = await runToolHandler("schedule_meeting", ctx, { date: "2026-09-17", time: "14:00", patientName: "Cliente" });
    expect(result).toContain("ocupado");
    expect(result).toContain("Encontrei estas opções disponíveis");
    expect(result).toContain("09:00");
    expect(result).toContain("10:30");
    expect(db.appointment.create).not.toHaveBeenCalled();
  });
});
