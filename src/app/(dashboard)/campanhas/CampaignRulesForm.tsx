"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SelectMenu } from "@/components/ui/select-menu";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useSaveFeedback } from "@/components/ui/toast";
import { shiftDay } from "@/modules/campaigns/period";
import { campaignPromptPreview } from "@/modules/campaigns/prompt-preview";
import { parseCampaignRules, parseTimeList as parseTimes, type CampaignRules, type ClinicorpMode, type ReminderMode } from "@/modules/campaigns/rules";
import { linkTestLeadToCampaign, saveCampaignRules } from "./setup-actions";

const CLINICORP_OPTIONS = [
  { value: "default", label: "Padrão da conta" },
  { value: "off", label: "Não espelhar no Clinicorp" },
];

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

const QUESTION = "font-display text-base font-semibold text-ink panel:text-white";
const HELP = "text-sm text-neutral panel:text-white/60";

/**
 * As regras da campanha, em duas partes que salvam separado (o servidor junta
 * com o que já está gravado):
 *
 * - `agenda`: em que dias e horários marcar, vagas, chegada, lembretes e o que
 *   fazer quando o contato não pode;
 * - `fala`: oferta e instruções extras para o agente.
 *
 * A trava de verdade é do servidor (`saveCampaignRules`); a tela só ajuda a digitar.
 */
