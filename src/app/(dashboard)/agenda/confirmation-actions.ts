"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireTenant } from "@/lib/session";
import { requireProductAccess } from "@/lib/require-product";
import { prisma } from "@/lib/prisma";
import { listClinicorpAgenda } from "@/modules/scheduling/clinicorp";
import { dayKeyInZone } from "@/modules/scheduling/time";
import type { ActionResult } from "@/components/ui/toast/types";
import { loadAccountScheduleConfigs, scanAndSendReminders } from "../../../../workers/follow-up-worker/reminders";
import { sendClinicorpConfirmation } from "../../../../workers/follow-up-worker/clinicorp-reminders";

const schema = z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/), source: z.enum(["clinicorp", "appointment"]),
  startsAt: z.iso.datetime(), operation: z.enum(["send", "manual"]) });
export async function appointmentConfirmationAction(_previous: ActionResult | null, data: FormData): Promise<ActionResult> {
  await requireProductAccess();
  const { tenantId, session } = await requireTenant();
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { status: true } });
  if (tenant?.status !== "active") return { ok: false, error: "Esta conta precisa estar ativa.", code: "forbidden" };
  const parsed = schema.safeParse(Object.fromEntries(data));
  if (!parsed.success) return { ok: false, error: "Escolha uma consulta válida.", code: "validation" };
  const cfg = (await loadAccountScheduleConfigs()).get(tenantId);
  if (!cfg?.reminderEnabled || !cfg.reminders.length) return { ok: false, error: "Configure os lembretes do agente principal antes de confirmar.", code: "validation" };
  const input = parsed.data, startsAt = new Date(input.startsAt);
  if (startsAt <= new Date()) return { ok: false, error: "A consulta já passou. Nenhuma confirmação foi enviada.", code: "validation" };
  try {
    let localId = input.source === "appointment" ? input.id : null;
    if (input.source === "clinicorp") {
      const day = dayKeyInZone(startsAt, cfg.timezone);
      const agenda = await listClinicorpAgenda(tenantId, day, day, cfg.timezone, { fresh: true });
      const item = agenda.status === "ok" ? agenda.items.find((a) => a.id === input.id && a.startsAt.getTime() === startsAt.getTime() && !a.canceled) : null;
      if (!item) return { ok: false, error: "Não foi possível conferir esta consulta no Clinicorp. Atualize a agenda.", code: "validation" };
      const mirrored = await prisma.appointment.findFirst({ where: { tenantId, clinicorpAppointmentId: input.id }, select: { id: true } });
      if (mirrored) localId = mirrored.id;
      else {
        const result = await sendClinicorpConfirmation(tenantId, item, cfg, { operation: input.operation, userId: session.user.id });
        revalidatePath("/agenda");
        if (result.sent) return { ok: true, info: "Envio aceito pelo WhatsApp. Acompanhe a entrega na agenda." };
        if (result.reason === "manual") return { ok: true, info: "Confirmação registrada. O automático deste momento foi dispensado." };
        const messages: Record<string, string> = { handled: "Este lembrete já foi tratado ou exige conferência do envio anterior.",
          busy: "Este lembrete está sendo enviado. Atualize o status antes de agir.", type: "Esta categoria não foi autorizada para confirmação.",
          outside_window: "Esta confirmação só pode ser enviada no dia previsto. A confirmação da véspera não é enviada no dia da consulta.",
          phone: "Confira o telefone e a lista de bloqueados.", stop: "Este contato não pode receber a confirmação.", channel: "Conecte o canal do paciente ou habilite as confirmações do Clinicorp pelo QR.",
          unknown: "O envio ficou sem confirmação. Confira o WhatsApp antes de enviar novamente." };
        return { ok: false, error: messages[result.reason] ?? "Não foi possível enviar esta confirmação. Confira o status na agenda.", code: "validation" };
      }
    }
    const appt = await prisma.appointment.findFirst({ where: { id: localId!, tenantId, startsAt, status: "scheduled", lead: { isTest: false } }, select: { id: true, clinicorpAppointmentId: true, remindersSent: true, reminderSentAt: true } });
    if (!appt) return { ok: false, error: "A consulta foi alterada ou não pode receber confirmação.", code: "validation" };
    const result = await scanAndSendReminders(new Date(), { tenantId, id: appt.id, operation: input.operation, userId: session.user.id });
    revalidatePath("/agenda");
    if (result.reason === "outside_window") return { ok: false, error: "Esta confirmação só pode ser enviada no dia previsto. A confirmação da véspera não é enviada no dia da consulta.", code: "validation" };
    const sourceKey = appt.clinicorpAppointmentId ? `clinicorp:${appt.clinicorpAppointmentId}` : `appointment:${appt.id}`;
    const status = await prisma.reminderDispatch.findFirst({ where: { tenantId, sourceKey, startsAt }, orderBy: { updatedAt: "desc" }, select: { state: true, reason: true } });
    if (status?.state === "sent") return { ok: true, info: "Envio aceito pelo WhatsApp. Acompanhe a entrega na agenda." };
    if (status?.state === "manual") return { ok: true, info: "Confirmação registrada. O automático deste momento foi dispensado." };
    return { ok: false, error: status?.reason ?? (appt.remindersSent.length ? "Este momento de confirmação já foi tratado." : "Não foi possível enviar. Confira as configurações e o canal do paciente."), code: "validation" };
  } catch { return { ok: false, error: "Não foi possível concluir a confirmação. Confira o status antes de tentar novamente.", code: "server" }; }
}
