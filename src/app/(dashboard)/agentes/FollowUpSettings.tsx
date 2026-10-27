"use client";

import { useActionState, useId, useMemo, useState } from "react";
import { useActionToast } from "@/components/ui/toast";
import { Trash2 } from "lucide-react";
import {
  FOLLOWUP_UNITS,
  MAX_FOLLOWUP_DELAY_MINUTES,
  MAX_FOLLOWUP_MESSAGE_LENGTH,
  MAX_FOLLOWUP_STEPS,
  cumulativeDelays,
  formatDelay,
  splitFollowUpDelay,
  type FollowUpConfig,
  type FollowUpSequence,
  type FollowUpSequenceKey,
  type FollowUpUnit,
} from "@/modules/follow-up/config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { saveFollowUpConfigAction } from "./actions";
import { UnsavedForm } from "@/components/ui/unsaved-changes";
import { SaveBar } from "./SaveBar";

/**
 * As esteiras da ação "Follow-up automático" e a janela de envio.
 *
 * Fica embaixo do próprio toggle, como o horário de atendimento do
 * agendamento: "o que ele manda, e quando?" só faz sentido para quem acabou de
 * ligar o follow-up.
 *
 * São duas esteiras porque "sumiu" e "disse que não" pedem conversas
 * diferentes (ver `modules/follow-up/config.ts`). Cada espera é guardada em
 * minutos, mas digitada na unidade que faz sentido — "3 dias" em vez de
 * "4320" — e a conversão acontece só no envio, num campo JSON oculto.
 */

type StepDraft = { amount: number; unit: FollowUpUnit; message: string; ai: boolean };
type SequenceDraft = { enabled: boolean; steps: StepDraft[] };

