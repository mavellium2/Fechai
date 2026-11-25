import { prisma } from "@/lib/prisma";
import { dayKeyInZone, parseLocalDateTime, timeInZone } from "@/modules/scheduling/time";
import { lockCrmAdmission } from "./admission";
import { realBoardLeads } from "./lead-scope";
import { CRM_TIME_ZONE } from "./board-filters";
import { recordCrmTrail } from "./trail";

export function parseCrmTaskDue(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const [date, time] = value.split("T");
  const dueAt = parseLocalDateTime(date, time, CRM_TIME_ZONE);
  if (!dueAt || dayKeyInZone(dueAt, CRM_TIME_ZONE) !== date || timeInZone(dueAt, CRM_TIME_ZONE) !== time) return null;
  return dueAt;
}

type Edit =
  | { kind: "addTag"; tagId: string }
  | { kind: "newTag"; name: string }
  | { kind: "removeTag"; tagId: string }
  | { kind: "createTask"; text: string; dueAt: Date; assignedUserId: string | null }
  | { kind: "completeTask"; taskId: string };

type Trail = { event: "crm.tag_changed" | "crm.task_changed"; meta: Record<string, string> };

/**
 * A action resolve a sessão e valida o formato. As referências ficam sempre no
 * escopo da conta. O que mudou de fato vira um evento na trilha (CRM-11), com o
 * nome da etiqueta ou o id da tarefa (nunca o texto da tarefa).
 */
export async function editCrmLead(tenantId: string, leadId: string, edit: Edit, actorUserId?: string) {
  let trail: Trail | null = null;
  const result = await applyCrmLeadEdit(tenantId, leadId, edit, (change) => { trail = change; });
  const changed = trail as Trail | null;
  if (result === "ok" && changed && actorUserId) {
    await recordCrmTrail({ tenantId, leadId, event: changed.event, actor: { kind: "user", userId: actorUserId }, meta: changed.meta });
  }
  return result;
}

function applyCrmLeadEdit(tenantId: string, leadId: string, edit: Edit, onChange: (change: Trail) => void) {
  return prisma.$transaction(async (db) => {
    await lockCrmAdmission(db, tenantId, "shared");
    const lead = await db.lead.findFirst({ where: { ...realBoardLeads(tenantId), id: leadId }, select: { id: true } });
    if (!lead) return "unavailable";
    const scope = { tenantId, leadId };

    switch (edit.kind) {
      case "newTag": {
        const key = edit.name.normalize("NFKC").toLocaleLowerCase("pt-BR");
        await db.tag.createMany({ data: { tenantId, key, name: edit.name }, skipDuplicates: true });
        const tag = await db.tag.findUniqueOrThrow({
          where: { tenantId_key: { tenantId, key } },
          select: { id: true, name: true },
        });
        const added = await db.leadTag.createMany({ data: { ...scope, tagId: tag.id }, skipDuplicates: true });
        if (added.count) onChange({ event: "crm.tag_changed", meta: { action: "add", tagId: tag.id, tag: tag.name } });
        return "ok";
      }
      case "addTag": {
        const tag = await db.tag.findUnique({ where: { tenantId_id: { tenantId, id: edit.tagId } }, select: { id: true, name: true } });
        if (!tag) return "unavailable";
        const added = await db.leadTag.createMany({ data: { ...scope, tagId: tag.id }, skipDuplicates: true });
        if (added.count) onChange({ event: "crm.tag_changed", meta: { action: "add", tagId: tag.id, tag: tag.name } });
        return "ok";
      }
      case "removeTag": {
        const removed = await db.leadTag.deleteMany({ where: { ...scope, tagId: edit.tagId } });
        if (removed.count) {
          const tag = await db.tag.findUnique({ where: { tenantId_id: { tenantId, id: edit.tagId } }, select: { name: true } });
          onChange({ event: "crm.tag_changed", meta: { action: "remove", tagId: edit.tagId, tag: tag?.name ?? "" } });
        }
        return "ok";
      }
      case "createTask": {
        if (edit.assignedUserId && !await db.user.findFirst({
          where: { id: edit.assignedUserId, tenantId, role: "OWNER", usesProduct: true }, select: { id: true },
        })) return "unavailable";
        const task = await db.leadTask.create({
          data: { ...scope, text: edit.text, dueAt: edit.dueAt, assignedUserId: edit.assignedUserId }, select: { id: true },
        });
        onChange({ event: "crm.task_changed", meta: { action: "create", taskId: task.id, dueAt: edit.dueAt.toISOString() } });
        return "ok";
      }
      case "completeTask": {
        const task = await db.leadTask.findFirst({ where: { ...scope, id: edit.taskId }, select: { completedAt: true } });
        if (!task) return "unavailable";
        if (!task.completedAt) {
          const done = await db.leadTask.updateMany({ where: { ...scope, id: edit.taskId, completedAt: null }, data: { completedAt: new Date() } });
          if (done.count) onChange({ event: "crm.task_changed", meta: { action: "complete", taskId: edit.taskId } });
        }
        return "ok";
      }
    }
  });
}
