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
import { NO_AD_KEY, NO_AD_LABEL, campaignBars, percent } from "@/modules/campaign-reports/summary";
import type { CampaignReport } from "@/modules/campaign-reports/queries";
import { formatInZone } from "@/modules/scheduling/time";
import { formatMinutes } from "@/modules/reports/monthly-time";
import { CampaignHistoryImport, CampaignSendNowForm, CampaignSettingsForm } from "./CampaignSettingsForm";
import { CampaignWeeklyPanel } from "./CampaignWeeklyPanel";

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
  const { current: c, trackedSince, adResults } = report;
  const chart = campaignBars(c);
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
  const resultCells = (result: NonNullable<typeof adResults>["total"] | undefined) => [
    String(result?.attended ?? 0),
    formatMinutes(result?.medianMinutes),
  ];
  const columns = ["Anúncio", "Leads", "Agendaram", "Taxa", "Compareceram", "Até agendar (mediana)"];
  const rows = [
    ...c.lines.map((line) => ({ id: line.key, cells: [line.label, String(line.leads), String(line.scheduled), pct(line.scheduled, line.leads), ...resultCells(adResults?.groups.get(line.key))] })),
    { id: NO_AD_KEY, cells: [NO_AD_LABEL, String(c.otherLeads), String(c.otherScheduled), pct(c.otherScheduled, c.otherLeads), ...resultCells(adResults?.groups.get(NO_AD_KEY))] },
    { id: "total", cells: ["Total", String(c.leads), String(c.adScheduled + c.otherScheduled), pct(c.adScheduled + c.otherScheduled, c.leads), ...resultCells(adResults?.total)] },
  ];

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
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Stat compact label="Leads novos" value={String(c.leads)} hint={period} />
            <Stat compact label="Vieram de anúncio" value={String(c.adLeads)} hint={`${pct(c.adLeads, c.leads)} dos leads`}
              about="Contatos cuja primeira mensagem trazia o anúncio do Instagram ou do Facebook." />
            <Stat compact label="Sem anúncio identificado" value={String(c.otherLeads)}
              about="A mensagem não trazia anúncio. Pode ser orgânico, indicação ou contato de antes de o Fechai registrar a origem." />
            <Stat compact label="Agendaram (de anúncio)" value={String(c.adScheduled)} hint={`${pct(c.adScheduled, c.adLeads)} dos de anúncio`}
              about="Leads de anúncio com algum agendamento não cancelado, até agora." />
          </div>

          <Card>
            <CardTitle hint="Quantos leads cada anúncio trouxe no período. A soma das barras é o total de leads do período.">Leads por anúncio</CardTitle>
            <HorizontalBars
              empty="Nenhum lead neste período."
              points={chart.bars.map((b) => ({
                key: b.key,
                label: b.label,
                value: b.leads,
                secondaryLabel: `${b.scheduled} agendaram`,
                ...(b.kind === "none" ? { colorClass: "bg-neutral/50" } : {}),
              }))}
            />
          </Card>
          <Card>
            <CardTitle hint="A mediana vai da entrada do lead à criação do primeiro agendamento não cancelado. Comparecimento só conta com presença registrada.">Resultado por anúncio</CardTitle>
            <div className="hidden lg:block"><DataTable caption="Resultados por anúncio" head={columns} rows={rows} /></div>
            <ul className="divide-y divide-ink/10 panel:divide-white/10 lg:hidden">
              {rows.map(({ id, cells }) => <li key={id} className="space-y-3 py-4">
                <p className="break-words font-semibold">{cells[0]}</p>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  {columns.slice(1).map((label, index) => <div key={label}>
                    <dt className="text-neutral panel:text-white/65">{label}</dt><dd className="tabular-nums">{cells[index + 1]}</dd>
                  </div>)}
                </dl>
              </li>)}
            </ul>
          </Card>

          <p className="text-xs leading-relaxed text-neutral panel:text-white/55">
            Conta os leads criados no período, com o anúncio da primeira mensagem (o primeiro anúncio de cada contato vale; clicar em outro depois não muda). Agendou = algum agendamento não cancelado, calculado agora.
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

      <Card>
        <CampaignWeeklyPanel preview={trackedSince && (
            <section className="space-y-3 border-t border-ink/10 pt-4 panel:border-white/10">
              <CardTitle hint="O arquivo que vai no WhatsApp: a última semana fechada, gerado agora com os mesmos dados do envio. O período do topo da página não muda esta prévia.">Prévia do relatório semanal</CardTitle>
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-neutral panel:text-white/60">
                  <p>Semana de {previewRange}. É este PDF que chega no WhatsApp, com uma legenda curta.</p>
                  <p className="flex flex-wrap gap-4">
                    <a href="/relatorios/campanhas/pdf" target="_blank" rel="noopener" className="font-medium text-iris underline panel:text-white/80">Abrir em outra aba</a>
                    <a href="/relatorios/campanhas/pdf?baixar=1" className="font-medium text-iris underline panel:text-white/80">Baixar PDF</a>
                  </p>
                </div>
                <iframe
                  src="/relatorios/campanhas/pdf#toolbar=0&view=FitH"
                  title={`Prévia do relatório de campanhas, semana de ${previewRange}`}
                  loading="lazy"
                  className="h-[640px] w-full rounded-control border border-ink/10 bg-white panel:border-white/10"
                />
              </div>
            </section>
          )}>

          <section className="border-t border-ink/10 pt-4 panel:border-white/10">
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
          </section>
        </CampaignWeeklyPanel>
      </Card>
    </div>
  );
}
