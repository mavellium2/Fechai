"use client";

import { useActionState, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useActionToast } from "@/components/ui/toast";
import { UnsavedForm } from "@/components/ui/unsaved-changes";
import { saveHandoffSlaSettings } from "./actions";

type Sla = { alertMinutes: number; escalateMinutes: number; businessHoursOnly: boolean; escalateByEmail: boolean };
type AutoReturn = { hours: number | null; businessHoursOnly: boolean; humanStage: boolean };

/**
 * Prazos do transbordo (CRM-10): quando o grupo é avisado de novo e quando
 * escalona. E a devolução automática para a IA (CRM-12), desligada por padrão.
 */
export function SlaForm({ sla, autoReturn, suggestedHours, hasSchedule }: {
  sla: Sla; autoReturn: AutoReturn; suggestedHours: number; hasSchedule: boolean;
}) {
  const [state, save, pending] = useActionState(saveHandoffSlaSettings, null);
  useActionToast(state, pending, { entity: "prazos do transbordo", gender: "m", plural: true });
  const alertId = useId();
  const escalateId = useId();
  const hoursDesc = useId();
  const emailDesc = useId();
  const [businessHoursOnly, setBusinessHoursOnly] = useState(sla.businessHoursOnly);
  const [escalateByEmail, setEscalateByEmail] = useState(sla.escalateByEmail);
  const autoDesc = useId();
  const autoHoursId = useId();
  const autoHoursDesc = useId();
  const autoHumanDesc = useId();
  const [autoOn, setAutoOn] = useState(autoReturn.hours !== null);
  const [autoBusinessHours, setAutoBusinessHours] = useState(autoReturn.businessHoursOnly);
  const [autoHuman, setAutoHuman] = useState(autoReturn.humanStage);

  return (
    <UnsavedForm action={save} result={state} label="Prazos do transbordo" className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Avisar o grupo de novo depois de (minutos)" htmlFor={alertId}
          hint="Com o lead ainda aguardando, o grupo recebe “⏰ Aguardando há…”, citando o aviso. Uma vez por espera.">
          <Input id={alertId} name="alertMinutes" type="number" inputMode="numeric" min={1} max={10080} step={1}
            defaultValue={sla.alertMinutes} required disabled={pending} />
        </Field>
        <Field label="Escalonar para os donos depois de (minutos)" htmlFor={escalateId}
          hint="O CRM mostra a espera escalonada e, se ligado abaixo, os donos da conta recebem um e-mail. Uma vez por espera.">
          <Input id={escalateId} name="escalateMinutes" type="number" inputMode="numeric" min={2} max={10080} step={1}
            defaultValue={sla.escalateMinutes} required disabled={pending} />
        </Field>
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Contar só o horário de atendimento</p>
          <p id={hoursDesc} className="mt-0.5 text-sm text-neutral panel:text-white/60">
            {hasSchedule
              ? "Fora do horário de atendimento cadastrado o tempo não corre e ninguém é avisado."
              : "Ainda não há horário de atendimento cadastrado em Agentes: o tempo corre o dia todo até ele ser cadastrado."}
          </p>
        </div>
        <Switch checked={businessHoursOnly} onCheckedChange={setBusinessHoursOnly} disabled={pending}
          label={`Contar só o horário de atendimento: ${businessHoursOnly ? "ligado" : "desligado"}`} describedBy={hoursDesc} />
      </div>
      <input type="hidden" name="businessHoursOnly" value={businessHoursOnly ? "on" : ""} />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Mandar o escalonamento por e-mail</p>
          <p id={emailDesc} className="mt-0.5 text-sm text-neutral panel:text-white/60">
            Os donos da conta recebem um e-mail com o link de cada card escalonado. Sem nome, telefone ou conversa do contato.
          </p>
        </div>
        <Switch checked={escalateByEmail} onCheckedChange={setEscalateByEmail} disabled={pending}
          label={`Mandar o escalonamento por e-mail: ${escalateByEmail ? "ligado" : "desligado"}`} describedBy={emailDesc} />
      </div>
      <input type="hidden" name="escalateByEmail" value={escalateByEmail ? "on" : ""} />

      <section className="space-y-4 border-t border-ink/10 pt-5 panel:border-white/10" aria-labelledby={`${autoDesc}-titulo`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={`${autoDesc}-titulo`} className="text-sm font-medium">Devolver para a IA automaticamente</h2>
            <p id={autoDesc} className="mt-0.5 text-sm text-neutral panel:text-white/60">
              Se ninguém da equipe responder dentro do prazo, a IA volta a atender, pede desculpas pela demora e o grupo é avisado.
              Card em Fechado ou Perdido nunca volta. Desligado, nada muda.
            </p>
          </div>
          <Switch checked={autoOn} onCheckedChange={setAutoOn} disabled={pending}
            label={`Devolver para a IA automaticamente: ${autoOn ? "ligado" : "desligado"}`} describedBy={autoDesc} />
        </div>
        <input type="hidden" name="autoReturn" value={autoOn ? "on" : ""} />
        {/* Escondido, não desmontado: desligar e religar não perde as escolhas. */}
        <div hidden={!autoOn} className="space-y-4">
          <Field label="Devolver depois de (horas sem resposta humana)" htmlFor={autoHoursId} hint={`Sugestão: ${suggestedHours} horas.`}>
            <Input id={autoHoursId} name="autoReturnHours" type="number" inputMode="numeric" min={1} max={168} step={1}
              defaultValue={autoReturn.hours ?? suggestedHours} required={autoOn} disabled={pending} />
          </Field>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Contar só o horário de atendimento</p>
              <p id={autoHoursDesc} className="mt-0.5 text-sm text-neutral panel:text-white/60">
                Fora do horário de atendimento cadastrado, o prazo da devolução não corre.
              </p>
            </div>
            <Switch checked={autoBusinessHours} onCheckedChange={setAutoBusinessHours} disabled={pending}
              label={`Contar só o horário de atendimento na devolução: ${autoBusinessHours ? "ligado" : "desligado"}`} describedBy={autoHoursDesc} />
          </div>
          <input type="hidden" name="autoReturnBusinessHoursOnly" value={autoBusinessHours ? "on" : ""} />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Valer também para quem está em atendimento humano</p>
              <p id={autoHumanDesc} className="mt-0.5 text-sm text-neutral panel:text-white/60">
                Mesmo depois de alguém assumir, o contato que escreveu e ficou sem resposta nesse prazo volta para a IA.
              </p>
            </div>
            <Switch checked={autoHuman} onCheckedChange={setAutoHuman} disabled={pending}
              label={`Valer também para quem está em atendimento humano: ${autoHuman ? "ligado" : "desligado"}`} describedBy={autoHumanDesc} />
          </div>
          <input type="hidden" name="autoReturnHumanStage" value={autoHuman ? "on" : ""} />
        </div>
      </section>

      <Button type="submit" loading={pending}>Salvar prazos</Button>
    </UnsavedForm>
  );
}