const UNIT_OPTIONS = FOLLOWUP_UNITS.map((u) => ({ value: u.value, label: u.label }));
const START_HOURS = Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: `${h}h` }));
const END_HOURS = Array.from({ length: 24 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}h` }));

const SEQUENCES: Array<{ key: FollowUpSequenceKey; title: string; hint: string }> = [
  {
    key: "noReply",
    title: "Quando o contato para de responder",
    hint: "Começa cedo: quem some no meio da conversa costuma só ter se distraído.",
  },
  {
    key: "declined",
    title: "Quando o contato diz que não quer agendar agora",
    hint: "O agente reconhece frases como “vou pensar” ou “agora não dá”. Aqui o espaço é de dias, para não soar como cobrança. Quem pede para não receber mais mensagens não recebe nenhuma.",
  },
];

function unitMinutes(unit: FollowUpUnit): number {
  return FOLLOWUP_UNITS.find((u) => u.value === unit)?.minutes ?? 1;
}

function stepMinutes(d: StepDraft): number {
  return Math.round((Number.isFinite(d.amount) ? d.amount : 0) * unitMinutes(d.unit));
}

function toDraft(seq: FollowUpSequence): SequenceDraft {
  return {
    enabled: seq.enabled,
    steps: seq.steps.map((s) => ({ ...splitFollowUpDelay(s.delayMinutes), message: s.message, ai: s.ai })),
  };
}

function fromDraft(seq: SequenceDraft): FollowUpSequence {
  return {
    enabled: seq.enabled,
    steps: seq.steps.map((d) => ({ delayMinutes: stepMinutes(d), message: d.message, ai: d.ai })),
  };
}

export function FollowUpSettings({ agentId, config }: { agentId: string; config: FollowUpConfig }) {
  const [saved, setSaved] = useState(() => JSON.stringify({ noReply: fromDraft(toDraft(config.noReply)), declined: fromDraft(toDraft(config.declined)), window: config.window }));
  const [activeSequence, setActiveSequence] = useState<FollowUpSequenceKey>("noReply");
  const [state, formAction, pending] = useActionState(async (prev: Awaited<ReturnType<typeof saveFollowUpConfigAction>> | null, data: FormData) => {
    const snapshot = String(data.get("config"));
    const result = await saveFollowUpConfigAction(prev, data);
    if (result.ok) setSaved(snapshot);
    return result;
  }, null);
  useActionToast(state, pending, { entity: "follow-up" });
  const baseId = useId();

  const [sequences, setSequences] = useState<Record<FollowUpSequenceKey, SequenceDraft>>(() => ({
    noReply: toDraft(config.noReply),
    declined: toDraft(config.declined),
  }));
  const [sendWindow, setSendWindow] = useState(config.window);

  const value: FollowUpConfig = useMemo(() => ({
    noReply: fromDraft(sequences.noReply),
    declined: fromDraft(sequences.declined),
    window: sendWindow,
  }), [sequences, sendWindow]);

  function updateSequence(key: FollowUpSequenceKey, patch: Partial<SequenceDraft>) {
    setSequences((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  function updateStep(key: FollowUpSequenceKey, index: number, patch: Partial<StepDraft>) {
    setSequences((prev) => ({
      ...prev,
      [key]: { ...prev[key], steps: prev[key].steps.map((s, i) => (i === index ? { ...s, ...patch } : s)) },
    }));
  }

  function changeUnit(key: FollowUpSequenceKey, index: number, next: FollowUpUnit) {
    const current = sequences[key].steps[index];
    if (!current || current.unit === next) return;
    // Converte o número já digitado em vez de zerar: trocar "dias" por "horas"
    // com 1 no campo vira 24. Mínimo de 1 para "30 minutos" não virar "0 dia".
    const amount = Math.max(1, Math.round(stepMinutes(current) / unitMinutes(next)));
    updateStep(key, index, { unit: next, amount });
  }

  function addStep(key: FollowUpSequenceKey) {
    const steps = sequences[key].steps;
    if (steps.length >= MAX_FOLLOWUP_STEPS) return;
    updateSequence(key, { steps: [...steps, { amount: 1, unit: "days", message: "", ai: false }] });
  }

  function removeStep(key: FollowUpSequenceKey, index: number) {
    updateSequence(key, { steps: sequences[key].steps.filter((_, i) => i !== index) });
  }

  const windowInvalid = sendWindow.startHour >= sendWindow.endHour;

  return (
    <UnsavedForm action={formAction} result={state} label="Follow-up" className="space-y-6 border-t border-white/10 pt-5">
      <input type="hidden" name="agentId" value={agentId} />
      <input type="hidden" name="config" value={JSON.stringify(value)} />


      <fieldset className="min-w-0">
        <legend className="text-sm font-medium text-ink panel:text-white/85">Horário de envio</legend>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-neutral panel:text-white/60">
          <span>Das</span>
          <SelectMenu
            label="Início do horário de envio"
            value={String(sendWindow.startHour)}
            onChange={(v) => setSendWindow((w) => ({ ...w, startHour: Number(v) }))}
            options={START_HOURS}
            className="w-24"
          />
          <span>às</span>
          <SelectMenu
            label="Fim do horário de envio"
            value={String(sendWindow.endHour)}
            onChange={(v) => setSendWindow((w) => ({ ...w, endHour: Number(v) }))}
            options={END_HOURS}
            className="w-24"
          />
        </div>
        <p className={`mt-1.5 text-sm ${windowInvalid ? "text-danger" : "text-neutral panel:text-white/45"}`}>
          {windowInvalid
            ? "O horário de envio precisa terminar depois de começar."
            : "No fuso da agenda do agente. Fora desse horário, a mensagem espera a janela abrir."}
        </p>
      </fieldset>

      <div className="agent-sequence-tabs" aria-label="Sequência de follow-up">{SEQUENCES.map(({key}) => <button type="button" key={key} aria-pressed={activeSequence === key} onClick={() => setActiveSequence(key)}>{key === "noReply" ? "Sem resposta" : "Vai pensar"} · {sequences[key].steps.length}</button>)}</div>
      {SEQUENCES.map(({ key, title, hint }) => {
        const seq = sequences[key];
        const totals = cumulativeDelays(fromDraft(seq).steps);
        const hintId = `${baseId}-${key}-hint`;
        return (
          <fieldset key={key} hidden={activeSequence !== key} className="min-w-0 space-y-3 border-t border-white/10 pt-5">
            <legend className="sr-only">{title}</legend>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-ink panel:text-white/85">{title}</p>
                <p id={hintId} className="mt-1 text-sm text-neutral panel:text-white/55">{hint}</p>
              </div>
              <Switch
                checked={seq.enabled}
                onCheckedChange={(enabled) => updateSequence(key, { enabled })}
                label={title}
                describedBy={hintId}
              />
            </div>

            {/* Escondido, não desmontado: desligar a esteira é pausar, não
                apagar as mensagens que a pessoa escreveu (mesma regra dos
                lembretes e do grupo do handoff). */}
            <div className={seq.enabled ? "space-y-3" : "hidden"}>
              {seq.steps.length === 0 && (
                <p className="text-sm text-neutral panel:text-white/50">
                  Nenhuma mensagem. Adicione a primeira ou desligue esta esteira.
                </p>
              )}

              <ol className="space-y-3">
                {seq.steps.map((step, index) => {
                  const id = `${baseId}-${key}-${index}`;
                  const minutes = stepMinutes(step);
                  return (
                    <li key={index} className="followup-step"><details open={index === 0 || undefined}><summary>{index === 0 ? "Primeira mensagem" : `${index + 1}ª mensagem`} · após {formatDelay(totals[index])}</summary><div className="space-y-3">
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="w-24">
                          <label htmlFor={id} className="text-sm font-medium text-ink panel:text-white/85">
                            Esperar
                          </label>
                          <Input
                            id={id}
                            type="number"
                            min={1}
                            max={Math.floor(MAX_FOLLOWUP_DELAY_MINUTES / unitMinutes(step.unit))}
                            step={1}
                            className="mt-1.5"
                            value={Number.isFinite(step.amount) ? step.amount : ""}
                            onChange={(e) => updateStep(key, index, { amount: e.target.valueAsNumber })}
                            aria-describedby={`${id}-quando`}
                          />
                        </div>
                        <SelectMenu
                          label={`Unidade da espera da mensagem ${index + 1}`}
                          value={step.unit}
                          onChange={(v) => changeUnit(key, index, v as FollowUpUnit)}
                          options={UNIT_OPTIONS}
                          className="w-32"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          aria-label={`Remover mensagem ${index + 1}`}
                          onClick={() => removeStep(key, index)}
                        >
                          <Trash2 size={15} aria-hidden />
                        </Button>
                      </div>
                      {/* O total é o que a pessoa realmente decide ("a 3ª sai
                          no dia seguinte?"); a espera sozinha não diz isso. */}
                      <p id={`${id}-quando`} className="text-sm text-neutral panel:text-white/45">
                        {minutes >= 1
                          ? `${index === 0 ? "depois da última mensagem do agente" : "depois da mensagem anterior"} · sai ${formatDelay(totals[index])} após o silêncio`
                          : "Informe a espera."}
                      </p>

                      <div>
                        <label htmlFor={`${id}-texto`} className="text-sm font-medium text-ink panel:text-white/85">
                          Mensagem {index + 1}
                        </label>
                        <Textarea
                          id={`${id}-texto`}
                          className="mt-1.5"
                          rows={2}
                          maxLength={MAX_FOLLOWUP_MESSAGE_LENGTH}
                          placeholder="Ex: Oi {{nome}}! Ficou alguma dúvida? Posso ver um horário para você."
                          value={step.message}
                          onChange={(e) => updateStep(key, index, { message: e.target.value })}
                        />
                        {!step.message.trim() && (
                          <p className="mt-1.5 text-sm text-danger">Escreva o texto desta mensagem.</p>
                        )}
                      </div>

                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-sm text-ink panel:text-white/80">A IA adapta à conversa</p>
                          <p id={`${id}-ia`} className="mt-0.5 text-sm text-neutral panel:text-white/45">
                            Usa o texto acima como base e retoma o último assunto do contato. Conta 1
                            mensagem na cota do plano; sem cota, sai o texto como está.
                          </p>
                        </div>
                        <Switch
                          checked={step.ai}
                          onCheckedChange={(ai) => updateStep(key, index, { ai })}
                          label={`A IA adapta a mensagem ${index + 1} à conversa`}
                          describedBy={`${id}-ia`}
                        />
                      </div>
                    </div></details></li>
                  );
                })}
              </ol>

              {seq.steps.length >= MAX_FOLLOWUP_STEPS ? (
                <p className="text-sm text-neutral panel:text-white/50">
                  Máximo de {MAX_FOLLOWUP_STEPS} mensagens por esteira — o contato não respondeu
                  nenhuma das anteriores, e cada uma a mais é mais uma chance de a clínica ser marcada
                  como spam.
                </p>
              ) : (
                <Button type="button" variant="outline" onClick={() => addStep(key)}>
                  Adicionar mensagem
                </Button>
              )}
            </div>
          </fieldset>
        );
      })}

      <p className="text-sm text-neutral panel:text-white/45">
        Use <code className="text-ink panel:text-white/70">{"{{nome}}"}</code> e as outras variáveis
        do agente. Variável sem valor na conversa some da frase.
      </p>


      <SaveBar dirty={JSON.stringify(value) !== saved} pending={pending} />
    </UnsavedForm>
  );
}
