"use client";

import { useActionState, useCallback, useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useActionToast } from "@/components/ui/toast";
import type { GroupListResult } from "@/modules/agent-engine/handoff";
import {
  WEEKDAYS,
  formatReportPhone,
  type CampaignDestination,
  type CampaignSettings,
} from "@/modules/campaign-reports/settings";
import { TIMEZONES } from "@/modules/scheduling/time";
import { Button } from "@/components/ui/button";
import { Field, Fieldset } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioCards } from "@/components/ui/radio-cards";
import { SelectMenu } from "@/components/ui/select-menu";
import { Switch } from "@/components/ui/switch";
import { UnsavedForm } from "@/components/ui/unsaved-changes";
import { GroupPicker } from "../agentes/HandoffSettings";
import { loadWhatsAppGroupsAction } from "../agentes/actions";
import {
  requestCampaignHistoryImportAction,
  saveCampaignSettingsAction,
  sendCampaignReportNowAction,
} from "./actions";

const WEEKDAY_OPTIONS = WEEKDAYS.map((label, i) => ({ value: String(i), label }));
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${String(h).padStart(2, "0")}:00` }));
const LOAD_FAILED: GroupListResult = { ok: false, reason: "failed", error: "Não foi possível buscar os grupos do WhatsApp agora." };

const DESTINATIONS = [
  { value: "group", label: "Em um grupo", hint: "A equipe toda vê o relatório." },
  { value: "phone", label: "No meu número", hint: "Só você recebe, no seu WhatsApp." },
] as const;

/**
 * Envio semanal do relatório de campanhas: ligar, para onde vai (um grupo ou um
 * número), dia da semana, hora e fuso. Os dois destinos ficam guardados no
 * formulário: trocar de um para o outro não apaga o que estava no outro. Sem
 * grupo salvo aqui, parte do grupo dos avisos de Perguntas (é o que o envio usa).
 */
export function CampaignSettingsForm({ settings, questionsGroup }: {
  settings: CampaignSettings;
  questionsGroup: { id: string | null; name: string | null };
}) {
  const [state, formAction, pending] = useActionState(saveCampaignSettingsAction, null);
  useActionToast(state, pending, { entity: "envio semanal", gender: "m" });
  const [enabled, setEnabled] = useState(settings.enabled);
  const [destination, setDestination] = useState<CampaignDestination>(settings.destination);
  const [weekday, setWeekday] = useState(String(settings.weekday));
  const [hour, setHour] = useState(String(settings.hour));
  const [timezone, setTimezone] = useState(settings.timezone);
  const savedGroupId = settings.groupId ?? questionsGroup.id;
  const savedGroupName = settings.groupId ? settings.groupName : questionsGroup.name;
  const [groupId, setGroupId] = useState(savedGroupId ?? "");
  const [groupName, setGroupName] = useState(savedGroupName ?? "");
  const [phone, setPhone] = useState(settings.phone ? formatReportPhone(settings.phone) : "");
  const [groups, setGroups] = useState<GroupListResult | null>(null);
  const [loadingGroups, startLoadingGroups] = useTransition();
  const dayId = useId();
  const hourId = useId();
  const zoneId = useId();
  const groupFieldId = useId();
  const phoneId = useId();
  const switchHint = useId();

  const loadGroups = useCallback(() => {
    startLoadingGroups(async () => {
      setGroups(await loadWhatsAppGroupsAction().catch(() => LOAD_FAILED));
    });
  }, []);

  // A lista de grupos só é buscada quando o destino é um grupo: a Evolution leva segundos para listar.
  useEffect(() => {
    if (destination === "group" && !groups && !loadingGroups) loadGroups();
  }, [destination, groups, loadingGroups, loadGroups]);

  function chooseGroup(id: string) {
    setGroupId(id);
    const fromList = groups?.ok ? groups.groups.find((g) => g.id === id)?.name : undefined;
    setGroupName(fromList ?? (id === savedGroupId ? (savedGroupName ?? "") : ""));
  }

  const target = destination === "phone"
    ? "Vai para o seu número, pelo WhatsApp da clínica."
    : groupName
      ? <>Vai para o grupo <strong className="font-medium">{groupName}</strong>.</>
      : "Vai para o grupo do WhatsApp que você escolher abaixo.";

  return (
    <UnsavedForm action={formAction} result={state} label="Envio semanal do relatório" className="space-y-5">
      <input type="hidden" name="enabled" value={enabled ? "on" : ""} />
      <input type="hidden" name="weekday" value={weekday} />
      <input type="hidden" name="hour" value={hour} />
      <input type="hidden" name="timezone" value={timezone} />
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="groupName" value={groupName} />
      <input type="hidden" name="phone" value={phone} />

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink panel:text-white/85">Enviar o relatório toda semana</p>
          <p id={switchHint} className="mt-0.5 text-sm text-neutral panel:text-white/60">{target}</p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} label={`Envio semanal: ${enabled ? "ligado" : "desligado"}`} describedBy={switchHint} />
      </div>

      <Fieldset legend="Para onde enviar">
        <RadioCards
          name="destination"
          columns={1}
          value={destination}
          onChange={(v) => setDestination(v as CampaignDestination)}
          options={DESTINATIONS}
        />
      </Fieldset>

      {/* A lista carrega sozinha ao abrir: fora da conta do "alterações não salvas". A escolha vale pelo `groupId` oculto. */}
      <div hidden={destination !== "group"} data-unsaved-ignore>
        <GroupPicker
          fieldId={groupFieldId}
          labelId={`${groupFieldId}-label`}
          groups={groups}
          loading={loadingGroups}
          groupId={groupId}
          savedGroupId={savedGroupId}
          savedGroupName={savedGroupName}
          required={false}
          onChoose={chooseGroup}
          onReload={loadGroups}
        />
      </div>

      <div hidden={destination !== "phone"}>
        <Field
          label="Seu número"
          htmlFor={phoneId}
          hint="Com DDD. Sai pelo WhatsApp da clínica (QR code). Para o WhatsApp não estranhar, mande um “oi” desse número para o da clínica antes do primeiro envio."
        >
          <Input
            id={phoneId}
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="(11) 98765-4321"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>
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

/** Envia agora o relatório da última semana fechada: serve para ver como chega. */
export function CampaignSendNowForm({ disabledReason, destination }: { disabledReason: string | null; destination: CampaignDestination }) {
  const [state, formAction, pending] = useActionState(sendCampaignReportNowAction, null);
  useActionToast(state, pending, { entity: "relatório de campanhas", gender: "m" });

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <Button type="submit" variant="outline" loading={pending} loadingLabel="Enviando" disabled={Boolean(disabledReason)}>
        Enviar agora
      </Button>
      <p className="text-sm text-neutral panel:text-white/60">
        {disabledReason ?? `Manda ${destination === "phone" ? "no seu número" : "no grupo"} agora, sem esperar o horário. Se já tiver saído hoje, o do horário marcado sai de novo.`}
      </p>
    </form>
  );
}

/**
 * Importar o histórico: a aba só se preenche sozinha com contatos novos; quem já
 * tinha chegado de anúncio entra depois de o Fechai ler o que o WhatsApp guardou.
 * O pedido só entra na fila (o worker lê, leva minutos), então a página se
 * atualiza sozinha enquanto houver importação em andamento.
 */
export function CampaignHistoryImport({ history, canRequest, days }: {
  history: CampaignSettings["history"];
  canRequest: boolean;
  days: number;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(requestCampaignHistoryImportAction, null);
  useActionToast(state, pending, { entity: "importação do histórico", gender: "f" });
  const active = history.status === "requested" || history.status === "running";

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(timer);
  }, [active, router]);

  const message =
    history.status === "requested" ? "Na fila: o Fechai vai ler o histórico do WhatsApp em instantes."
    : history.status === "running" ? "Lendo o histórico do WhatsApp. Leva alguns minutos; a página se atualiza sozinha."
    : history.summary;

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <Button type="submit" variant="outline" loading={pending || active} loadingLabel={active ? "Importando" : "Pedindo"} disabled={!canRequest}>
        {history.status === "done" ? "Importar de novo" : history.status === "failed" ? "Tentar de novo" : "Importar histórico"}
      </Button>
      <p className="min-w-[14rem] flex-1 text-sm text-neutral panel:text-white/60">
        {message ?? `Lê as mensagens dos últimos ${days} dias do WhatsApp e liga cada lead ao anúncio de onde veio.`}
      </p>
    </form>
  );
}
