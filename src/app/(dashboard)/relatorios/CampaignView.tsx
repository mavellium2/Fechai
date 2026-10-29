import { Megaphone } from "lucide-react";
import { Card, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Stat } from "@/components/ui/stat";
import { HorizontalBars } from "@/components/charts/HorizontalBars";
import {
  HISTORY_IMPORT_DAYS,
  canRequestHistoryImport,
  describeCampaignSchedule,
  formatReportPhone,
  weekWindow,
  type CampaignSendStatus,
  type CampaignSettings,
} from "@/modules/campaign-reports/settings";
import { rangeLabel } from "@/modules/campaign-reports/message";
import { percent } from "@/modules/campaign-reports/summary";
import type { CampaignReport } from "@/modules/campaign-reports/queries";
import { formatInZone } from "@/modules/scheduling/time";
import { CampaignHistoryImport, CampaignSendNowForm, CampaignSettingsForm } from "./CampaignSettingsForm";

const pct = (n: number, d: number) => {
  const value = percent(n, d);
  return value === null ? "—" : `${value}%`;
};

const STATUS_LABEL: Record<CampaignSendStatus, string> = {
  sent: "enviado",
  no_group: "não enviado: sem grupo escolhido",
  no_phone: "não enviado: sem número informado",
  no_channel: "não enviado: WhatsApp por QR code desconectado",
  no_data: "não enviado: ainda sem anúncio registrado",
  refused: "não enviado: esse número é de um contato que a clínica não pode procurar por aqui",
  failed: "envio sem confirmação — confira o WhatsApp",
};

const dateLabel = (date: Date) =>
  new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" }).format(date);

/**
 * Campanhas: de qual anúncio vieram os leads do período e o que aconteceu com
 * eles, mais o envio semanal desse relatório a um grupo ou a um número. Só
 * agregados: nenhum nome, telefone ou texto de conversa.
 */
