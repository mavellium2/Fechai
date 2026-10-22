"use client";

import { ClinicorpQrTermsDialog } from "./ClinicorpQrTermsDialog";
import { errorToResult, isFrameworkSignal } from "@/components/ui/toast/save-service";
import { startTransition, useActionState, useRef, useState } from "react";
import { useSaveFeedback } from "@/components/ui/toast/use-save-feedback";
import { testConfirmationMessage } from "../agenda/confirmation-test-action";
import { useActionToast } from "@/components/ui/toast";
import type { ScheduleConfig } from "@/modules/scheduling/config";
import {
  MAX_DURATIONS,
  MAX_DURATION_MINUTES,
  MIN_DURATION_MINUTES,
  normalizeDurationLabel,
} from "@/modules/scheduling/config";
import { ReminderList, fromDrafts, toDrafts, type ReminderDraft } from "./ReminderList";
import { MetaReminderTemplatePicker } from "./MetaReminderTemplatePicker";
import { ReminderAudienceSettings } from "./ReminderAudienceSettings";
import type { MetaReminderTemplate } from "@/modules/scheduling/meta-reminder";
import { TIMEZONES } from "@/modules/scheduling/time";
import { Button } from "@/components/ui/button";
import { Field, fieldProps } from "@/components/ui/field";
import { InfoHint } from "@/components/ui/info-hint";
import { Input } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import { Switch } from "@/components/ui/switch";
import { Download } from "lucide-react";
import { loadClinicorpDurationNamesAction, loadClinicorpReminderTypesAction, saveScheduleConfigAction, type Result } from "./actions";
import { trackFormSubmission, UnsavedForm } from "@/components/ui/unsaved-changes";

import { WeeklyAvailabilityGrid } from "./WeeklyAvailabilityGrid";
import { BlockedDatesList } from "./BlockedDatesList";
import { getWeeklyAvailability } from "@/modules/scheduling/weekly-availability";

/**
 * Uma variação em edição. `minutes: null` = campo em branco: o formulário
 * recusa salvar (o input é `required`), mas o estado precisa representar isso
 * — tanto para quem apaga o número para redigitar quanto para os tipos
 * trazidos do Clinicorp, que chegam sem duração porque a API não a informa.
 */
type DurationDraft = { label: string; minutes: number | null };

/**
 * Horário de atendimento da ação "Agendar horário".
 *
 * Fica embaixo do próprio toggle, e não numa tela de configurações separada:
 * a pergunta "onde eu digo que só atendo de terça a sábado?" só aparece na
 * cabeça de quem acabou de ligar o agendamento. O que for salvo aqui vai para
 * o prompt do agente e é validado de novo na hora de marcar.
 */
