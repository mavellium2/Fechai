import { prisma } from "@/lib/prisma";

/**
 * O eco (`fromMe`) de um lembrete que a própria conta enviou. O worker grava a
 * `Message` só depois do envio — e, no lembrete do Clinicorp para contato novo,
 * depois de criar o cadastro —, então o eco pode chegar antes e, sem isto, era
 * gravado como "a equipe escreveu pelo celular": pausava o agente para a
 * resposta do paciente e o relatório contava uma abordagem da equipe.
 *
 * A prova é o id do WhatsApp que o envio guardou em `ReminderDispatch.messageId`
 * (gravado logo após o envio, antes do histórico), nunca o texto. **Nunca
 * lança**: na falha devolve `false` e o eco segue o caminho de antes.
 */
export async function isOwnReminderEcho(tenantId: string, messageKeyId: string | undefined): Promise<boolean> {
  if (!messageKeyId) return false;
  try {
    const dispatch = await prisma.reminderDispatch.findFirst({ where: { tenantId, messageId: messageKeyId }, select: { id: true } });
    return Boolean(dispatch);
  } catch {
    console.error("[whatsapp] eco de lembrete não conferido");
    return false;
  }
}