export function CampaignRulesForm({
  campaignId,
  campaign,
  rules,
  editable,
  part,
}: {
  campaignId: string;
  campaign: { name: string; objective: string | null; description: string | null };
  rules: CampaignRules;
  editable: boolean;
  part: "agenda" | "fala";
}) {
  const router = useRouter();
  const save = useSaveFeedback({ entity: "regras", action: "save", gender: "f", plural: true });
  const testLead = useSaveFeedback({ entity: "lead de teste", action: "save", gender: "m" });
  const base = useId();

  const [dates, setDates] = useState<string[]>(rules.dates);
  const [newDate, setNewDate] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [times, setTimes] = useState(rules.times.join(", "));
  const [byDate, setByDate] = useState<Record<string, string>>(
    Object.fromEntries(Object.entries(rules.timesByDate).map(([day, list]) => [day, list.join(", ")])),
  );
  const [isEvent, setIsEvent] = useState(rules.capacity !== null);
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
  const [followUp, setFollowUp] = useState(rules.followUp);
  const [clinicorp, setClinicorp] = useState<ClinicorpMode>(rules.clinicorp.mode);

  const disabled = !editable || save.saving;

  /** O que o agente lerá com o que está na tela agora (só leitura). */
  const preview = campaignPromptPreview(
    campaign,
    parseCampaignRules(
      part === "fala"
        ? { ...rules, offer, instructions }
        : { ...rules, arrival, reminders, outside, followUp, clinicorp: { mode: clinicorp }, dates, times: parseTimes(times), capacity: isEvent && capacity.trim() !== "" ? Number(capacity) : null, customReminders: reminders === "custom" ? custom.map((r) => ({ minutesBefore: Number(r.amount) * Number(r.unit), template: r.template })) : [] },
    ),
  );

  /** Uma data, ou um intervalo quando "até" está preenchido. */
  function addDates() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return;
    const days: string[] = [];
    const last = rangeTo && rangeTo >= newDate ? rangeTo : newDate;
    for (let day = newDate; day <= last && days.length < 60; day = shiftDay(day, 1)) days.push(day);
    setDates((list) => [...new Set([...list, ...days])].sort());
    setNewDate("");
    setRangeTo("");
  }

  async function submit() {
    const payload =
      part === "fala"
        ? { offer, instructions }
        : {
            dates,
            times: parseTimes(times),
            timesByDate: Object.fromEntries(
              Object.entries(byDate)
                .map(([day, value]) => [day, parseTimes(value)] as const)
                .filter(([day, list]) => list.length && (!dates.length || dates.includes(day))),
            ),
            capacity: isEvent && capacity.trim() !== "" ? Number(capacity) : null,
            arrival,
            reminders,
            customReminders:
              reminders === "custom"
                ? custom.map((r) => ({ minutesBefore: Number(r.amount) * Number(r.unit), template: r.template }))
                : [],
            outside,
            followUp,
            clinicorp: { mode: clinicorp },
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
      {part === "fala" ? (
        <fieldset disabled={disabled} className="space-y-4">
          <legend className={QUESTION}>O que o agente fala sobre a campanha</legend>
          <p className={HELP}>Vale só para os leads da campanha, em cima do que o agente já sabe.</p>
          <Field label="Oferta e condições" htmlFor={`${base}-offer`} optional hint="O agente usa isto na conversa e não inventa outras condições.">
            <Textarea
              id={`${base}-offer`}
              rows={3}
              maxLength={1500}
              value={offer}
              onChange={(e) => setOffer(e.target.value)}
              placeholder="Ex.: Avaliação de implante sem custo nos dias do evento."
            />
          </Field>
          <Field label="Instruções extras" htmlFor={`${base}-instructions`} optional hint="Como agir com esses contatos. Escreva como falaria com a recepção.">
            <Textarea
              id={`${base}-instructions`}
              rows={4}
              maxLength={2000}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Ex.: Não oferecer outras datas. Se a pessoa não puder, anotar o interesse e passar para a equipe."
            />
          </Field>
        </fieldset>
      ) : (
        <fieldset disabled={disabled} className="space-y-8">
          <div className="space-y-3">
            <p className={QUESTION}>Em quais dias o agente pode marcar?</p>
            <p className={HELP}>Deixe vazio para seguir a agenda normal da clínica.</p>
            {dates.length > 0 && (
              <ul className="flex flex-wrap gap-2">
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
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Dia" htmlFor={`${base}-date`}>
                <Input id={`${base}-date`} type="date" className="max-sm:h-11" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
              </Field>
              <Field label="Até (para vários dias seguidos)" htmlFor={`${base}-to`} optional>
                <Input id={`${base}-to`} type="date" className="max-sm:h-11" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} />
              </Field>
              <Button type="button" variant="outline" className="max-sm:h-11" disabled={!newDate} onClick={addDates}>
                <Plus size={16} aria-hidden />
                Adicionar
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            <p className={QUESTION}>Em quais horários?</p>
            <Field label="Horários, separados por vírgula" htmlFor={`${base}-times`} optional hint="Ex.: 09:00 ou 09:00, 14:00. Vazio = os horários livres da agenda.">
              <Input id={`${base}-times`} className="max-sm:h-11 sm:max-w-80" value={times} onChange={(e) => setTimes(e.target.value)} placeholder="09:00" />
            </Field>
            {dates.length > 1 && (
              <details className="text-sm">
                <summary className="min-h-11 cursor-pointer py-3 font-medium text-ink panel:text-white">Algum dia tem horários diferentes?</summary>
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
          </div>

          <div className="space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className={QUESTION}>É um evento, com várias pessoas no mesmo horário?</p>
                <p className={HELP}>Ligado, o agente marca várias pessoas no mesmo horário até acabarem as vagas, sem olhar o expediente.</p>
              </div>
              <Switch checked={isEvent} onCheckedChange={setIsEvent} disabled={disabled} label="É um evento" />
            </div>
            {isEvent && (
              <Field label="Vagas por horário" htmlFor={`${base}-capacity`}>
                <Input id={`${base}-capacity`} inputMode="numeric" className="max-sm:h-11 sm:max-w-40" value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="Ex.: 40" />
              </Field>
            )}
          </div>

          <Field label="O que o agente diz sobre a chegada" htmlFor={`${base}-arrival`} optional hint="Dito ao confirmar. Pode ser diferente do horário marcado.">
            <Input id={`${base}-arrival`} className="max-sm:h-11" maxLength={200} value={arrival} onChange={(e) => setArrival(e.target.value)} placeholder="Ex.: chegar às 08h40" />
          </Field>

          <div className="space-y-3">
            <p className={QUESTION}>Se o contato não puder nessas opções</p>
            <SegmentedControl
              label="Se o contato não puder"
              value={outside}
              disabled={disabled}
              onSelect={setOutside}
              options={[
                { value: "offer_alternative", label: "Oferecer as opções de novo" },
                { value: "handoff", label: "Passar para a equipe" },
              ]}
            />
          </div>

          <div className="space-y-3">
            <p className={QUESTION}>Lembretes automáticos</p>
            <SegmentedControl
              label="Lembretes"
              value={reminders}
              disabled={disabled}
              onSelect={setReminders}
              options={[
                { value: "default", label: "Os de sempre" },
                { value: "off", label: "Não mandar" },
                { value: "custom", label: "Outros" },
              ]}
            />
            <p className={HELP}>
              {reminders === "off"
                ? "Nenhum lembrete sai para os leads da campanha enquanto ela estiver ativa."
                : reminders === "custom"
                  ? "Só os lembretes abaixo, no lugar dos de sempre."
                  : "Os mesmos lembretes da agenda da clínica."}
            </p>
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
                      <Button type="button" variant="ghost" className="max-sm:h-11" aria-label="Tirar este lembrete" onClick={() => setCustom((list) => list.filter((_, i) => i !== index))}>
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
                  <Button type="button" variant="outline" className="max-sm:h-11" onClick={() => setCustom((list) => [...list, { amount: "1", unit: "1440", template: DEFAULT_REMINDER_TEXT }])}>
                    <Plus size={16} aria-hidden />
                    Adicionar lembrete
                  </Button>
                )}
                <p className={HELP}>Pode usar {"{{nome}}"}, {"{{data}}"}, {"{{hora}}"} e {"{{local}}"}.</p>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className={QUESTION}>Follow-up automático</p>
                <p className={HELP}>
                  {followUp
                    ? "Os leads da campanha seguem recebendo o follow-up de sempre."
                    : "Nenhum follow-up sai para os leads da campanha enquanto ela estiver ativa."}
                </p>
              </div>
              <Switch checked={followUp} onCheckedChange={setFollowUp} disabled={disabled} label="Follow-up automático" />
            </div>
          </div>

          <div className="space-y-3">
            <p className={QUESTION}>Consulta no Clinicorp</p>
            <SelectMenu label="Consulta no Clinicorp" value={clinicorp} onChange={(mode) => setClinicorp(mode as ClinicorpMode)} options={CLINICORP_OPTIONS} disabled={disabled} />
            <p className={HELP}>
              {clinicorp === "off"
                ? "As consultas da campanha ficam só no Fechai; a recepção lança no Clinicorp."
                : "A consulta é enviada ao Clinicorp como nas outras."}
            </p>
          </div>

          <details className="text-sm">
            <summary className="min-h-11 cursor-pointer py-3 font-medium text-ink panel:text-white">Mais opções</summary>
            <Field
              label="Manter as regras por mais alguns dias depois do fim"
              htmlFor={`${base}-grace`}
              optional
              hint="Só para quem já marcou: lembretes e remarcação seguem a regra da campanha por estes dias. Até 30."
            >
              <Input id={`${base}-grace`} inputMode="numeric" className="max-sm:h-11 sm:max-w-24" value={grace} onChange={(e) => setGrace(e.target.value)} />
            </Field>
          </details>
        </fieldset>
      )}

      <div className="space-y-2 rounded-control border border-ink/10 p-3 panel:border-white/15">
        <p className="text-sm font-medium text-ink panel:text-white">Um lead desta campanha verá:</p>
        <pre className="whitespace-pre-wrap break-words font-sans text-sm text-neutral panel:text-white/70">{preview}</pre>
      </div>

      {editable && part === "agenda" && (
        <div className="space-y-2">
          <p className={HELP}>Para conferir no chat de teste, ligue o lead de teste a esta campanha.</p>
          <Button
            type="button"
            variant="outline"
            className="max-sm:h-11"
            loading={testLead.saving}
            loadingLabel="Ligando"
            onClick={() => void testLead.run(() => linkTestLeadToCampaign(campaignId))}
          >
            Usar o lead de teste desta campanha
          </Button>
        </div>
      )}

      {editable && (
        <Button type="submit" className="max-sm:h-11 max-sm:w-full" loading={save.saving} loadingLabel="Salvando">
          {part === "fala" ? "Salvar o que o agente fala" : "Salvar agenda da campanha"}
        </Button>
      )}
    </form>
  );
}