export function ScheduleSettings({
  agentId,
  config,
  clinicorpConnected = false,
  metaReminders = false,
}: {
  agentId: string;
  config: ScheduleConfig;
  /**
   * Clinicorp habilitado E com credencial válida. Só então o botão de trazer
   * os tipos de lá aparece — para as outras contas seria um botão que só sabe
   * dizer "não está conectado".
   */
  clinicorpConnected?: boolean;
  /**
   * WhatsApp pela API oficial da Meta. Fora da janela de 24h (inclusive quem
   * nunca conversou com o número, como os pacientes do Clinicorp) o lembrete
   * só sai por ela, com template aprovado.
   */
  metaReminders?: boolean;
}) {
  const [clinicorpQrEnabled, setClinicorpQrEnabled] = useState(config.clinicorpQrEnabled);
  const [clinicorpQrConsent, setClinicorpQrConsent] = useState(Boolean(config.clinicorpQrConsentAt));
  const [qrTermsOpen, setQrTermsOpen] = useState(false);
  const qrToggleRef = useRef<HTMLInputElement>(null);
  const [state, formAction, pending] = useActionState(async (previous: Result | null, data: FormData): Promise<Result> => {
    try {
      const result = await saveScheduleConfigAction(previous, data);
      if (result.ok && data.get("clinicorpQrRiskAccepted") === "true") {
        setClinicorpQrEnabled(true);
        setClinicorpQrConsent(true);
        setQrTermsOpen(false);
        const form = formRef.current;
        if (form) {
          // Snapshot the confirmed values before React renders them. The
          // unsaved-form snapshot also reads controls disabled while pending.
          for (const key of ["clinicorpQrEnabled", "clinicorpQrConsent"]) {
            const input = form.elements.namedItem(key);
            if (input instanceof HTMLInputElement) input.value = "true";
          }
          if (qrToggleRef.current) qrToggleRef.current.checked = true;
          trackFormSubmission(form);
        }
      }
      return result;
    } catch (error) {
      if (isFrameworkSignal(error)) throw error;
      return { ...errorToResult(error), ok: false };
    }
  }, null);
  useActionToast(state, pending, { entity: "configuração de agendamento", gender: "f" });
  const [weeklyAvailability, setWeeklyAvailability] = useState(() => getWeeklyAvailability(config));
  // `minutes: null` é a linha em branco: existe enquanto a pessoa digita e é o
  // estado em que cada tipo importado do Clinicorp nasce (a API não diz a
  // duração). O `required` do campo é o que impede salvar assim.
  const [durations, setDurations] = useState<DurationDraft[]>(config.durations);
  const [importing, setImporting] = useState(false);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [timezone, setTimezone] = useState(config.timezone);
  const [options, setOptions] = useState({
    allowCancellation: config.allowCancellation,
    allowRescheduling: config.allowRescheduling,
    recognizeExisting: config.recognizeExisting,
  });

  // O lembrete tem switch próprio (fora do trio acima) porque ele revela
  // campos: ligar abre a lista, e gravar sozinho nesse caso salvaria um
  // lembrete antes da pessoa escrever o texto. Aqui o switch só mostra a
  // lista; quem grava é o botão do rodapé.
  const [reminderEnabled, setReminderEnabled] = useState(config.reminderEnabled);
  const [reminderAudience, setReminderAudience] = useState(config.reminderAudience);
  const [reminderTypes, setReminderTypes] = useState(config.reminderTypes);
  const [reminders, setReminders] = useState<ReminderDraft[]>(() => toDrafts(config.reminders));
  const [metaTemplate, setMetaTemplate] = useState<MetaReminderTemplate | null>(config.metaReminderTemplate ?? null);
  const [blockedDates, setBlockedDates] = useState(() => config.blockedDates);

  const formRef = useRef<HTMLFormElement>(null);
  const confirmationTest = useSaveFeedback({ entity: "mensagem de teste", gender: "f" });

  /**
   * Traz as categorias de agendamento do Clinicorp como nomes de variação.
   *
   * **Só os nomes, com a duração em branco**: o Clinicorp não informa quanto
   * tempo cada categoria leva (`list_categories` devolve id, descrição e cor).
   * Preencher com um chute — a duração padrão, ou o slot da clínica — faria a
   * tela afirmar um dado que a clínica nunca deu, e ninguém revisaria um campo
   * que já parece respondido. Em branco, o `required` obriga a revisão.
   *
   * O que já está na lista é preservado: quem ajustou "Limpeza" para 30 min não
   * perde isso porque clicou no botão. Importar de novo só acrescenta o que
   * falta.
   */
  async function importFromClinicorp() {
    setImporting(true);
    setImportNotice(null);
    try {
      const result = await loadClinicorpDurationNamesAction();
      if (!result.ok) {
        setImportNotice(result.error);
        return;
      }

      let added = 0;
      let full = false;
      setDurations((current) => {
        const seen = new Set(current.map((d) => normalizeDurationLabel(d.label)));
        const next = [...current];
        for (const name of result.names) {
          if (next.length >= MAX_DURATIONS) { full = true; break; }
          if (seen.has(normalizeDurationLabel(name))) continue;
          seen.add(normalizeDurationLabel(name));
          next.push({ label: name, minutes: null });
          added++;
        }
        return next;
      });

      setImportNotice(
        added === 0
          ? full
            ? `Limite de ${MAX_DURATIONS} variações atingido. Remova alguma antes de trazer outras.`
            : "Todos os tipos do Clinicorp já estão na lista."
          : `${added} tipo(s) trazido(s) do Clinicorp. O Clinicorp não informa a duração de cada um — preencha os minutos antes de salvar.${full ? ` O limite de ${MAX_DURATIONS} foi atingido e o resto ficou de fora.` : ""}`,
      );
    } catch {
      // Terceiro fora do ar não pode travar o formulário: o resto da
      // configuração de agendamento continua salvável à mão.
      setImportNotice("Não foi possível falar com o Clinicorp agora. Tente de novo ou cadastre os tipos à mão.");
    } finally {
      setImporting(false);
    }
  }

  /**
   * Os três switches gravam sozinhos, sem esperar o botão do rodapé.
   *
   * O resto do formulário é digitação (horário, duração, pausas), onde salvar
   * a cada tecla seria errado — mas um switch já parece salvo assim que muda
   * de lado, e o botão fica longe, depois das pausas. Quem ligava "permitir
   * cancelamento" e dava F5 via o toggle voltar para desligado, achando que o
   * produto tinha perdido a configuração. Mesmo comportamento do toggle da
   * própria ação, logo acima deste bloco.
   *
   * O envio sai daqui mesmo, e não de um efeito que observa o estado: o valor
   * novo já é conhecido no clique, então esperar o render seguinte só criaria
   * a cascata de renders que o lint (com razão) recusa. `FormData` do
   * formulário + `set` do que acabou de mudar cobre o resto dos campos sem
   * depender do input escondido já ter sido atualizado.
   */
  function saveOption(key: keyof typeof options, checked: boolean) {
    setOptions((current) => ({ ...current, [key]: checked }));

    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    data.set(key, String(checked));
    // O envio automático também precisa atualizar a referência do aviso.
    // O React ainda não renderizou o hidden com o novo valor neste clique.
    const input = form.elements.namedItem(key);
    if (input instanceof HTMLInputElement) input.value = String(checked);
    trackFormSubmission(form);
    startTransition(() => formAction(data));
  }

  return (
    <>
    <UnsavedForm ref={formRef} result={state} label="Agendamento" onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      startTransition(() => formAction(data));
    }} className="space-y-5 border-t border-white/10 pt-5">
      <input type="hidden" name="agentId" value={agentId} />
      <fieldset disabled={pending} className="min-w-0 space-y-5">
      <div className="space-y-4">
        {([
          ["allowCancellation", "Permitir cancelamento", "O agente confirma qual consulta será cancelada e espera a confirmação do cliente antes de desmarcar."],
          ["allowRescheduling", "Permitir reagendamento", "O agente troca o horário após o cliente confirmar. Se o novo horário estiver indisponível, mantém o original."],
          ["recognizeExisting", "Reconhecer consulta já marcada", "Ao receber uma confirmação ou retorno, reconhece a consulta sem reiniciar o agendamento ou oferecer novos horários."],
        ] as const).map(([key, label, description]) => (
          <div key={key} className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-white/85">{label}</p>
              <p id={`schedule-${key}`} className="mt-1 text-sm text-white/60">{description}</p>
            </div>
            <Switch checked={options[key]} onCheckedChange={(checked) => saveOption(key, checked)}
              label={label} describedBy={`schedule-${key}`} />
            <input type="hidden" name={key} value={String(options[key])} />
          </div>
        ))}
      </div>

      <WeeklyAvailabilityGrid value={weeklyAvailability} onChange={setWeeklyAvailability} disabled={pending} />
      <input type="hidden" name="startTime" value={config.startTime} />
      <input type="hidden" name="endTime" value={config.endTime} />
      <input type="hidden" name="breaks" value="[]" />

      {/* Logo depois da grade porque é a exceção dela: a grade diz que quarta
          é dia de atendimento, isto diz que ESTA quarta não é. */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-white/85">Dias sem atendimento</legend>
        <p className="text-sm text-white/60">
          Feriados, recesso ou qualquer data em que o agente não deve marcar — mesmo caindo num
          dia liberado na grade acima.
        </p>
        <BlockedDatesList value={blockedDates} onChange={setBlockedDates} disabled={pending} />
      </fieldset>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Duração padrão"
          htmlFor="schedule-duration"
          hint="Em minutos. É o bloco que o agente reserva quando o atendimento não tem duração própria."
        >
          <Input
            {...fieldProps("schedule-duration", { hint: true })}
            type="number"
            name="durationMinutes"
            min={MIN_DURATION_MINUTES}
            max={MAX_DURATION_MINUTES}
            step={5}
            defaultValue={config.durationMinutes}
            required
          />
        </Field>

        <Field
          label="Antecedência mínima"
          htmlFor="schedule-notice"
          hint="Em horas. Impede o agente de marcar para daqui a cinco minutos."
        >
          <Input
            {...fieldProps("schedule-notice", { hint: true })}
            type="number"
            name="minNoticeHours"
            min={0}
            max={168}
            defaultValue={config.minNoticeHours}
            required
          />
        </Field>

        <div className="space-y-2">
          <p id="schedule-tz-label" className="text-sm font-medium text-white/85">Fuso horário</p>
          <SelectMenu name="timezone" label="Fuso horário" labelledBy="schedule-tz-label"
            options={TIMEZONES.some((tz) => tz.value === timezone) ? [...TIMEZONES] : [...TIMEZONES, { value: timezone, label: timezone }]}
            value={timezone} onChange={setTimezone} />
        </div>

        <Field
          label="Local ou formato"
          htmlFor="schedule-location"
          hint="Vai na confirmação que o agente manda."
          optional
        >
          <Input
            {...fieldProps("schedule-location", { hint: true })}
            name="location"
            placeholder="Ex: no estúdio, Rua X, 100 — ou Google Meet"
            defaultValue={config.location}
            maxLength={200}
          />
        </Field>
      </div>

      {/*
        Variações ficam logo abaixo da duração padrão, e não numa aba própria:
        a pergunta "e quando o atendimento é mais curto?" nasce olhando o campo
        do padrão. Com a lista vazia (o caso comum) só o botão aparece, então
        quem atende tudo no mesmo bloco não paga por uma opção que não usa.
      */}
      <fieldset className="min-w-0 space-y-3">
        <legend className="flex items-center gap-1.5 text-sm font-medium text-white/85">
          Durações por tipo de atendimento
          <InfoHint label="durações por tipo de atendimento">
            Quando um tipo de atendimento ocupa mais ou menos tempo que o padrão. O agente
            pergunta o tipo ao contato e reserva o bloco daquele tamanho. Sem o tipo na conversa,
            ele usa a duração padrão.
          </InfoHint>
        </legend>
        <p className="text-sm text-white/60">Opcional. Sem nenhuma variação, todo horário usa a duração padrão.</p>
        <input type="hidden" name="durations" value={JSON.stringify(durations)} />
        {durations.map((item, index) => (
          <div key={index} className="grid items-end gap-3 rounded-control border border-white/10 p-3 sm:grid-cols-[1fr_auto_auto]">
            <Field label="Tipo de atendimento" htmlFor={`duration-label-${index}`}>
              <Input id={`duration-label-${index}`} placeholder="Ex: limpeza" maxLength={60} required value={item.label}
                onChange={(e) => setDurations((current) => current.map((d, i) => i === index ? { ...d, label: e.target.value } : d))} />
            </Field>
            <Field label="Duração (min)" htmlFor={`duration-minutes-${index}`}>
              {/*
                Vazio é estado válido durante a digitação — e é como cada linha
                importada do Clinicorp nasce, já que a API não informa a duração.
                O `required` é o que impede salvar assim.
              */}
              <Input id={`duration-minutes-${index}`} type="number" required className="sm:w-28"
                placeholder="min" min={MIN_DURATION_MINUTES} max={MAX_DURATION_MINUTES} step={5}
                value={item.minutes === null ? "" : item.minutes}
                onChange={(e) => setDurations((current) => current.map((d, i) =>
                  i === index ? { ...d, minutes: e.target.value === "" ? null : e.target.valueAsNumber } : d))} />
            </Field>
            <Button type="button" variant="ghost" aria-label={`Remover duração ${item.label || index + 1}`}
              onClick={() => setDurations((current) => current.filter((_, i) => i !== index))}>Remover</Button>
          </div>
        ))}
        {importNotice && (
          <p className="text-sm text-amber/90">{importNotice}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={durations.length >= MAX_DURATIONS}
            onClick={() => setDurations((current) => [...current, { label: "", minutes: null }])}>
            Adicionar duração
          </Button>
          {/*
            Só com o Clinicorp habilitado e conectado: um botão que só sabe
            dizer "não está conectado" é ruído para as contas que não usam.
            O servidor confere a mesma coisa — esconder não é autorização.
          */}
          {clinicorpConnected && (
            <Button type="button" variant="ghost" loading={importing} loadingLabel="Buscando no Clinicorp"
              disabled={durations.length >= MAX_DURATIONS} onClick={importFromClinicorp}>
              <Download size={14} aria-hidden />
              Trazer tipos do Clinicorp
            </Button>
          )}
        </div>
      </fieldset>

      <fieldset className="min-w-0 space-y-4 border-t border-white/10 pt-5">
        <legend className="sr-only">Lembrete de consulta</legend>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-white/85">Lembrar o contato antes da consulta</p>
            <p id="schedule-reminder-desc" className="mt-1 text-sm text-white/60">
              O agente manda uma mensagem sozinho antes do horário marcado. Se a pessoa responder,
              ele continua a conversa normalmente — inclusive para remarcar.
            </p>
          </div>
          <Switch
            checked={reminderEnabled}
            onCheckedChange={setReminderEnabled}
            label="Lembrar o contato antes da consulta"
            describedBy="schedule-reminder-desc"
          />
        </div>
        {/* Escondido, não desmontado: desligar os lembretes é pausar, não
            apagar os textos que a pessoa escreveu (mesma regra do grupo do
            handoff). A lista continua no envio, então religar reencontra tudo. */}
        <div className={reminderEnabled ? "" : "hidden"}>
          <ReminderAudienceSettings
            idPrefix={`reminder-${agentId}`} audience={reminderAudience} types={reminderTypes}
            availableTypes={durations.map((type) => type.label)}
            onAudienceChange={setReminderAudience} onTypesChange={setReminderTypes}
            loadTypes={clinicorpConnected ? loadClinicorpReminderTypesAction : undefined} disabled={pending}
          />
          <Button type="button" size="sm" variant="outline" loading={confirmationTest.saving} onClick={() => confirmationTest.run(() => testConfirmationMessage(agentId))}>Adicionar confirmação à conversa de teste</Button>
          <ReminderList
            value={reminders}
            onChange={setReminders}
            location={config.location}
            idPrefix="agente"
          />
          {clinicorpConnected && <div className="mt-4 space-y-3 rounded-control border border-white/10 p-3">
            <label className="flex items-start gap-2 text-sm text-white/85">
              <input ref={qrToggleRef} type="checkbox" checked={clinicorpQrEnabled} onChange={(event) => {
                if (!event.target.checked) { setClinicorpQrEnabled(false); return; }
                // The checkbox remains off until the acceptance is saved on the server.
                if (formRef.current?.reportValidity()) setQrTermsOpen(true);
              }} className="mt-1 accent-iris" />
              Confirmar pacientes do Clinicorp pelo WhatsApp conectado por QR, mesmo sem conversa anterior no Fechai
            </label>
            <p className="text-sm text-white/60">Escolha os tipos autorizados acima. A confirmação usa a categoria cadastrada no Clinicorp e o número conectado por QR. Contatos que falam pela Meta continuam nesse canal.</p>
            <p className="text-xs text-white/55">A ativação exige leitura dos riscos, aceite dos termos e identificação do responsável.</p>
            {clinicorpQrEnabled && config.clinicorpQrRiskAcceptance && <p className="text-xs text-white/65">
              Aceite registrado por {config.clinicorpQrRiskAcceptance.responsibleName}.
            </p>}
          </div>}
          {metaReminders && <div className="mt-4"><MetaReminderTemplatePicker value={metaTemplate} onChange={setMetaTemplate} location={config.location} disabled={pending} /></div>}

        </div>
      </fieldset>

      </fieldset>
      <input type="hidden" name="reminderEnabled" value={String(reminderEnabled)} />
      <input type="hidden" name="reminderAudience" value={reminderAudience} />
      <input type="hidden" name="reminderTypes" value={JSON.stringify(reminderTypes)} />
      <input type="hidden" name="reminders" value={JSON.stringify(fromDrafts(reminders))} />
      <input type="hidden" name="clinicorpQrEnabled" value={String(clinicorpQrEnabled)} />
      <input type="hidden" name="clinicorpQrConsent" value={String(clinicorpQrConsent)} />
      <input type="hidden" name="metaReminderTemplate" value={metaTemplate ? JSON.stringify(metaTemplate) : ""} />


      <Button type="submit" variant="outline" loading={pending} loadingLabel="Salvando agendamento">
        Salvar configurações de agendamento
      </Button>
    </UnsavedForm>
    {qrTermsOpen && <ClinicorpQrTermsDialog pending={pending} result={state} onClose={() => setQrTermsOpen(false)}
      onAccept={(terms) => {
        const form = formRef.current;
        if (!form) return;
        const data = new FormData(form);
        for (const [key, value] of terms) data.set(key, value);
        data.set("clinicorpQrEnabled", "true");
        data.set("clinicorpQrConsent", "true");
        startTransition(() => formAction(data));
      }} />}
    </>
  );
}
