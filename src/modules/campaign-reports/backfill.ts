import { prisma } from "@/lib/prisma";
import { extractEvolutionAdOrigin, type AdOrigin } from "@/modules/whatsapp/ad-origin";
import { contactPhoneAliases } from "@/modules/whatsapp/contact-phone";
import { readEvolutionHistoryPage, readHistoryMessage } from "@/modules/whatsapp/evolution-history";
import { recordLeadAdOrigin } from "./record";

/**
 * Preenche a origem do anúncio dos leads **que já existem**, lendo o histórico
 * que a Evolution guardou. Só lê a Evolution; só grava `LeadAdOrigin`; nunca
 * cria lead, mensagem nem conversa, e rodar de novo não duplica (o primeiro
 * anúncio de cada lead vence).
 *
 * Lê em fatias de 7 dias, da mais antiga para a mais recente: uma fatia só
 * pode ter milhares de mensagens, e um limite de página silencioso entregaria
 * contagem pela metade. O telefone vem da mesma leitura do histórico que o
 * restante do sistema usa (resolve `@lid` pelo JID alternativo); mensagem sem
 * telefone resolvido é contada e descartada, nunca ligada por palpite.
 *
 * Os logs só levam contagens: nenhum telefone, nome ou texto.
 */

const WEEK_MS = 7 * 86_400_000;
/** Teto de segurança por fatia (20 mil mensagens): acima disso algo está errado. */
const MAX_PAGES = 200;

export type BackfillStats = {
  externalId: string;
  slices: number;
  scanned: number;
  withAd: number;
  unresolvedPhone: number;
  contacts: number;
  noLeadInFechai: number;
  matched: number;
  created: number;
  alreadyHad: number;
};

type Found = { origin: AdOrigin; at: Date };

export async function backfillAdOrigins(input: {
  tenantId: string;
  since: Date;
  until?: Date;
  apply: boolean;
  log?: (line: string) => void;
}): Promise<BackfillStats> {
  const { tenantId, since, apply } = input;
  const until = input.until ?? new Date();
  const log = input.log ?? (() => {});

  const instance = await prisma.whatsappInstance.findFirst({
    where: { tenantId, provider: "evolution" },
    select: { externalId: true },
  });
  if (!instance?.externalId) throw new Error("A conta não tem conexão por QR code (Evolution).");
  const externalId = instance.externalId;

  const stats: BackfillStats = {
    externalId, slices: 0, scanned: 0, withAd: 0, unresolvedPhone: 0,
    contacts: 0, noLeadInFechai: 0, matched: 0, created: 0, alreadyHad: 0,
  };
  /** Telefone → o anúncio MAIS ANTIGO visto (as fatias vão do passado ao presente). */
  const byPhone = new Map<string, Found>();

  for (let start = since.getTime(); start < until.getTime(); start += WEEK_MS) {
    const sliceFrom = new Date(start);
    const sliceTo = new Date(Math.min(start + WEEK_MS, until.getTime()));
    stats.slices++;
    let sliceAds = 0;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const result = await readEvolutionHistoryPage(externalId, sliceFrom, sliceTo, page);
      for (const raw of result.records) {
        stats.scanned++;
        const read = readHistoryMessage(raw, externalId, sliceFrom, sliceTo);
        const row = raw as { key?: { fromMe?: boolean } };
        if (row.key?.fromMe) continue;
        const origin = extractEvolutionAdOrigin(raw);
        if (!origin) continue;
        stats.withAd++;
        sliceAds++;
        if (!("message" in read)) {
          if (read.skipped === "unresolvedPhone") stats.unresolvedPhone++;
          continue;
        }
        const phone = read.message.phone;
        if (!byPhone.has(phone)) byPhone.set(phone, { origin, at: read.message.at });
      }
      if (page >= result.pages) break;
      if (page === MAX_PAGES) throw new Error("Fatia grande demais; a leitura foi interrompida.");
    }
    log(`semana desde ${sliceFrom.toISOString().slice(0, 10)}: ${sliceAds} mensagens com anúncio`);
  }

  stats.contacts = byPhone.size;
  const phones = [...byPhone.keys()];
  for (let i = 0; i < phones.length; i += 200) {
    const chunk = phones.slice(i, i + 200);
    const aliases = [...new Set(chunk.flatMap(contactPhoneAliases))];
    const leads = await prisma.lead.findMany({
      where: { tenantId, isTest: false, phone: { in: aliases } },
      select: { id: true, phone: true },
    });
    const byAlias = new Map(leads.map((lead) => [lead.phone, lead.id]));
    for (const phone of chunk) {
      const leadId = contactPhoneAliases(phone).map((a) => byAlias.get(a)).find(Boolean);
      if (!leadId) {
        stats.noLeadInFechai++;
        continue;
      }
      stats.matched++;
      if (!apply) continue;
      const found = byPhone.get(phone)!;
      const { status } = await recordLeadAdOrigin({ tenantId, leadId, origin: found.origin, at: found.at, via: "history" });
      if (status === "created") stats.created++;
      else if (status === "exists") stats.alreadyHad++;
    }
  }
  return stats;
}
