"use client";

import { useActionState, useId, useState } from "react";
import { useActionToast } from "@/components/ui/toast";
import { DEFAULT_SURVEY_TEXTS, SURVEY_TEXT_MAX, type SurveySettings } from "@/modules/satisfaction/settings";
import { TIMEZONES } from "@/modules/scheduling/time";
import { Button } from "@/components/ui/button";
import { Field, Fieldset } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { UnsavedForm } from "@/components/ui/unsaved-changes";
import { saveSurveySettingsAction, sendSurveyTestAction } from "./actions";

const hourOptions = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i).map((h) => ({ value: String(h), label: `${String(h).padStart(2, "0")}:00` }));
const START_HOURS = hourOptions(0, 23);
const END_HOURS = hourOptions(1, 24);

const DELAYS = [30, 60, 120, 180, 240, 360, 720, 1200];
const delayLabel = (m: number) => (m < 60 ? `${m} minutos` : m % 60 === 0 ? `${m / 60} ${m === 60 ? "hora" : "horas"}` : `${m} minutos`);

/**
 * Configuração da pesquisa de satisfação: ligar, quanto esperar depois da
 * conversa, faixa de horas e os quatro textos. Texto vazio usa o padrão. Quem
 * aprova o texto com a clínica é a Mavellium, fora daqui — não há etapa de
 * aprovação no sistema: ligada, a pesquisa sai.
 */
export function SurveySettingsForm({ settings }: { settings: SurveySettings }) {
  const [state, formAction, pending] = useActionState(saveSurveySettingsAction, null);
  useActionToast(state, pending, { entity: "pesquisa de satisfação", gender: "f" });
  const [enabled, setEnabled] = useState(settings.enabled);
  const [delay, setDelay] = useState(String(settings.delayMinutes));
  const [start, setStart] = useState(String(settings.windowStartHour));
  const [end, setEnd] = useState(String(settings.windowEndHour));
  const [timezone, setTimezone] = useState(settings.timezone);
  const delayId = useId();
  const startId = useId();
  const endId = useId();
  const zoneId = useId();
  const switchHint = useId();
  const textIds = { rating: useId(), low: useId(), high: useId(), thanks: useId() };

  const delayOptions = [...new Set([...DELAYS, settings.delayMinutes])]
    .sort((a, b) => a - b)
    .map((m) => ({ value: String(m), label: delayLabel(m) }));

  return (
    <UnsavedForm action={formAction} result={state} label="Pesquisa de satisfação" className="space-y-6">
      <input type="hidden" name="enabled" value={enabled ? "on" : ""} />
      <input type="hidden" name="delayMinutes" value={delay} />
      <input type="hidden" name="windowStartHour" value={start} />
      <input type="hidden" name="windowEndHour" value={end} />
      <input type="hidden" name="timezone" value={timezone} />

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink panel:text-white/85">Perguntar a nota depois da conversa</p>
          <p id={switchHint} className="mt-0.5 text-sm text-neutral panel:text-white/60">
            Só para quem conversou de verdade e não foi para a equipe. Uma vez a cada 30 dias por contato, sempre dentro das 24 horas do WhatsApp.
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} label={`Pesquisa: ${enabled ? "ligada" : "desligada"}`} describedBy={switchHint} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Esperar depois da conversa" htmlFor={`${delayId}-f`} labelId={delayId} hint="Silêncio do contato após a última resposta.">
          <SelectMenu label="Esperar depois da conversa" labelledBy={delayId} value={delay} onChange={setDelay} options={delayOptions} />
        </Field>
        <Field label="Enviar a partir das" htmlFor={`${startId}-f`} labelId={startId}>
          <SelectMenu label="Enviar a partir das" labelledBy={startId} value={start} onChange={setStart} options={START_HOURS} />
        </Field>
        <Field label="Até as" htmlFor={`${endId}-f`} labelId={endId}>
          <SelectMenu label="Até as" labelledBy={endId} value={end} onChange={setEnd} options={END_HOURS} />
        </Field>
        <Field label="Fuso" htmlFor={`${zoneId}-f`} labelId={zoneId}>
          <SelectMenu label="Fuso" labelledBy={zoneId} value={timezone} onChange={setTimezone} options={TIMEZONES.map((z) => ({ value: z.value, label: z.label }))} />
        </Field>
      </div>

      <Fieldset legend="Textos" hint="Deixe em branco para usar o texto padrão. Pelo número conectado por QR code, a pergunta da nota segue com a lista de 1 a 5 abaixo do texto.">
        <div className="space-y-4">
          <Field label="Pergunta da nota" htmlFor={textIds.rating}>
            <Textarea id={textIds.rating} name="ratingText" rows={2} maxLength={SURVEY_TEXT_MAX} defaultValue={settings.customized.rating ? settings.texts.rating : ""} placeholder={DEFAULT_SURVEY_TEXTS.rating} />
          </Field>
          <Field label="Depois de nota 1 a 3" htmlFor={textIds.low}>
            <Textarea id={textIds.low} name="lowText" rows={2} maxLength={SURVEY_TEXT_MAX} defaultValue={settings.customized.low ? settings.texts.low : ""} placeholder={DEFAULT_SURVEY_TEXTS.low} />
          </Field>
          <Field label="Depois de nota 4 ou 5" htmlFor={textIds.high}>
            <Textarea id={textIds.high} name="highText" rows={2} maxLength={SURVEY_TEXT_MAX} defaultValue={settings.customized.high ? settings.texts.high : ""} placeholder={DEFAULT_SURVEY_TEXTS.high} />
          </Field>
          <Field label="Agradecimento" htmlFor={textIds.thanks}>
            <Textarea id={textIds.thanks} name="thanksText" rows={2} maxLength={SURVEY_TEXT_MAX} defaultValue={settings.customized.thanks ? settings.texts.thanks : ""} placeholder={DEFAULT_SURVEY_TEXTS.thanks} />
          </Field>
        </div>
      </Fieldset>

      <Button type="submit" variant="outline" loading={pending} loadingLabel="Salvando">
        Salvar pesquisa
      </Button>
    </UnsavedForm>
  );
}

/** Envia a pergunta da nota agora, para um número: serve para ver como chega. */
export function SurveyTestForm() {
  const [state, formAction, pending] = useActionState(sendSurveyTestAction, null);
  useActionToast(state, pending, { entity: "teste da pesquisa", gender: "m" });
  const id = useId();

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <Field
        label="Enviar um teste para um número"
        htmlFor={id}
        hint="Sai agora, sem esperar o horário. A resposta do teste não entra nos números."
        className="min-w-64 flex-1"
      >
        <Input id={id} name="phone" type="tel" inputMode="tel" autoComplete="off" placeholder="(11) 98765-4321" required />
      </Field>
      <Button type="submit" variant="outline" loading={pending} loadingLabel="Enviando">
        Enviar teste
      </Button>
    </form>
  );
}
