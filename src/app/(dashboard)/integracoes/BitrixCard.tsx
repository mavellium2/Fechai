"use client";

import { useActionState, useEffect, useId, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ContactRound, ExternalLink, RefreshCw } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, fieldProps } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { UnsavedForm } from "@/components/ui/unsaved-changes";
import { useActionToast } from "@/components/ui/toast/use-save-feedback";
import type { getBitrixStatus } from "@/modules/bitrix/integration";
import { manageBitrixAction, saveBitrixAction } from "./bitrix-actions";

type State = Awaited<ReturnType<typeof getBitrixStatus>>;

function statusOf(state: State): { label: string; tone: "success" | "warn" | "neutral" } {
  if (!state?.connected) return { label: "Não conectado", tone: "neutral" };
  return state.enabled ? { label: "Sincronizando", tone: "success" } : { label: "Pausado", tone: "warn" };
}

/**
 * Conexão com o Bitrix24 (aba CRM de /integracoes). Envio de mão única: o
 * Fechai manda contatos, leads e agendamentos; nada volta do Bitrix24.
 */
export function BitrixCard({ state, available }: { state: State; available: boolean }) {
  const status = statusOf(state);
  return (
    <div className="grid w-full gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <Card className="min-w-0 space-y-6">
        <header className="flex flex-wrap items-start gap-4">
          <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-control bg-iris/15 text-iris">
            <ContactRound size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-lg font-semibold text-white">Bitrix24</h2>
              <Badge tone={status.tone}>{status.label}</Badge>
            </div>
            <p className="mt-1 text-sm text-white/60">
              {state?.portalHost
                ? <>Portal <span className="font-mono text-white/80">{state.portalHost}</span></>
                : "Envie os contatos, leads e agendamentos do Fechai para o CRM e o calendário do seu portal."}
            </p>
          </div>
        </header>

        {!available && <Alert tone="warn">A conexão ainda não está disponível nesta instalação. Avise o suporte.</Alert>}
        {state && <SyncStatus state={state} />}
        {available && <BitrixForm state={state} />}
      </Card>

      <aside className="space-y-4">
        <Card className="space-y-3">
          <h3 className="font-display text-base font-semibold text-white">Como funciona</h3>
          <ul className="space-y-3 text-sm text-white/65">
            <HowItem>Cada conta conecta o próprio portal. Contatos são identificados pelo telefone.</HowItem>
            <HowItem>Ao conectar, enviamos os contatos existentes e as próximas consultas. Depois, tudo segue sozinho.</HowItem>
            <HowItem>Agendamentos viram reuniões no CRM e no calendário do responsável. Cancelados ficam marcados como cancelados.</HowItem>
            <HowItem>O envio é de mão única: o que muda no Bitrix24 não volta para o Fechai. A disponibilidade continua vindo da agenda do Fechai e do Clinicorp.</HowItem>
          </ul>
        </Card>
      </aside>
    </div>
  );
}

function HowItem({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-2">
      <ArrowRight aria-hidden size={14} className="mt-1 shrink-0 text-iris" />
      <span>{children}</span>
    </li>
  );
}

function Stat({ value, label, tone }: { value: number; label: string; tone?: "warn" }) {
  return (
    <div className="rounded-control border border-white/10 bg-white/[0.03] px-4 py-3">
      <p className={`font-display text-2xl font-semibold tabular-nums ${tone === "warn" && value > 0 ? "text-warn" : "text-white"}`}>{value}</p>
      <p className="mt-0.5 text-xs text-white/55">{label}</p>
    </div>
  );
}

