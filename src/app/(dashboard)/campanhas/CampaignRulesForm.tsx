"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SelectMenu } from "@/components/ui/select-menu";
import { Textarea } from "@/components/ui/textarea";
import { useSaveFeedback } from "@/components/ui/toast";
import { shiftDay } from "@/modules/campaigns/period";
import { parseTimeList as parseTimes, type CampaignRules, type ReminderMode } from "@/modules/campaigns/rules";
import { saveCampaignRules } from "./setup-actions";

/** "2026-11-18" → "18/11/2026" (sem fuso: é um dia de calendário). */
function dayLabel(day: string): string {
  const [y, m, d] = day.split("-");
  return `${d}/${m}/${y}`;
}

const UNITS = [
  { value: "60", label: "horas antes" },
  { value: "1440", label: "dias antes" },
];

type ReminderDraft = { amount: string; unit: string; template: string };

const DEFAULT_REMINDER_TEXT = "Oi {{nome}}! Passando para lembrar da sua consulta em {{data}} às {{hora}}{{local}}.";

/**
 * Editor das regras do agente. Tudo salva junto ("Salvar regras"); a trava de
 * verdade é do servidor (`saveCampaignRules` → `parseCampaignRules` +
 * `validateCampaignRules`), a tela só ajuda a digitar.
 */
