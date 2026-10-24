"use client";

import { useActionState, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Apple } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-dialog";
import { Field, fieldProps } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import { Switch } from "@/components/ui/switch";
import { useActionToast, useSaveFeedback } from "@/components/ui/toast/use-save-feedback";
import { UnsavedForm } from "@/components/ui/unsaved-changes";
import {
  connectIcloudAction,
  disconnectIcloudAction,
  saveIcloudSettingsAction,
  setIcloudToggle,
  testIcloudConnectionAction,
} from "./actions";

export type IcloudCalendarOption = { url: string; name: string };

export type IcloudState =
  | {
      connected: false;
      /** Falta `ENCRYPTION_KEY` no servidor: guardar a senha de app em texto claro está fora de questão. */
      encryptionReady: boolean;
    }
  | {
      connected: true;
      encryptionReady: boolean;
      /** "m***@icloud.com": nunca o Apple ID inteiro, nunca a senha. */
      appleIdHint: string;
      calendarUrl: string | null;
      busyCalendarUrls: string[];
      /** Null = a lista não pôde ser carregada agora (iCloud fora do ar ou senha revogada). */
      calendars: IcloudCalendarOption[] | null;
      syncEnabled: boolean;
      checkAvailability: boolean;
      /** A Apple recusou a senha: tudo parado até reconectar. */
      authFailed: boolean;
      lastError: string | null;
      /** "há 3 horas", já formatado no servidor (o relógio do navegador divergiria na hidratação). */
      lastErrorWhen: string | null;
      connectionError: string | null;
    };

/**
 * Conexão com o Calendário da Apple (iCloud).
 *
 * Não há botão de consentimento como no Google: o iCloud não tem OAuth para
 * calendário. A pessoa gera uma **senha de app** na conta Apple e cola aqui —
 * então a tela precisa dizer ONDE gerar (sem isso a integração trava na
 * primeira tela) e avisar o que vai para o calendário dela.
 */
export function IcloudCalendarCard({ state }: { state: IcloudState }) {
  if (!state.connected) return <IcloudConnectForm encryptionReady={state.encryptionReady} />;
  return <IcloudConnected state={state} />;
}

function IcloudConnectForm({ encryptionReady, reconnect = false }: { encryptionReady: boolean; reconnect?: boolean }) {
  const router = useRouter();
  const id = useId();
  const [result, action, pending] = useActionState(
    async (prev: Awaited<ReturnType<typeof connectIcloudAction>> | null, data: FormData) => {
      const next = await connectIcloudAction(prev, data);
      if (next.ok) router.refresh();
      return next;
    },
    null,
  );
  useActionToast(result, pending, { entity: "calendário da Apple", action: "save", gender: "m" });

  return (
    <UnsavedForm action={action} result={result} label="Conexão Calendário da Apple" className="space-y-3">
      {!reconnect && (
        <p className="text-sm text-white/55">
          Conecte para que os horários marcados aqui apareçam no iPhone em segundos — e para o agente
          não oferecer um horário que você já ocupou no Calendário.
        </p>
      )}

      <Alert tone="info">
        O evento enviado leva o nome do paciente, o procedimento, o WhatsApp e as observações da
        consulta para o iCloud de quem conectar. Conecte só uma conta da clínica.
      </Alert>

      <details className="rounded-surface border border-white/10 bg-white/5 p-3">
        <summary className="cursor-pointer text-sm font-medium text-white/80">
          Como gerar a senha de app?
        </summary>
        <ol className="mt-2 list-decimal space-y-1 pl-4 text-sm text-white/60">
          <li>
            Acesse <span className="text-white/80">appleid.apple.com</span> e entre com o Apple ID da
            clínica. A <span className="text-white/80">verificação em duas etapas</span> precisa estar
            ligada.
          </li>
          <li>Abra <span className="text-white/80">Entrar e segurança</span> e depois <span className="text-white/80">Senhas de app</span>.</li>
          <li>
            Clique em <span className="text-white/80">Gerar senha de app</span>, dê o nome{" "}
            <span className="text-white/80">fechai</span> e copie a senha (no formato abcd-efgh-ijkl-mnop).
          </li>
          <li>Cole abaixo. Não use a senha do seu Apple ID: ela é recusada.</li>
        </ol>
      </details>

      <Field label="Apple ID" htmlFor={`${id}-apple`}>
        <Input {...fieldProps(`${id}-apple`)} name="appleId" type="email" autoComplete="off" required />
      </Field>

      <Field label="Senha de app" htmlFor={`${id}-pass`}>
        {/* `password`: é uma credencial e a tela pode estar sendo compartilhada. */}
        <Input {...fieldProps(`${id}-pass`)} name="appPassword" type="password" autoComplete="off" required />
      </Field>

      {!encryptionReady && (
        <Alert tone="warn">
          Integração indisponível nesta instalação: falta a chave de criptografia no servidor.
        </Alert>
      )}

      <Button type="submit" size="sm" loading={pending} disabled={!encryptionReady}>
        {reconnect ? "Reconectar" : "Conectar Calendário da Apple"}
      </Button>
    </UnsavedForm>
  );
}

