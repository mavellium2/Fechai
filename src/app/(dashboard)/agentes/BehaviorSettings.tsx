"use client";

import { useState, useTransition } from "react";
import { AudioLines, Mic, StopCircle } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { setAgentBehavior } from "./actions";
import { VoiceRecorder } from "./VoiceRecorder";
import { SpeechBlocklistForm } from "./SpeechBlocklistForm";
import { VoiceStyleSelect } from "./VoiceStyleSelect";
import { VoicePromptForm } from "./VoicePromptForm";

type BehaviorKey = "listenAudio" | "speakReplies" | "stopOnEmoji";

const OPTIONS: {
  key: BehaviorKey;
  icon: typeof Mic;
  title: string;
  description: string;
}[] = [
  {
    key: "listenAudio",
    icon: Mic,
    title: "Ouvir mensagens de voz",
    description:
      "Quando um cliente mandar um áudio, o agente transcreve o que foi dito e responde como se fosse texto. Desligue para o agente ignorar áudios.",
  },
  {
    key: "speakReplies",
    icon: AudioLines,
    title: "Responder com áudio",
    description:
      "Quando o cliente mandar um áudio, o agente responde falando. Para quem escreve, ele continua respondendo por escrito. Escolha a voz aqui em cima — uma pronta ou a sua.",
  },
  {
    key: "stopOnEmoji",
    icon: StopCircle,
    title: "Assumir conversa com reação",
    description:
      "Quando você ou outro atendente reagir com um emoji pelo WhatsApp da empresa, o agente para de responder naquela conversa e ela sobe como “precisa de você”. Reações do cliente não pausam o agente.",
  },
];

