"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bot, Power, Unplug, Users } from "lucide-react";
import { FormFeedback } from "@/components/ui/alert";
import { ConfirmButton } from "@/components/ui/confirm-dialog";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  disconnectWhatsapp,
  setWhatsappAgentEnabled,
  setWhatsappAgentReplies,
  setWhatsappIgnoreGroups,
} from "./actions";

type ActionResult = { ok: boolean; error?: string; info?: string };

/**
 * Controles do canal enquanto o número está conectado: pausar/retomar o agente
 * (o mesmo `enabled` da página de agentes), ignorar grupos e desconectar.
 * São três "desligamentos" diferentes e cada um merece seu próprio botão:
 * pausar cala o agente mantendo o WhatsApp, ignorar grupos filtra o que entra,
 * e desconectar derruba o canal inteiro.
 *
 * Com a API oficial liberada a conta tem duas conexões, e as duas metades
 * deste bloco deixam de andar juntas: pausar e ignorar grupos valem para a conta
 * toda (`AttendanceControls`, num cartão só), enquanto desconectar é de UMA
 * conexão (`DisconnectControl`, dentro do cartão dela). Sem a liberação, o
 * `WhatsappControls` abaixo junta as duas como sempre foi.
 */
export function WhatsappControls({
  connected,
  provider = "evolution",
  agentName,
  agentEnabled,
  ignoreGroups,
}: {
  /** true quando o número está conectado (desconectar só faz sentido aí). */
  connected: boolean;
  provider?: "evolution" | "meta";
  agentName: string;
  agentEnabled: boolean;
  ignoreGroups: boolean;
}) {
  return (
    <div className="space-y-4 border-t border-white/10 pt-6">
      <AttendanceControls
        agentName={agentName}
        agentEnabled={agentEnabled}
        ignoreGroups={ignoreGroups}
        showGroups={provider === "evolution"}
      />
      {connected && (
        <DisconnectControl provider={provider} className="border-t border-white/10 pt-4" />
      )}
    </div>
  );
}

/** Estado de uma ação de servidor com a mensagem que ela devolve. */
function useControlAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  function run(action: () => Promise<ActionResult>, onSuccess?: (res: ActionResult) => void) {
    setError(null);
    setInfo(null);
    start(async () => {
      const res = await action();
      if (res.ok) {
        setInfo(res.info ?? "Pronto.");
        onSuccess?.(res);
      } else {
        setError(res.error ?? "Não foi possível completar a ação.");
      }
      router.refresh();
    });
  }

  return { router, pending, error, info, setError, setInfo, run };
}

/**
 * "Atendimento": pausar/retomar o agente e ignorar grupos. Valem para a conta
 * inteira — `Agent.enabled` e `Tenant.whatsappIgnoreGroups` não são de um número —,
 * então com as duas conexões este bloco fala de todos eles.
 */