function IcloudConnected({ state }: { state: Extract<IcloudState, { connected: true }> }) {
  const router = useRouter();
  const id = useId();
  const [, startTransition] = useTransition();
  const [calendarUrl, setCalendarUrl] = useState(state.calendarUrl ?? "");
  const [busy, setBusy] = useState<Set<string>>(new Set(state.busyCalendarUrls));
  const [busySwitch, setBusySwitch] = useState<"sync" | "availability" | null>(null);

  const [settings, saveSettings, savingSettings] = useActionState(saveIcloudSettingsAction, null);
  useActionToast(settings, savingSettings, { entity: "preferências do calendário", action: "save", gender: "f" });
  const toggleFeedback = useSaveFeedback({ entity: "preferência do calendário", action: "update", gender: "f" });
  const testFeedback = useSaveFeedback({ entity: "conexão com o iCloud", action: "save", gender: "f" });
  const disconnectFeedback = useSaveFeedback({ entity: "calendário da Apple", action: "delete", gender: "m" });

  const calendars = state.calendars;
  const others = (calendars ?? []).filter((c) => c.url !== calendarUrl);

  function toggle(field: "syncEnabled" | "checkAvailability", next: boolean) {
    setBusySwitch(field === "syncEnabled" ? "sync" : "availability");
    startTransition(async () => {
      await toggleFeedback.run(() => setIcloudToggle(field, next));
      setBusySwitch(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <Apple size={16} aria-hidden className="mt-0.5 shrink-0 text-success" />
        <p className="min-w-0 truncate text-sm text-white/70">Apple ID {state.appleIdHint}</p>
      </div>

      <Button
        type="button"
        size="sm"
        variant="outline"
        loading={testFeedback.saving}
        onClick={() => startTransition(async () => {
          await testFeedback.run(() => testIcloudConnectionAction());
          router.refresh();
        })}
      >
        Testar conexão
      </Button>

      {/* Senha revogada: tudo parado. Diz o que isso causa e leva direto ao reconectar. */}
      {state.authFailed && (
        <>
          <Alert tone="danger" title="O Calendário da Apple parou">
            {state.lastError ?? "A senha de app foi revogada ou o Apple ID mudou."}
            {state.checkAvailability ? " O agente parou de oferecer horários até você reconectar." : ""}
            {state.lastErrorWhen ? ` (${state.lastErrorWhen})` : ""}
          </Alert>
          <IcloudConnectForm encryptionReady={state.encryptionReady} reconnect />
        </>
      )}

      {!state.authFailed && state.connectionError && (
        <Alert tone="warn">{state.connectionError}</Alert>
      )}

      {!state.authFailed && !state.connectionError && state.lastError && (
        <Alert tone="warn">
          Falha no Calendário da Apple{state.lastErrorWhen ? ` ${state.lastErrorWhen}` : ""}: {state.lastError}
        </Alert>
      )}

      {!state.calendarUrl && !state.authFailed && (
        <Alert tone="info">Escolha abaixo o calendário que recebe os horários. Enquanto isso, nada é enviado.</Alert>
      )}

      {calendars === null && !state.authFailed && (
        <Alert tone="warn">
          Não foi possível carregar a lista de calendários agora. Tente de novo em instantes.
        </Alert>
      )}

      {/* Via onSubmit + transition: <form action> dispara um reset nativo no commit
          do React e os campos voltariam ao valor antigo após salvar. */}
      {calendars !== null && (
        <UnsavedForm
          result={settings}
          label="Preferências Calendário da Apple"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            startTransition(() => saveSettings(data));
          }}
          className="space-y-3"
        >
          <div>
            <p id={`${id}-cal-label`} className="text-sm font-medium text-ink panel:text-white/85">
              Calendário que recebe os horários
            </p>
            <p className="mt-1 text-sm text-neutral panel:text-white/55">
              Os horários marcados aqui aparecem neste calendário, no iPhone.
            </p>
            <div className="mt-2">
              <SelectMenu
                labelledBy={`${id}-cal-label`}
                label="Calendário que recebe os horários"
                name="calendarUrl"
                size="sm"
                value={calendarUrl}
                onChange={(next) => {
                  setCalendarUrl(next);
                  // O calendário de gravação já é lido; não entra como "outro".
                  setBusy((current) => new Set([...current].filter((url) => url !== next)));
                }}
                options={[
                  // A opção vazia É o placeholder: sem ela o menu mostraria o primeiro
                  // calendário como se já estivesse escolhido e o servidor recusaria.
                  { value: "", label: "Escolha o calendário" },
                  ...calendars.map((c) => ({ value: c.url, label: c.name })),
                ]}
              />
            </div>
          </div>

          {others.length > 0 && (
            <fieldset>
              <legend className="text-sm font-medium text-ink panel:text-white/85">
                Considerar também como ocupado
                <span className="ml-1.5 font-normal text-neutral panel:text-white/50">(opcional)</span>
              </legend>
              <p className="mt-1 text-sm text-neutral panel:text-white/55">
                Compromissos destes calendários também bloqueiam horários do agente. Só leitura: nada é
                gravado neles.
              </p>
              <ul className="mt-2 space-y-1.5">
                {others.map((c) => (
                  <li key={c.url}>
                    <label className="flex items-center gap-2 text-sm text-white/75">
                      <input
                        type="checkbox"
                        name="busyCalendarUrls"
                        value={c.url}
                        checked={busy.has(c.url)}
                        onChange={(event) =>
                          setBusy((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(c.url);
                            else next.delete(c.url);
                            return next;
                          })
                        }
                        className="accent-iris"
                      />
                      {c.name}
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}

          <Button type="submit" size="sm" variant="outline" loading={savingSettings}>
            Salvar preferências
          </Button>
        </UnsavedForm>
      )}

      <div className="space-y-3 border-t border-white/10 pt-3">
        <div className="flex items-center justify-between gap-3">
          <p id="icloud-sync-desc" className="text-sm text-white/65">
            Enviar novos horários para o Calendário da Apple
          </p>
          <Switch
            checked={state.syncEnabled}
            loading={busySwitch === "sync"}
            label={`Enviar para o Calendário da Apple: ${state.syncEnabled ? "ligado" : "desligado"}`}
            describedBy="icloud-sync-desc"
            onCheckedChange={(next) => toggle("syncEnabled", next)}
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <p id="icloud-avail-desc" className="text-sm text-white/65">
            Consultar o Calendário da Apple antes de marcar
          </p>
          <Switch
            checked={state.checkAvailability}
            loading={busySwitch === "availability"}
            label={`Consultar o Calendário da Apple: ${state.checkAvailability ? "ligado" : "desligado"}`}
            describedBy="icloud-avail-desc"
            onCheckedChange={(next) => toggle("checkAvailability", next)}
          />
        </div>
        {state.checkAvailability && (
          <p className="text-xs text-white/45">
            Se o iCloud não responder, o agente não oferece nem confirma horário até a leitura voltar.
          </p>
        )}
      </div>

      <ConfirmButton
        size="sm"
        confirm={{
          title: "Desconectar o Calendário da Apple?",
          description:
            "Os eventos já enviados continuam no seu iPhone; os novos deixam de ser enviados e o agente volta a olhar só a agenda daqui. O Apple ID e a senha de app são apagados do fechai.",
          confirmLabel: "Desconectar",
          tone: "danger",
        }}
        onConfirm={async () => {
          const res = await disconnectFeedback.run(() => disconnectIcloudAction());
          if (res.ok) router.refresh();
        }}
      >
        Desconectar
      </ConfirmButton>
    </div>
  );
}
