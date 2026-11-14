import { prisma } from "@/lib/prisma";

/**
 * Quem pode assinar um script da campanha (`--actor`): o superadmin ou um
 * usuário da própria conta (`--tenant`). Qualquer outro usuário do sistema é
 * recusado — o ator vai para a trilha de auditoria. Mensagens sem dado pessoal.
 */
export type ScriptActor = { id: string; email: string | null; role: string };

export async function resolveScriptActor(
  actorId: string,
  tenantId: string,
): Promise<{ ok: true; actor: ScriptActor } | { ok: false; message: string }> {
  const user = await prisma.user.findUnique({ where: { id: actorId }, select: { id: true, email: true, role: true, tenantId: true } });
  if (!user) return { ok: false, message: "--actor: usuário não encontrado." };
  if (user.role !== "SUPERADMIN" && user.tenantId !== tenantId) {
    return { ok: false, message: "--actor: o usuário precisa ser superadmin ou pertencer à conta informada em --tenant." };
  }
  return { ok: true, actor: { id: user.id, email: user.email, role: user.role } };
}
