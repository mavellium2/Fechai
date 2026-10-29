"use client";

import { useActionState, useId, useState } from "react";
import { useActionToast } from "@/components/ui/toast";
import { WEEKDAYS, type CampaignSettings } from "@/modules/campaign-reports/settings";
import { TIMEZONES } from "@/modules/scheduling/time";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SelectMenu } from "@/components/ui/select-menu";
import { Switch } from "@/components/ui/switch";
import { UnsavedForm } from "@/components/ui/unsaved-changes";
import { saveCampaignSettingsAction, sendCampaignReportNowAction } from "./actions";

const WEEKDAY_OPTIONS = WEEKDAYS.map((label, i) => ({ value: String(i), label }));
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, "0")}:00` }));

/**
 * Envio semanal do relatório de campanhas: ligar, dia da semana, hora e fuso.
 * O destino não se escolhe aqui — é o grupo dos avisos de Perguntas, para a
 * clínica manter um grupo interno só.
 */
export function CampaignSettingsForm({ settings, groupName }: { settings: CampaignSettings; groupName: string | null }) {
  const [state, formAction, pending] = useActionState(saveCampaignSettingsAction, null);
  useActionToast(state, pending, { entity: "envio semanal", gender: "m" });
  const [enabled, setEnabled] = useState(settings.enabled);
  const [weekday, setWeekday] = useState(String(settings.weekday));
  const [hour, setHour] = useState(String(settings.hour));
  const [timezone, setTimezone] = useState(settings.timezone);
  const dayId = useId();
  const hourId = useId();
  const zoneId = useId();
  const switchHint = useId();

  return (
    <UnsavedForm action={formAction} result={state} label="Envio semanal do relatório" className="space-y-5">
      <input type="hidden" name="enabled" value={enabled ? "on" : ""} />
      <input type="hidden" name="weekday" value={weekday} />
      <input type="hidden" name="hour" value={hour} />
      <input type="hidden" name="timezone" value={timezone} />

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink panel:text-white/85">Enviar o relatório toda semana</p>
          <p id={switchHint} className="mt-0.5 text-sm text-neutral panel:text-white/60">
            {groupName
              ? <>Vai para o grupo <strong className="font-medium">{groupName}</strong>, o mesmo dos avisos de perguntas sem resposta.</>
              : "Vai para o mesmo grupo dos avisos de perguntas sem resposta. Escolha esse grupo em Perguntas antes de ligar."}
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} label={`Envio semanal: ${enabled ? "ligado" : "desligado"}`} describedBy={switchHint} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Dia da semana" htmlFor={`${dayId}-f`} labelId={dayId} hint="Cobre os 7 dias até ontem.">
          <SelectMenu label="Dia da semana" labelledBy={dayId} value={weekday} onChange={setWeekday} options={WEEKDAY_OPTIONS} />
        </Field>
        <Field label="Hora" htmlFor={`${hourId}-f`} labelId={hourId}>
          <SelectMenu label="Hora" labelledBy={hourId} value={hour} onChange={setHour} options={HOUR_OPTIONS} />
        </Field>
        <Field label="Fuso" htmlFor={`${zoneId}-f`} labelId={zoneId}>
          <SelectMenu label="Fuso" labelledBy={zoneId} value={timezone} onChange={setTimezone} options={TIMEZONES.map((z) => ({ value: z.value, label: z.label }))} />
        </Field>
      </div>

      <Button type="submit" variant="outline" loading={pending} loadingLabel="Salvando">
        Salvar envio
      </Button>
    </UnsavedForm>
  );
}

/** Envia agora o relatório da última semana fechada: serve para ver como chega no grupo. */
export function CampaignSendNowForm({ disabledReason }: { disabledReason: string | null }) {
  const [state, formAction, pending] = useActionState(sendCampaignReportNowAction, null);
  useActionToast(state, pending, { entity: "relatório de campanhas", gender: "m" });

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <Button type="submit" variant="outline" loading={pending} loadingLabel="Enviando" disabled={Boolean(disabledReason)}>
        Enviar agora
      </Button>
      <p className="text-sm text-neutral panel:text-white/60">
        {disabledReason ?? "Manda no grupo agora, sem esperar o horário. Se já tiver saído hoje, o do horário marcado sai de novo."}
      </p>
    </form>
  );
}
