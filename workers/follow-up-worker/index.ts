import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { scanAndSendFollowUps } from "./scan";
import { scanAndSendReminders } from "./reminders";
import { scanAndSendClinicorpReminders } from "./clinicorp-reminders";
import { scanSatisfactionSurveys } from "./satisfaction";
import { scanWhatsappHealth } from "../../src/modules/whatsapp/health";
import { scanBroadcasts } from "../../src/modules/broadcasts/worker";
import { touchBroadcastWorker } from "../../src/modules/broadcasts/health";
import { scanKnowledgeGaps } from "../../src/modules/knowledge-gaps/notify";
import { scanBitrixSync } from "../../src/modules/bitrix/worker";
import { scanClinicorpSync } from "../../src/modules/scheduling/clinicorp-sync";
import { scanIcloudSync } from "../../src/modules/scheduling/icloud-sync";
import { scanIcloudHealth } from "../../src/modules/scheduling/icloud-health";

// Worker de mensagens no tempo. Follow-up/lembretes rodam na cadência comercial
// configurada; a saúde do WhatsApp tem um job próprio, mais rápido:
//
// - follow-up: conversas em que o lead ficou em silêncio (ver scan.ts);
// - lembrete: consultas que estão chegando (ver reminders.ts);
// - saúde do WhatsApp: número que caiu sem ninguém perceber (ver
//   modules/whatsapp/health.ts).
//
// Continuam no mesmo processo para não criar outro deploy, mas não na mesma
// cadência: depois de um auto-restart, esperar 15 minutos para restaurar o
// webhook ainda perderia mensagens demais. Saúde roda a cada minuto por padrão.
const connection: ConnectionOptions = {
  url: process.env.REDIS_URL ?? "redis://localhost:6379",
};

const FOLLOWUP_QUEUE = "follow-up";
const REMINDER_QUEUE = "appointment-reminders";
const HEALTH_QUEUE = "whatsapp-health";
const CLINICORP_REMINDER_QUEUE = "clinicorp-reminders";
const KNOWLEDGE_GAP_QUEUE = "knowledge-gaps";
const SATISFACTION_QUEUE = "satisfaction-surveys";
const FOLLOWUP_EVERY_MS =
  Number(process.env.FOLLOWUP_SCAN_EVERY_MINUTES ?? 15) * 60_000;
const REMINDER_EVERY_MS =
  Number(process.env.REMINDER_SCAN_EVERY_MINUTES ?? 1) * 60_000;
const HEALTH_EVERY_MS =
  Number(process.env.WHATSAPP_HEALTH_SCAN_EVERY_MINUTES ?? 1) * 60_000;
// Cada volta relê a agenda do Clinicorp de cada conta: a cada minuto, como os
// lembretes do fechai, seriam 1.440 chamadas por dia por clínica. Cinco minutos
// de atraso num lembrete de consulta não mudam nada para o paciente.
const CLINICORP_REMINDER_EVERY_MS =
  Number(process.env.CLINICORP_REMINDER_SCAN_EVERY_MINUTES ?? 5) * 60_000;
// Perguntas sem resposta (P-87): "na hora" com até 2 min de atraso junta num
// aviso só as perguntas que chegaram juntas; o resumo diário só confere a hora.
const KNOWLEDGE_GAP_EVERY_MS =
  Number(process.env.KNOWLEDGE_GAP_SCAN_EVERY_MINUTES ?? 2) * 60_000;

// Pesquisa de satisfação: o atraso configurado é de horas, então 5 minutos de
// granularidade bastam e mantêm leve a varredura das conversas recentes.
const SATISFACTION_EVERY_MS =
  Number(process.env.SATISFACTION_SCAN_EVERY_MINUTES ?? 5) * 60_000;

// Calendário da Apple (iCloud): envia ao iPhone as consultas que ainda não foram e
// confere a senha de app/calendário. A Apple não documenta o ritmo que tolera;
// um minuto basta para o horário chegar logo depois de um iCloud que voltou, e a
// checagem de saúde tem o próprio intervalo (30 min por conta).
const ICLOUD_QUEUE = "icloud-calendar";
const ICLOUD_EVERY_MS = Math.max(15, Number(process.env.ICLOUD_SCAN_EVERY_SECONDS ?? 60)) * 1000;

