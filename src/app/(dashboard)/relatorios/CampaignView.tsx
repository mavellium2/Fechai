import { Megaphone } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Card, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Stat } from "@/components/ui/stat";
import { HorizontalBars } from "@/components/charts/HorizontalBars";
import { describeCampaignSchedule, type CampaignSendStatus, type CampaignSettings } from "@/modules/campaign-reports/settings";
import { percent } from "@/modules/campaign-reports/summary";
import type { CampaignReport } from "@/modules/campaign-reports/queries";
import { formatInZone } from "@/modules/scheduling/time";
import { CampaignSendNowForm, CampaignSettingsForm } from "./CampaignSettingsForm";

const pct = (n: number, d: number) => {
  const value = percent(n, d);
  return value === null ? "—" : `${value}%`;
};

const STATUS_LABEL: Record<CampaignSendStatus, string> = {
  sent: "enviado ao grupo",
  no_group: "não enviado: sem grupo escolhido",
  no_channel: "não enviado: WhatsApp por QR code desconectado",
  no_data: "não enviado: ainda sem anúncio registrado",
  failed: "envio sem confirmação — confira o grupo",
};

const dateLabel = (date: Date) =>
  new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" }).format(date);

/**
 * Campanhas: de qual anúncio vieram os leads do período e o que aconteceu com
 * eles, mais o envio semanal desse relatório ao grupo da clínica. Só agregados:
 * nenhum nome, telefone ou texto de conversa.
 */
export function CampaignView({ report, settings, groupName, period }: {
  report: CampaignReport;
  settings: CampaignSettings;
  groupName: string | null;
  period: string;
}) {
  const { current: c, trackedSince } = report;
  const sendBlocked = !groupName
    ? "Escolha o grupo nos avisos de Perguntas para poder enviar."
    : !trackedSince ? "Ainda não há anúncio registrado nesta conta." : null;

  return (
    <div className="space-y-6">
      {!trackedSince ? (
        <Card>
          <EmptyState
            icon={Megaphone}
            title="Ainda não há anúncio registrado"
            description="Assim que chegar um contato vindo de anúncio do Instagram ou do Facebook, o Fechai guarda de qual anúncio ele veio e este relatório começa a se preencher."
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

          <div className="grid gap-6 lg:grid-cols-2">
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

      <Card>
        <CardTitle hint="O relatório da semana vai ao mesmo grupo de WhatsApp dos avisos de perguntas sem resposta.">Envio semanal no grupo</CardTitle>
        <div className="space-y-5">
          {!groupName && (
            <Alert tone="warn" title="Nenhum grupo escolhido">
              Escolha o grupo do WhatsApp nos avisos de Perguntas. O relatório de campanhas usa o mesmo.
            </Alert>
          )}
          <CampaignSettingsForm settings={settings} groupName={groupName} />
          <div className="space-y-2 border-t border-ink/10 pt-5 panel:border-white/10">
            <CampaignSendNowForm disabledReason={sendBlocked} />
            <p className="text-xs text-neutral panel:text-white/55">
              {settings.enabled ? `Programado: ${describeCampaignSchedule(settings)}.` : "Envio automático desligado."}
              {settings.lastStatus ? ` Última tentativa: ${STATUS_LABEL[settings.lastStatus]}.` : ""}
              {settings.lastSentAt ? ` Último envio: ${formatInZone(settings.lastSentAt, settings.timezone)}.` : ""}
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