export function CampaignRulesForm({ campaignId, rules, editable }: { campaignId: string; rules: CampaignRules; editable: boolean }) {
  const router = useRouter();
  const save = useSaveFeedback({ entity: "regras", action: "save", gender: "f", plural: true });
  const base = useId();

  const [dates, setDates] = useState<string[]>(rules.dates);
  const [newDate, setNewDate] = useState("");
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [times, setTimes] = useState(rules.times.join(", "));
  const [byDate, setByDate] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(rules.timesByDate).map(([day, list]) => [day, list.join(", ")])),
  );
  const [capacity, setCapacity] = useState(rules.capacity === null ? "" : String(rules.capacity));
  const [arrival, setArrival] = useState(rules.arrival);
  const [reminders, setReminders] = useState<ReminderMode>(rules.reminders);
  const [custom, setCustom] = useState<ReminderDraft[]>(
    rules.customReminders.map((r) =>
      r.minutesBefore % 1440 === 0
        ? { amount: String(r.minutesBefore / 1440), unit: "1440", template: r.template }
        : { amount: String(Math.round(r.minutesBefore / 60)), unit: "60", template: r.template },
    ),
  );
  const [offer, setOffer] = useState(rules.offer);
  const [instructions, setInstructions] = useState(rules.instructions);
  const [outside, setOutside] = useState(rules.outside);
  const [grace, setGrace] = useState(String(rules.graceDays || ""));

  const disabled = !editable || save.saving;

  function addDate(day: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
    setDates((list) => [...new Set([...list, day])].sort());
  }
  function addRange() {
    if (!rangeFrom || !rangeTo || rangeTo < rangeFrom) return;
    const days: string[] = [];
    for (let day = rangeFrom; day <= rangeTo && days.length < 60; day = shiftDay(day, 1)) days.push(day);
    setDates((list) => [...new Set([...list, ...days])].sort());
    setRangeFrom("");
    setRangeTo("");
  }

  async function submit() {
    const timesByDate: Record<string, string[]> = {};
    for (const [day, value] of Object.entries(byDate)) {
      const list = parseTimes(value);
      if (list.length && (!dates.length || dates.includes(day))) timesByDate[day] = list;
    }
    const payload = {
      dates,
      times: parseTimes(times),
      timesByDate,
      capacity: capacity.trim() === "" ? null : Number(capacity),
      arrival,
      reminders,
      customReminders:
        reminders === "custom"
          ? custom.map((r) => ({ minutesBefore: Number(r.amount) * Number(r.unit), template: r.template }))
          : [],
      offer,
      instructions,
      outside,
      graceDays: grace.trim() === "" ? 0 : Number(grace),
    };
    const result = await save.run(() => saveCampaignRules(campaignId, payload));
    if (result.ok) router.refresh();
  }

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Card className="p-4 sm:p-6">
        <CardTitle hint="Valem só para os leads desta campanha e só durante ela. O sistema recusa agendamento fora destas opções, mesmo que a IA tente.">
          Datas e horários para agendar
        </CardTitle>

        <fieldset disabled={disabled} className="space-y-4">
          <div>
            <p className="text-sm font-medium text-ink panel:text-white/90">Datas permitidas</p>
            <p className="text-sm text-neutral panel:text-white/60">Sem datas, vale qualquer dia de atendimento.</p>
            {dates.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-2">
                {dates.map((day) => (
                  <li key={day} className="inline-flex items-center gap-1 rounded-full bg-iris/15 py-1 pl-3 pr-1 text-sm text-ink panel:text-white">
                    {dayLabel(day)}
                    <button
                      type="button"
                      aria-label={`Tirar ${dayLabel(day)}`}
                      className="inline-flex size-8 items-center justify-center rounded-full hover:bg-ink/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris panel:hover:bg-white/10"
                      onClick={() => {
                        setDates((list) => list.filter((d) => d !== day));
                        setByDate((map) => Object.fromEntries(Object.entries(map).filter(([key]) => key !== day)));
                      }}
                    >
                      <X size={16} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <Field label="Uma data" htmlFor={`${base}-date`}>
                <Input id={`${base}-date`} type="date" className="max-sm:h-11" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
              </Field>
              <Button
                type="button"
                variant="outline"
                className="max-sm:h-11"
                onClick={() => {
                  addDate(newDate);
                  setNewDate("");
                }}
              >
                <Plus size={16} aria-hidden />
                Adicionar
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <Field label="Intervalo: de" htmlFor={`${base}-from`}>
                <Input id={`${base}-from`} type="date" className="max-sm:h-11" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} />
              </Field>
              <Field label="até" htmlFor={`${base}-to`}>
                <Input id={`${base}-to`} type="date" className="max-sm:h-11" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} />
              </Field>
              <Button type="button" variant="outline" className="max-sm:h-11" onClick={addRange}>
                <Plus size={16} aria-hidden />
                Adicionar intervalo
              </Button>
            </div>
          </div>

          <Field
            label="Horários ofertados"
            htmlFor={`${base}-times`}
            optional
            hint="Separados por vírgula, como 09:00, 14:00. Sem horários, vale a grade normal da agenda nas datas permitidas."
          >
            <Input id={`${base}-times`} className="max-sm:h-11" value={times} onChange={(e) => setTimes(e.target.value)} placeholder="Ex.: 09:00" />
          </Field>

          {dates.length > 0 && (
            <details className="text-sm">
              <summary className="min-h-11 cursor-pointer py-3 font-medium text-ink panel:text-white">
                Horários diferentes em alguma data
              </summary>
              <div className="grid gap-3 sm:grid-cols-2">
                {dates.map((day) => (
                  <Field key={day} label={dayLabel(day)} htmlFor={`${base}-d-${day}`} optional>
                    <Input
                      id={`${base}-d-${day}`}
                      className="max-sm:h-11"
                      placeholder="Usa os horários acima"
                      value={byDate[day] ?? ""}
                      onChange={(e) => setByDate((map) => ({ ...map, [day]: e.target.value }))}
                    />
                  </Field>
                ))}
              </div>
            </details>
          )}

          <Field
            label="Vagas por horário"
            htmlFor={`${base}-capacity`}
            optional
            hint="Para evento: várias pessoas no mesmo horário, sem olhar o expediente nem outras consultas. Vazio = agenda normal, uma pessoa por horário."
          >
            <Input id={`${base}-capacity`} inputMode="numeric" className="max-sm:h-11 sm:max-w-40" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          </Field>

          <Field label="Horário de chegada informado" htmlFor={`${base}-arrival`} optional hint="O agente diz isto ao confirmar. Pode ser diferente do horário da consulta.">
            <Input id={`${base}-arrival`} className="max-sm:h-11" maxLength={200} value={arrival} onChange={(e) => setArrival(e.target.value)} placeholder="Ex.: chegar às 09h00" />
          </Field>

          <div>
            <p className="mb-2 text-sm font-medium text-ink panel:text-white/90">Se o contato pedir outra data ou horário</p>
            <SegmentedControl
              label="Comportamento fora da regra"
              value={outside}
              disabled={disabled}
              onSelect={setOutside}
              options={[
                { value: "offer_alternative", label: "Recusar e oferecer as opções" },
                { value: "handoff", label: "Transferir para humano" },
              ]}
            />
          </div>
        </fieldset>
      </Card>

      <Card className="p-4 sm:p-6">
        <CardTitle hint="Desligado: nenhum lembrete automático sai para os leads da campanha enquanto ela vale; os que já estavam programados ficam suspensos e voltam a ser avaliados quando ela termina.">
          Lembretes automáticos
        </CardTitle>
        <fieldset disabled={disabled} className="space-y-4">
          <SegmentedControl
            label="Lembretes"
            value={reminders}
            disabled={disabled}
            onSelect={setReminders}
            options={[
              { value: "default", label: "Os da agenda" },
              { value: "off", label: "Desligados" },
              { value: "custom", label: "Personalizados" },
            ]}
          />
          {reminders === "custom" && (
            <div className="space-y-3">
              {custom.map((reminder, index) => (
                <div key={index} className="space-y-2 rounded-control border border-ink/10 p-3 panel:border-white/15">
                  <div className="flex flex-wrap items-end gap-2">
                    <Field label="Quanto antes" htmlFor={`${base}-r-${index}`}>
                      <Input
                        id={`${base}-r-${index}`}
                        inputMode="numeric"
                        className="max-sm:h-11 sm:max-w-24"
                        value={reminder.amount}
                        onChange={(e) => setCustom((list) => list.map((r, i) => (i === index ? { ...r, amount: e.target.value } : r)))}
                      />
                    </Field>
                    <SelectMenu
                      label="Unidade"
                      value={reminder.unit}
                      onChange={(unit) => setCustom((list) => list.map((r, i) => (i === index ? { ...r, unit } : r)))}
                      options={UNITS}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      className="max-sm:h-11"
                      aria-label="Tirar este lembrete"
                      onClick={() => setCustom((list) => list.filter((_, i) => i !== index))}
                    >
                      <Trash2 size={16} aria-hidden />
                    </Button>
                  </div>
                  <Textarea
                    aria-label="Texto do lembrete"
                    rows={2}
                    maxLength={600}
                    value={reminder.template}
                    onChange={(e) => setCustom((list) => list.map((r, i) => (i === index ? { ...r, template: e.target.value } : r)))}
                  />
                </div>
              ))}
              {custom.length < 5 && (
                <Button
                  type="button"
                  variant="outline"
                  className="max-sm:h-11"
                  onClick={() => setCustom((list) => [...list, { amount: "1", unit: "1440", template: DEFAULT_REMINDER_TEXT }])}
                >
                  <Plus size={16} aria-hidden />
                  Adicionar lembrete
                </Button>
              )}
              <p className="text-sm text-neutral panel:text-white/60">
                Variáveis: {"{{nome}}"}, {"{{data}}"}, {"{{hora}}"} e {"{{local}}"}. Sem nenhum lembrete válido, fica desligado.
              </p>
            </div>
          )}
        </fieldset>
      </Card>

      <Card className="p-4 sm:p-6">
        <CardTitle>O que o agente fala</CardTitle>
        <fieldset disabled={disabled} className="space-y-4">
          <Field label="Oferta e condições" htmlFor={`${base}-offer`} optional hint="O agente usa na conversa e não inventa outras condições.">
            <Textarea id={`${base}-offer`} rows={3} maxLength={1500} value={offer} onChange={(e) => setOffer(e.target.value)} />
          </Field>
          <Field label="Instruções extras para a IA" htmlFor={`${base}-instructions`} optional hint="Anexadas às instruções do agente, só para os leads da campanha.">
            <Textarea
              id={`${base}-instructions`}
              rows={4}
              maxLength={2000}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Ex.: Não oferecer outras datas; se o lead não puder, registrar interesse e transferir para humano."
            />
          </Field>
          <Field
            label="Estender as regras depois do fim (dias)"
            htmlFor={`${base}-grace`}
            optional
            hint="Para quem já agendou: lembretes e remarcação seguem a regra da campanha por mais estes dias. Até 30."
          >
            <Input id={`${base}-grace`} inputMode="numeric" className="max-sm:h-11 sm:max-w-24" value={grace} onChange={(e) => setGrace(e.target.value)} />
          </Field>
        </fieldset>
      </Card>

      {editable && (
        <div className="flex justify-end">
          <Button type="submit" className="max-sm:h-11 max-sm:w-full" loading={save.saving} loadingLabel="Salvando regras">
            Salvar regras
          </Button>
        </div>
      )}
    </form>
  );
}