function SyncStatus({ state }: { state: NonNullable<State> }) {
  const router = useRouter();
  const [refreshing, refresh] = useTransition();
  const [result, action, pending] = useActionState(manageBitrixAction, null);
  useActionToast(result, pending, { entity: "conexão Bitrix24", gender: "f" });
  useEffect(() => { if (result?.ok) router.refresh(); }, [result, router]);
  const waiting = (state.counts.queued ?? 0) + (state.counts.processing ?? 0);
  const retry = state.counts.retry ?? 0;

  return (
    <section aria-label="Situação da sincronização" className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat value={state.counts.synced ?? 0} label="registros sincronizados" />
        <Stat value={waiting} label="aguardando envio" />
        <Stat value={retry} label="em conferência" tone="warn" />
      </div>

      {((state.counts.skipped ?? 0) > 0 || state.crmMode === 2) && (
        <div className="space-y-1 text-sm text-white/55">
          {(state.counts.skipped ?? 0) > 0 && <p>
            {state.counts.skipped} registros não foram enviados: excluídos, testes, consultas sem contato ou canceladas antes do primeiro envio.
          </p>}
          {state.crmMode === 2 && <p>Este portal usa o CRM simples: os leads vão como negócios vinculados ao contato.</p>}
        </div>
      )}
      {state.errors.map((error) => <Alert tone="warn" key={error}>{error}</Alert>)}

      <form action={action} className="flex flex-wrap items-center gap-2">
        {state.connected && <>
          <Button size="sm" variant="outline" name="operation" value="test" loading={pending}>Testar conexão</Button>
          <Button size="sm" variant="outline" name="operation" value={state.enabled ? "pause" : "resume"} disabled={pending}>
            {state.enabled ? "Pausar envio" : "Retomar envio"}
          </Button>
          {retry > 0 && <Button size="sm" variant="outline" name="operation" value="retry" disabled={pending}>Conferir envios</Button>}
        </>}
        <Button type="button" size="sm" variant="ghost" loading={refreshing} onClick={() => refresh(() => router.refresh())}>
          <RefreshCw size={14} aria-hidden /> Atualizar
        </Button>
        {state.connected && (
          <Button size="sm" variant="destructive" name="operation" value="disconnect" disabled={pending} className="sm:ml-auto">Desconectar</Button>
        )}
      </form>

      {state.connected && state.enabled && state.uncertain.length > 0 && (
        <details className="rounded-control border border-warn/30 bg-warn/5 p-4">
          <summary className="cursor-pointer text-sm font-medium text-white/85">
            {state.uncertain.length} {state.uncertain.length === 1 ? "envio sem confirmação" : "envios sem confirmação"} para resolver
          </summary>
          <p className="mt-3 text-sm text-white/60">
            Um envio pode ter chegado ao Bitrix24 mesmo sem resposta. Confira o portal: se o registro já existir, o botão procura a referência e retoma; se não existir, marque a confirmação.
          </p>
          <div className="mt-3 space-y-3">
            {state.uncertain.map((job) => <UncertainJob key={job.id} job={job} />)}
          </div>
        </details>
      )}
    </section>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3">
      <span aria-hidden className="flex size-7 items-center justify-center rounded-full bg-white/10 font-mono text-xs text-white/80">{n}</span>
      <div className="min-w-0 space-y-3">
        <h3 className="pt-0.5 text-sm font-semibold text-white">{title}</h3>
        {children}
      </div>
    </section>
  );
}

function SyncToggle({ name, label, description, defaultChecked, locked }: {
  name?: string; label: string; description: string; defaultChecked: boolean; locked?: boolean;
}) {
  const [checked, setChecked] = useState(defaultChecked);
  const descId = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-white/85">{label}</p>
        <p id={descId} className="text-sm text-white/55">{description}</p>
      </div>
      <Switch checked={locked || checked} onCheckedChange={setChecked} disabled={locked} label={label} describedBy={descId} />
      {name && checked && !locked && <input type="hidden" name={name} value="on" />}
    </div>
  );
}