/** Os comportamentos de conversa do agente (passo "Comportamento"). */
export function BehaviorSettings({
  focused,
  agentId,
  listenAudio,
  speakReplies,
  stopOnEmoji,
  voice,
  catalogKey = null,
  voiceAvailable,
  speechBlocklist = "",
  voiceStyle = "",
  voicePrompt = "",
}: {
  focused?: BehaviorKey;
  agentId: string;
  listenAudio: boolean;
  speakReplies: boolean;
  stopOnEmoji: boolean;
  /** Termos que o agente não pronuncia, um por linha (ver SpeechBlocklistForm). */
  speechBlocklist?: string;
  /** Como a voz se comporta (`Agent.voiceStyle`, ver VoiceStyleSelect). */
  voiceStyle?: string;
  voicePrompt?: string;
  /** Voz já clonada na Fish Audio, se houver. */
  voice: { label: string | null; createdAt: Date | null; source: string | null } | null;
  /** Chave da voz pronta em uso, quando a voz vem do catálogo. */
  catalogKey?: string | null;
  /** A instalação tem chave da Fish Audio configurada? */
  voiceAvailable: boolean;
}) {
  const [values, setValues] = useState<Record<BehaviorKey, boolean>>({
    listenAudio,
    speakReplies,
    stopOnEmoji,
  });
  // Só a opção que está salvando trava/mostra loading — as outras continuam
  // clicáveis (mesmo padrão do ActionsToggles).
  const [busyKey, setBusyKey] = useState<BehaviorKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  /**
   * Tem voz gravada? Vive aqui, e não só na prop do servidor, porque gravar
   * destrava o toggle NA HORA — o `revalidatePath` da action repinta a página,
   * mas o estado local evita a janela em que a pessoa grava e o toggle ainda
   * aparece bloqueado.
   */
  const [hasVoice, setHasVoice] = useState(Boolean(voice));

  function toggle(key: BehaviorKey, next: boolean) {
    setError(null);
    setBusyKey(key);
    startTransition(async () => {
      const res = await setAgentBehavior(agentId, key, next);
      if (res.ok) setValues((prev) => ({ ...prev, [key]: next }));
      else setError(res.error ?? "Não foi possível salvar. Tente de novo.");
      setBusyKey(null);
    });
  }

  if (focused && focused !== "speakReplies") {
    const listening = focused === "listenAudio";
    const steps = listening ? [["1. O contato envia um áudio", "A mensagem de voz chega pelo WhatsApp."], ["2. O agente entende o conteúdo", "O áudio é transcrito para dar continuidade ao atendimento."], ["3. A conversa continua", "A resposta considera o conteúdo do áudio e o histórico."]] : [["1. Reaja a uma mensagem", "Um atendente reage pelo WhatsApp conectado."], ["2. O agente pausa naquela conversa", "A conversa é sinalizada para atendimento humano."], ["3. Continue com o contato", "A equipe responde pelo painel ou WhatsApp."]];
    return <div className="agent-behavior-explanation"><h3>{listening ? "Como funciona" : "Como a equipe assume"}</h3>{steps.map(([title, text]) => <div className="agent-info-row" key={title}><h4>{title}</h4><p>{text}</p></div>)}<section className="agent-form-section"><h3>{listening ? "Entrada e resposta" : "Quando o agente deve voltar?"}</h3><p className="agent-help">{listening ? "Com a escuta desligada, mensagens de áudio não recebem resposta automática. Para responder com voz, configure Responder em áudio." : "No painel de conversas, use Reativar agente quando a equipe terminar. A pausa vale apenas para aquela conversa."}</p><div className="agent-example">{listening ? "A transcrição permite compreender a mensagem; a voz de saída é configurada separadamente." : "A reação que pausa o agente é a da equipe, não a do contato."}</div></section><p className="agent-help">O interruptor acima salva a alteração imediatamente.</p></div>;
  }
  return (
    <div className={focused ? "agent-voice-settings space-y-3" : "space-y-3"}>
      {/* Só o erro fica: a descrição dos três comportamentos repetia o título
          do passo, e cada linha abaixo já se explica sozinha. */}
      {error && <Alert tone="danger">{error}</Alert>}

      {/* A voz vem ANTES do toggle que depende dela: gravar é o pré-requisito,
          e um toggle que só recusa até você rolar a tela e gravar inverte a
          ordem real das ações. */}
      <section className="rounded-surface border border-white/10 p-4">
        <h3 className="font-display text-base font-semibold text-white">{focused ? "De onde vem a voz?" : "A voz do agente"}</h3>
        <div className="mt-3">
          <VoiceRecorder
            agentId={agentId}
            voice={voice}
            catalogKey={catalogKey}
            available={voiceAvailable}
            onVoiceChange={(has) => {
              setHasVoice(has);
              // Remover a voz desliga a resposta em áudio no servidor
              // (`deleteAgentVoice`); o toggle acompanha sem esperar recarga.
              if (!has) setValues((prev) => ({ ...prev, speakReplies: false }));
            }}
          />
        </div>
        {/* Sempre visível, mesmo sem voz escolhida. A primeira versão escondia
            até ter voz ("sem voz nada é pronunciado") e o resultado foi quem
            procurava a configuração não achar — o campo some justamente para
            quem ainda está montando o agente. Configuração que existe e não
            aparece é pior que uma linha a mais na tela. */}
        <VoiceStyleSelect agentId={agentId} initial={voiceStyle} />
        {focused ? <><details className="agent-extra"><summary>Instruções para falar</summary><VoicePromptForm agentId={agentId} initial={voicePrompt} /></details><details className="agent-extra"><summary>Termos que não deve pronunciar</summary><SpeechBlocklistForm agentId={agentId} initial={speechBlocklist} /></details></> : <><VoicePromptForm agentId={agentId} initial={voicePrompt} /><SpeechBlocklistForm agentId={agentId} initial={speechBlocklist} /></>}
      </section>

      <ul className={focused ? "hidden" : "space-y-2"}>
        {OPTIONS.map((opt) => {
          const on = values[opt.key];
          const descId = `comportamento-${opt.key}-desc`;
          // "Responder com áudio" sem voz gravada fica desabilitado e explica
          // por quê, em vez de aceitar o clique e recusar depois: a tela diz o
          // que falta antes de a pessoa tentar.
          const blocked = opt.key === "speakReplies" && !hasVoice;
          return (
            <li
              key={opt.key}
              className={`rounded-surface border p-4 transition-colors ${
                on ? "border-iris/50 bg-iris/10" : "border-white/10"
              } ${blocked ? "opacity-60" : ""}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    aria-hidden
                    className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-iris/20 text-white"
                  >
                    <opt.icon size={18} />
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium text-white">{opt.title}</p>
                    <p id={descId} className="mt-0.5 max-w-prose text-sm text-white/60">
                      {opt.description}
                    </p>
                    {blocked && (
                      <p className="mt-1.5 text-sm text-warn">
                        {voiceAvailable
                          ? "Escolha uma voz acima (pronta ou gravada) para poder ligar."
                          : "Indisponível nesta instalação — falta a chave da Fish Audio no servidor."}
                      </p>
                    )}
                  </div>
                </div>
                <Switch
                  checked={on}
                  onCheckedChange={(next) => toggle(opt.key, next)}
                  loading={busyKey === opt.key}
                  disabled={busyKey !== null || blocked}
                  label={`${opt.title}: ${on ? "ligado" : "desligado"}`}
                  describedBy={descId}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