async function main() {
  const followUpQueue = new Queue(FOLLOWUP_QUEUE, { connection });
  const reminderQueue = new Queue(REMINDER_QUEUE, { connection });
  const healthQueue = new Queue(HEALTH_QUEUE, { connection });
  const clinicorpReminderQueue = new Queue(CLINICORP_REMINDER_QUEUE, { connection });
  const knowledgeGapQueue = new Queue(KNOWLEDGE_GAP_QUEUE, { connection });
  const satisfactionQueue = new Queue(SATISFACTION_QUEUE, { connection });
  // Uma varredura por vez: duas ao mesmo tempo poderiam perguntar a nota duas vezes.
  await satisfactionQueue.setGlobalConcurrency(1);
  const clinicorpSyncQueue = new Queue("clinicorp-appointment-sync", { connection });
  await clinicorpSyncQueue.setGlobalConcurrency(1);
  await clinicorpSyncQueue.upsertJobScheduler("clinicorp-sync-scheduler", { every: 30_000 }, { name: "clinicorp-sync" });
  const clinicorpSyncWorker = new Worker("clinicorp-appointment-sync", async () => scanClinicorpSync(), { connection, concurrency: 1 });
  clinicorpSyncWorker.on("failed", (job, err) => console.error(`[clinicorp envio] job ${job?.id} falhou`, err));
  const icloudQueue = new Queue(ICLOUD_QUEUE, { connection });
  // Uma varredura por vez: duas ao mesmo tempo enviariam a mesma consulta duas vezes.
  await icloudQueue.setGlobalConcurrency(1);
  await icloudQueue.upsertJobScheduler("icloud-scheduler", { every: ICLOUD_EVERY_MS }, { name: "icloud-calendar" });
  const icloudWorker = new Worker(
    ICLOUD_QUEUE,
    async () => {
      const sync = await scanIcloudSync();
      const health = await scanIcloudHealth();
      // Só contagens: nunca Apple ID, senha, endereço de calendário ou título de evento.
      if (sync.sent || sync.failed || sync.revoked || health.revoked || health.calendarMissing) {
        console.log(
          `[icloud] contas=${sync.tenants} enviados=${sync.sent} falhas=${sync.failed} senha_revogada=${sync.revoked + health.revoked} calendario_sumiu=${health.calendarMissing} checadas=${health.checked}`,
        );
      }
      return { sync, health };
    },
    { connection, concurrency: 1 },
  );
  icloudWorker.on("failed", (job, err) => console.error(`[icloud] job ${job?.id} falhou`, err));
  const bitrixQueue = new Queue("bitrix-crm-sync", { connection });
  await bitrixQueue.setGlobalConcurrency(1);
  await bitrixQueue.upsertJobScheduler("bitrix-sync-scheduler", { every: 30_000 }, { name: "bitrix-sync" });
  const bitrixWorker = new Worker("bitrix-crm-sync", async () => scanBitrixSync(), { connection, concurrency: 1 });
  bitrixWorker.on("failed", () => console.error("[bitrix] A fila será retomada na próxima varredura."));
  const broadcastQueue = new Queue("whatsapp-broadcasts", { connection });
  await broadcastQueue.setGlobalConcurrency(1);
  await broadcastQueue.upsertJobScheduler(
    "broadcast-scheduler",
    { every: 10_000 },
    { name: "broadcasts" },
  );
  const broadcastWorker = new Worker(
    "whatsapp-broadcasts",
    async () => {
      try {
        const result = await scanBroadcasts();
        await touchBroadcastWorker(true);
        return result;
      } catch (error) {
        await touchBroadcastWorker(
          true,
          "O serviço encontrou uma falha ao processar a fila.",
        ).catch(() => {});
        throw error;
      }
    },
    { connection, concurrency: 1 },
  );
  // O sinal não depende da duração da varredura. Redis indisponível não anuncia saúde.
  let checkingHeartbeat = false;
  const heartbeat = async () => {
    if (checkingHeartbeat) return;
    checkingHeartbeat = true;
    try {
      if (
        (await broadcastWorker.client).status !== "ready" ||
        !broadcastWorker.isRunning()
      )
        return;
      await broadcastQueue.getJobCounts("wait", "active");
      await touchBroadcastWorker();
    } catch {
      /* expira na tela */
    } finally {
      checkingHeartbeat = false;
    }
  };
  await heartbeat();
  setInterval(heartbeat, 15_000).unref();
  broadcastWorker.on("failed", (job, err) =>
    console.error(`[disparos] job ${job?.id} falhou`, err),
  );

  // Filas separadas: uma varredura de follow-up demorada não pode atrasar o
  // watchdog que precisa reparar o webhook em até um minuto.
  await followUpQueue.upsertJobScheduler(
    "scan-scheduler",
    { every: FOLLOWUP_EVERY_MS },
    { name: "scan" },
  );
  await reminderQueue.upsertJobScheduler(
    "scan-scheduler",
    { every: REMINDER_EVERY_MS },
    { name: "scan-reminders" },
  );
  await healthQueue.upsertJobScheduler(
    "whatsapp-health-scheduler",
    { every: HEALTH_EVERY_MS },
    { name: "whatsapp-health" },
  );
  await clinicorpReminderQueue.upsertJobScheduler(
    "scan-scheduler",
    { every: CLINICORP_REMINDER_EVERY_MS },
    { name: "scan-clinicorp-reminders" },
  );
  await knowledgeGapQueue.upsertJobScheduler(
    "scan-scheduler",
    { every: KNOWLEDGE_GAP_EVERY_MS },
    { name: "scan-knowledge-gaps" },
  );

  await satisfactionQueue.upsertJobScheduler(
    "scan-scheduler",
    { every: SATISFACTION_EVERY_MS },
    { name: "scan-satisfaction" },
  );

  const followUpWorker = new Worker(
    FOLLOWUP_QUEUE,
    async () => {
      const result = await scanAndSendFollowUps();
      console.log(`[follow-up] scanned=${result.scanned} sent=${result.sent}`);
      return result;
    },
    { connection },
  );
  const reminderWorker = new Worker(
    REMINDER_QUEUE,
    async () => {
      const result = await scanAndSendReminders();
      console.log(`[lembrete] scanned=${result.scanned} sent=${result.sent}`);
      return result;
    },
    { connection },
  );
  const clinicorpReminderWorker = new Worker(
    CLINICORP_REMINDER_QUEUE,
    async () => {
      const r = await scanAndSendClinicorpReminders();
      console.log(
        `[lembrete clinicorp] contas=${r.tenants} consultas=${r.scanned} sent=${r.sent} primeiro_contato_pulado=${r.firstContactSkipped} tipo_excluido=${r.typeSkipped} tipo_desconhecido=${r.unknownTypeSkipped}`,
      );
      return r;
    },
    { connection },
  );
  const knowledgeGapWorker = new Worker(
    KNOWLEDGE_GAP_QUEUE,
    async () => {
      const r = await scanKnowledgeGaps();
      if (r.notices || r.digests || r.admin) {
        console.log(`[perguntas] avisos=${r.notices} resumos=${r.digests} mavellium=${r.admin}`);
      }
      return r;
    },
    { connection },
  );
  const satisfactionWorker = new Worker(
    SATISFACTION_QUEUE,
    async () => {
      const r = await scanSatisfactionSurveys();
      if (r.sent || r.expired || r.classified) {
        console.log(`[pesquisa] contas=${r.tenants} conversas=${r.scanned} enviadas=${r.sent} expiradas=${r.expired} classificados=${r.classified}`);
      }
      return r;
    },
    { connection, concurrency: 1 },
  );
  const healthWorker = new Worker(
    HEALTH_QUEUE,
    async () => {
      const health = await scanWhatsappHealth();
      console.log(
        `[whatsapp health] scanned=${health.scanned} broken=${health.broken} alerted=${health.alerted}`,
      );
      return { health };
    },
    { connection },
  );

  followUpWorker.on("failed", (job, err) =>
    console.error(`[follow-up] job ${job?.id} falhou`, err),
  );
  reminderWorker.on("failed", (job, err) =>
    console.error(`[lembrete] job ${job?.id} falhou`, err),
  );
  healthWorker.on("failed", (job, err) =>
    console.error(`[whatsapp health] job ${job?.id} falhou`, err),
  );
  clinicorpReminderWorker.on("failed", (job, err) =>
    console.error(`[lembrete clinicorp] job ${job?.id} falhou`, err),
  );
  knowledgeGapWorker.on("failed", (job, err) =>
    console.error(`[perguntas] job ${job?.id} falhou`, err),
  );
  satisfactionWorker.on("failed", (job, err) =>
    console.error(`[pesquisa] job ${job?.id} falhou`, err),
  );
  console.log(
    `[worker] online — follow-up a cada ${FOLLOWUP_EVERY_MS / 60000} min; ` +
      `lembretes a cada ${REMINDER_EVERY_MS / 60000} min; ` +
      `lembretes do Clinicorp a cada ${CLINICORP_REMINDER_EVERY_MS / 60000} min; ` +
      `avisos de perguntas sem resposta a cada ${KNOWLEDGE_GAP_EVERY_MS / 60000} min; ` +
      `pesquisa de satisfação a cada ${SATISFACTION_EVERY_MS / 60000} min; ` +
      `Calendário da Apple a cada ${ICLOUD_EVERY_MS / 1000} s; ` +
      `saúde do WhatsApp a cada ${HEALTH_EVERY_MS / 60000} min`,
  );
}

main().catch((err) => {
  console.error("[follow-up] fatal", err);
  process.exit(1);
});