function BitrixForm({ state }: { state: State }) {
  const router = useRouter();
  const id = useId();
  const [result, action, pending] = useActionState(saveBitrixAction, null);
  useActionToast(result, pending, { entity: "conexão Bitrix24", gender: "f" });
  useEffect(() => { if (result?.ok) router.refresh(); }, [result, router]);
  const connected = Boolean(state?.connected);

  return (
    <UnsavedForm action={action} result={result} label="Conexão Bitrix24" resetOnSuccess
      className="space-y-6 border-t border-white/10 pt-6">
      <h3 className="font-display text-base font-semibold text-white">{connected ? "Configuração" : "Conectar em 3 passos"}</h3>

      <Step n={1} title="Crie um webhook de entrada no Bitrix24">
        <details open={!connected} className="group text-sm text-white/65">
          <summary className="cursor-pointer text-white/75 marker:text-white/40">Ver o passo a passo</summary>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5">
            <li>Abra <span className="text-white/85">Aplicativos → Recursos do desenvolvedor → Outros → Webhook de entrada</span>.</li>
            <li>Autorize o CRM e use um usuário que possa ler todos os contatos e cadastrar contatos, leads e reuniões.</li>
            <li>Copie a URL completa, no formato <span className="font-mono text-xs text-white/80">https://suaempresa.bitrix24.com.br/rest/1/codigo/</span>.</li>
          </ol>
          <p className="mt-2 text-white/50">Seu plano do Bitrix24 precisa permitir o uso da API.</p>
          <a className="mt-2 inline-flex items-center gap-1 text-white/75 underline underline-offset-4 hover:text-white"
            href="https://apidocs.bitrix24.com/local-integrations/local-webhooks.html" target="_blank" rel="noopener noreferrer">
            Instruções oficiais <ExternalLink size={12} aria-hidden />
          </a>
        </details>
      </Step>

      <Step n={2} title="Cole a URL do webhook">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_12rem]">
          <Field label="URL do webhook" htmlFor={`${id}-webhook`}
            hint={connected ? "Em branco mantém a credencial atual. Cole outra URL para renovar." : "Guardada com criptografia."}>
            <Input {...fieldProps(`${id}-webhook`, { hint: true })} name="webhook" type="password" autoComplete="new-password"
              maxLength={512} required={!connected} placeholder={connected ? "••••••••••••" : "https://…/rest/1/…/"} />
          </Field>
          <Field label="ID do responsável" htmlFor={`${id}-responsible`} optional hint="Vazio: quem criou o webhook.">
            <Input {...fieldProps(`${id}-responsible`, { hint: true })} name="responsibleId" inputMode="numeric" maxLength={15}
              defaultValue={state?.responsibleId ?? ""} placeholder="Ex.: 1" />
          </Field>
        </div>
      </Step>

      <Step n={3} title="Escolha o que enviar">
        <div className="divide-y divide-white/10 rounded-control border border-white/10 px-4">
          <SyncToggle label="Contatos" description="Sempre enviados enquanto a conexão está ativa." defaultChecked locked />
          <SyncToggle name="syncLeads" label="Leads" description="No CRM simples, vão como negócios vinculados ao contato."
            defaultChecked={state?.syncLeads ?? true} />
          <SyncToggle name="syncAppointments" label="Agendamentos" description="Viram reuniões no calendário do responsável."
            defaultChecked={state?.syncAppointments ?? true} />
        </div>
      </Step>

      <div className="flex justify-end">
        <Button type="submit" loading={pending}>{connected ? "Salvar e ativar" : "Conectar Bitrix24"}</Button>
      </div>
    </UnsavedForm>
  );
}

function UncertainJob({ job }: { job: { id: string; label: string } }) {
  const router = useRouter();
  const [result, action, pending] = useActionState(manageBitrixAction, null);
  useActionToast(result, pending, { entity: "envio Bitrix24" });
  useEffect(() => { if (result?.ok) router.refresh(); }, [result, router]);
  return <form action={action} className="space-y-2 rounded-control border border-white/10 bg-ink/40 p-3">
    <input type="hidden" name="operation" value="resolve" />
    <input type="hidden" name="jobId" value={job.id} />
    <p className="text-sm text-white/80">{job.label}</p>
    <label className="flex items-start gap-2 text-sm text-white/60">
      <input type="checkbox" name="confirmedMissing" className="mt-1 accent-iris" />
      Conferi o Bitrix24 e este registro não existe lá. Permitir nova tentativa.
    </label>
    <Button size="sm" variant="outline" loading={pending}>Conferir e retomar este envio</Button>
  </form>;
}
