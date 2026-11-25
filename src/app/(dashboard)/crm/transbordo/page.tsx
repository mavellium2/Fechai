import type React from "react";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireCrmAccess } from "@/modules/crm/access";
import { loadBusinessCalendar, readHandoffSla } from "@/modules/crm/handoff-sla";
import { AUTO_RETURN_SUGGESTED_HOURS, parseAutoReturn } from "@/modules/crm/handoff-auto-return";
import { prisma } from "@/lib/prisma";
import { crmDurationLabel } from "@/modules/crm/sla";
import { SlaForm } from "./SlaForm";

export const metadata: Metadata = { title: "Prazos do transbordo" };

export default async function HandoffDeadlinesPage() {
  const tenantId = await requireCrmAccess();
  const [sla, calendar, row] = await Promise.all([
    readHandoffSla(tenantId),
    loadBusinessCalendar(tenantId),
    prisma.handoffSlaSettings.findUnique({ where: { tenantId }, select: { autoReturnHours: true, autoReturnBusinessHoursOnly: true, autoReturnHumanStage: true } }),
  ]);

  const autoReturn = parseAutoReturn(row);
  // O que acontece com um lead transferido, na ordem, com os prazos salvos.
  const clock = sla.businessHoursOnly ? (calendar ? " no horário de atendimento" : "") : " corridos";
  const steps = [
    { at: "Na hora", title: "A IA transfere o lead", text: "O grupo da equipe recebe o aviso com o resumo e o link do card." },
    { at: `${crmDurationLabel(sla.alertMinutes)}${clock}`, title: "Aviso de novo no grupo", text: "Se ninguém assumiu, o grupo recebe “⏰ Aguardando há…”, citando o aviso." },
    { at: `${crmDurationLabel(sla.escalateMinutes)}${clock}`, title: "Escalonado aos donos",
      text: sla.escalateByEmail ? "O card aparece como escalonado no CRM e os donos recebem um e-mail." : "O card aparece como escalonado no CRM. E-mail desligado." },
    autoReturn.hours !== null
      ? { at: `${autoReturn.hours} h sem resposta`, title: "Volta para a IA", text: "A IA retoma, pede desculpas pela demora e o grupo é avisado." }
      : { at: "Desligado", title: "Devolução automática", text: "O lead fica com a equipe até alguém responder ou devolver." },
  ];

  return (
    <div className="w-full min-w-0 space-y-5">
      <PageHeader
        eyebrow="CRM"
        title="Prazos do transbordo"
        hint="Quanto tempo um lead pode esperar alguém da equipe antes de o Fechai avisar de novo ou devolver para a IA."
        actions={<ButtonLink href="/crm" variant="action"><ArrowLeft size={16} aria-hidden />Voltar ao CRM</ButtonLink>}
      />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="p-4 sm:p-6">
          <SlaForm sla={sla} autoReturn={autoReturn} suggestedHours={AUTO_RETURN_SUGGESTED_HOURS} hasSchedule={Boolean(calendar)} />
        </Card>
        <Card className="p-4 sm:p-6 lg:sticky lg:top-0">
          <CardTitle as="h2" hint="Mostra os prazos salvos. Depois de alterar, salve para ver a sequência atualizada.">O que acontece com o lead</CardTitle>
          <ol className="sla-timeline relative space-y-5 border-l border-ink/10 pl-5 panel:border-white/10">
            {steps.map((step, i) => (
              <li key={step.title} className="sla-step relative" style={{ "--i": i } as React.CSSProperties}>
                <span aria-hidden className={`absolute -left-[1.6rem] top-0.5 flex size-3 rounded-full ring-4 ring-white panel:ring-ink ${i === steps.length - 1 && autoReturn.hours === null ? "bg-ink/20 panel:bg-white/25" : "sla-dot bg-signal"}`} />
                <p className="font-mono text-micro uppercase tracking-[0.15em] text-signal">{step.at}</p>
                <p className="mt-1 text-sm font-medium">{step.title}</p>
                <p className="mt-0.5 text-sm text-neutral panel:text-white/60">{step.text}</p>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}