export function CampaignView({ report, settings, questionsGroup, period }: {
  report: CampaignReport;
  settings: CampaignSettings;
  /** Grupo dos avisos de Perguntas: é o que o envio usa quando nenhum grupo foi escolhido aqui. */
  questionsGroup: { id: string | null; name: string | null };
  period: string;
}) {
  const { current: c, trackedSince } = report;
  const hasGroup = Boolean(settings.groupId ?? questionsGroup.id);
  const missingDestination = settings.destination === "phone"
    ? (settings.phone ? null : "Informe o número e salve para poder enviar.")
    : (hasGroup ? null : "Escolha o grupo e salve para poder enviar.");
  const sendBlocked = missingDestination ?? (trackedSince ? null : "Ainda não há anúncio registrado nesta conta.");
  const destinationLabel = settings.destination === "phone" && settings.phone
    ? `para ${formatReportPhone(settings.phone)}`
    : "no grupo";
  const week = weekWindow(new Date(), settings.timezone);
  const previewRange = rangeLabel(week.from, week.to, settings.timezone);
  const historyImport = (
    <CampaignHistoryImport
      history={settings.history}
      canRequest={canRequestHistoryImport(settings.history, new Date())}
      days={HISTORY_IMPORT_DAYS}
    />
  );

  return (
    <div className="space-y-6">
      {!trackedSince ? (
        <Card>
          <EmptyState
            icon={Megaphone}
            title="Ainda não há anúncio registrado"
            description="Contatos novos vindos de anúncio do Instagram ou do Facebook entram aqui sozinhos. Quem já tinha chegado antes só aparece depois de importar o histórico do WhatsApp."
            action={historyImport}
          />
        </Card>
      ) : c.leads === 0 ? (
        <Card>
          <EmptyState icon={Megaphone} title="Nenhum lead novo neste período" description="Troque o período para ver outras semanas." />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Leads novos" value={String(c.leads)} hint={period} />
            <Stat label="Vieram de anúncio" value={String(c.adLeads)} hint={`${pct(c.adLeads, c.leads)} dos leads`}
              about="Contatos cuja primeira mensagem trazia o anúncio do Instagram ou do Facebook." />
            <Stat label="Sem anúncio identificado" value={String(c.otherLeads)}
              about="A mensagem não trazia anúncio. Pode ser orgânico, indicação ou contato de antes de o Fechai registrar a origem." />
            <Stat label="Agendaram (de anúncio)" value={String(c.adScheduled)} hint={`${pct(c.adScheduled, c.adLeads)} dos de anúncio`}
              about="Leads de anúncio com algum agendamento não cancelado, até agora." />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardTitle hint="Quantos leads cada anúncio trouxe no período.">Leads por anúncio</CardTitle>
              <HorizontalBars
                empty="Nenhum lead de anúncio neste período."
                points={c.lines.slice(0, 12).map((l) => ({ key: l.key, label: l.label, value: l.leads, secondaryLabel: `${l.scheduled} agendaram` }))}
              />
            </Card>
            <Card>
              <CardTitle hint="O que aconteceu com os leads de anúncio. Volume sozinho não diz qual anúncio funciona: olhe também os agendamentos.">Resultado por anúncio</CardTitle>
              <DataTable
                caption="Resultado dos leads por anúncio"
                head={["Anúncio", "Leads", "Agendaram", "Taxa", "Equipe", "Perderam", "Em andamento"]}
                rows={c.lines.map((l) => ({
                  id: l.key,
                  cells: [l.label, String(l.leads), String(l.scheduled), pct(l.scheduled, l.leads), String(l.handoff), String(l.lost), String(l.open)],
                }))}
              />
            </Card>
          </div>

          <p className="text-xs leading-relaxed text-neutral panel:text-white/55">
            Conta os leads criados no período, com o anúncio da primeira mensagem (o primeiro anúncio de cada contato vale; clicar em outro depois não muda). Resultado é calculado agora: agendou = algum agendamento não cancelado; perdeu = motivo registrado, triagem, follow-up recusado ou 72 horas sem resposta.
            {trackedSince ? ` Há registro de anúncio desde ${dateLabel(trackedSince)}; antes disso, "sem anúncio identificado" é falta de registro.` : ""}
          </p>
        </>
      )}

      {trackedSince && (
        <Card>
          <CardTitle hint="Liga os leads que já existem ao anúncio de onde vieram, lendo o que o WhatsApp guardou. Pode repetir sem duplicar: vale o primeiro anúncio de cada lead.">Histórico de anúncios</CardTitle>
          {historyImport}
        </Card>
      )}

      {trackedSince && (
        <Card>
          <CardTitle hint="O arquivo que vai no WhatsApp: a última semana fechada, gerado agora com os mesmos dados do envio. O período do topo da página não muda esta prévia.">Prévia do relatório semanal</CardTitle>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-neutral panel:text-white/60">
              <p>Semana de {previewRange}. É este PDF que chega no WhatsApp, com uma legenda curta.</p>
              <p className="flex gap-4">
                <a href="/relatorios/campanhas/pdf" target="_blank" rel="noopener" className="font-medium text-iris hover:underline">Abrir em outra aba</a>
                <a href="/relatorios/campanhas/pdf?baixar=1" className="font-medium text-iris hover:underline">Baixar PDF</a>
              </p>
            </div>
            <iframe
              src="/relatorios/campanhas/pdf#toolbar=0&view=FitH"
              title={`Prévia do relatório de campanhas, semana de ${previewRange}`}
              loading="lazy"
              className="h-[640px] w-full rounded-control border border-ink/10 bg-white panel:border-white/10"
            />
          </div>
        </Card>
      )}

      <Card>
        <CardTitle hint="O relatório da semana vai a um grupo do WhatsApp ou ao seu número, no dia e na hora que você escolher.">Envio semanal</CardTitle>
        <div className="space-y-5">
          <CampaignSettingsForm settings={settings} questionsGroup={questionsGroup} />
          <div className="space-y-2 border-t border-ink/10 pt-5 panel:border-white/10">
            <CampaignSendNowForm disabledReason={sendBlocked} destination={settings.destination} />
            <p className="text-xs text-neutral panel:text-white/55">
              {settings.enabled ? `Programado ${destinationLabel}: ${describeCampaignSchedule(settings)}.` : "Envio automático desligado."}
              {settings.lastStatus ? ` Última tentativa: ${STATUS_LABEL[settings.lastStatus]}.` : ""}
              {settings.lastSentAt ? ` Último envio: ${formatInZone(settings.lastSentAt, settings.timezone)}.` : ""}
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
