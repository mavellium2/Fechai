import { prisma } from "@/lib/prisma";
import { attendanceOf } from "@/modules/scheduling/dimensions";

type Recipient = {
  status: string;
  deliveryStatus: string | null;
  repliedAt: Date | null;
  qualifiedAt: Date | null;
  appointmentId: string | null;
};

export const broadcastFunnelSelect = {
  status: true,
  deliveryStatus: true,
  repliedAt: true,
  qualifiedAt: true,
  appointmentId: true,
} as const;

export function broadcastFunnel(recipients: Recipient[], attendedIds: ReadonlySet<string> = new Set()) {
  const count = (test: (r: Recipient) => boolean) => recipients.filter(test).length;
  return {
    total: recipients.length,
    pending: count((r) => r.status === "pending" || r.status === "sending"),
    sent: count((r) => r.status === "sent"),
    failed: count((r) => r.status === "failed"),
    unknown: count((r) => r.status === "unknown"),
    skipped: count((r) => r.status === "skipped" || r.status === "cancelled"),
    delivered: count((r) => r.deliveryStatus === "delivered" || r.deliveryStatus === "read"),
    read: count((r) => r.deliveryStatus === "read"),
    deliveryFailed: count((r) => r.deliveryStatus === "failed"),
    replies: count((r) => r.repliedAt !== null),
    opportunities: count((r) => r.qualifiedAt !== null),
    appointments: count((r) => Boolean(r.appointmentId)),
    attended: count((r) => r.appointmentId !== null && attendedIds.has(r.appointmentId)),
  };
}

export async function loadBroadcastAttendance(tenantId: string, recipients: Recipient[]) {
  const ids = [...new Set(recipients.flatMap((row) => row.appointmentId ? [row.appointmentId] : []))];
  const attended = new Set<string>();
  for (let offset = 0; offset < ids.length; offset += 1000) {
    const appointments = await prisma.appointment.findMany({
      where: { tenantId, id: { in: ids.slice(offset, offset + 1000) }, status: { not: "canceled" } },
      select: { id: true, attendance: true, status: true },
    });
    for (const appointment of appointments) {
      if (attendanceOf(appointment) === "attended") attended.add(appointment.id);
    }
  }
  return attended;
}