export function AttendanceControls({
  agentName,
  agentEnabled,
  ignoreGroups,
  showGroups = true,
  allNumbers = false,
  as: Heading = "h2",
}: {
  agentName: string;
  agentEnabled: boolean;
  ignoreGroups: boolean;
  /** Ignorar grupos só existe no número conectado por QR code. */
  showGroups?: boolean;
  /** A conta tem as duas conexões: o texto fala de "todos os números conectados". */
  allNumbers?: boolean;
  /** Nível do título, para caber na hierarquia de quem o hospeda. */
  as?: "h2" | "h3";
}) {
  const [enabled, setEnabled] = useState(agentEnabled);
  const [ignore, setIgnore] = useState(ignoreGroups);
  const { pending, error, info, run } = useControlAction();
  const where = allNumbers ? "em todos os números conectados" : "neste número";

  return (
    <div className="space-y-4">
      <Heading className="font-display text-base font-semibold text-white">Atendimento</Heading>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden
            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
              enabled ? "bg-success/20 text-success" : "bg-danger/20 text-danger"
            }`}
          >
            <Power size={18} />
          </span>
          <div className="min-w-0">
            <p className="font-medium text-white">
              {enabled ? `${agentName} está respondendo` : `${agentName} está em silêncio`}
            </p>
            <p id="whatsapp-pause-desc" className="mt-0.5 max-w-prose text-sm text-white/65">
              {enabled
                ? `Pausar faz o agente parar de responder ${where} sem desconectar o WhatsApp. As mensagens continuam chegando em Conversas.`
                : `Retome para o agente voltar a responder ${where}.`}
            </p>
          </div>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(next) =>
            run(() => setWhatsappAgentEnabled(next), () => setEnabled(next))
          }
          loading={pending}
          disabled={pending}
          label={`Agente ${enabled ? "ligado" : "desligado"}`}
          describedBy="whatsapp-pause-desc"
        />
      </div>

      {showGroups && (
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span
              aria-hidden
              className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-iris/15 text-iris"
            >
              <Users size={18} />
            </span>
            <div className="min-w-0">
              <p className="font-medium text-white">
                {ignore ? "Ignorar mensagens de grupos" : "Responder em grupos"}
              </p>
              <p id="whatsapp-groups-desc" className="mt-0.5 max-w-prose text-sm text-white/65">
                {ignore
                  ? "Mensagens de grupos não são respondidas nem entram em Conversas. Desligue para o agente atender também nos grupos."
                  : "O agente responde também em grupos. Ligue para ele ignorar mensagens de grupo."}
              </p>
            </div>
          </div>
          <Switch
            checked={ignore}
            onCheckedChange={(next) =>
              run(() => setWhatsappIgnoreGroups(next), () => setIgnore(next))
            }
            loading={pending}
            disabled={pending}
            label={`Ignorar grupos ${ignore ? "ligado" : "desligado"}`}
            describedBy="whatsapp-groups-desc"
          />
        </div>
      )}

      <FormFeedback error={error} info={info} />
    </div>
  );
}

/**
 * O agente responde por ESTA conexão? Desligado, o número só recebe: quem
 * escreve entra em Conversas para a equipe, sem resposta nem follow-up
 * automático. É o que deixa a Meta só para Disparos enquanto o QR atende.
 */
export function AgentRepliesControl({
  provider,
  agentReplies,
  className,
}: {
  provider: "evolution" | "meta";
  agentReplies: boolean;
  className?: string;
}) {
  const [on, setOn] = useState(agentReplies);
  const { pending, error, info, run } = useControlAction();
  const descId = `whatsapp-replies-desc-${provider}`;

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden
            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
              on ? "bg-success/20 text-success" : "bg-white/10 text-white/60"
            }`}
          >
            <Bot size={18} />
          </span>
          <div className="min-w-0">
            <p className="font-medium text-white">
              {on ? "O agente responde por este número" : "Este número só faz disparos"}
            </p>
            <p id={descId} className="mt-0.5 max-w-prose text-sm text-white/65">
              {on
                ? "Desligue para usar este número só nos Disparos. Quem responder entra em Conversas para a equipe, sem resposta automática."
                : "Quem escreve para este número entra em Conversas e é respondido pela equipe. O agente segue respondendo nos outros números."}
            </p>
          </div>
        </div>
        <Switch
          checked={on}
          onCheckedChange={(next) =>
            run(() => setWhatsappAgentReplies(provider, next), () => setOn(next))
          }
          loading={pending}
          disabled={pending}
          label={`Agente neste número ${on ? "ligado" : "desligado"}`}
          describedBy={descId}
        />
      </div>

      <FormFeedback error={error} info={info} />
    </div>
  );
}

/**
 * Desconectar UMA das conexões. A outra segue atendendo, e o texto diz qual
 * está saindo — com dois números, "desconectar o número" seria ambíguo.
 */
export function DisconnectControl({
  provider,
  className,
}: {
  provider: "evolution" | "meta";
  className?: string;
}) {
  const { pending, error, info, setError, setInfo, router } = useControlAction();
  const meta = provider === "meta";

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden
            className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-danger/15 text-danger"
          >
            <Unplug size={18} />
          </span>
          <div className="min-w-0">
            <p className="font-medium text-white">Desconectar número</p>
            <p id={`whatsapp-disconnect-desc-${provider}`} className="mt-0.5 max-w-prose text-sm text-white/65">
              {meta
                ? "O fechai para de enviar e processar mensagens deste número. As credenciais ficam salvas para uma reconexão rápida."
                : "O WhatsApp sai do ar e para de receber mensagens. Para voltar, conecte o número de novo com um novo código."}
            </p>
          </div>
        </div>
        <ConfirmButton
          variant="destructive"
          confirm={{
            title: "Desconectar o número?",
            description: meta
              ? "O fechai deixa de processar este número. O cadastro do telefone na Meta não será removido."
              : "O WhatsApp sai do ar e para de receber mensagens. O agente volta a atender quando você conectar o número de novo.",
            confirmLabel: "Desconectar",
            tone: "danger",
          }}
          onConfirm={async () => {
            const res = await disconnectWhatsapp(provider);
            if (res.ok) {
              setError(null);
              setInfo(res.info ?? "WhatsApp desconectado.");
            } else {
              setError(res.error ?? "Não foi possível desconectar.");
            }
            router.refresh();
          }}
          disabled={pending}
        >
          Desconectar
        </ConfirmButton>
      </div>

      <FormFeedback error={error} info={info} />
    </div>
  );
}
