"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bot, Copy, ExternalLink, GraduationCap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SelectMenu } from "@/components/ui/select-menu";
import { useSaveFeedback } from "@/components/ui/toast";
import type { AgentSetup } from "./CampaignDetail";
import { copyAgentForCampaign, mergeCampaignLearning, setCampaignAgent } from "./setup-actions";

const LINK =
  "inline-flex items-center gap-1 rounded-control text-sm font-medium text-iris underline-offset-4 hover:underline " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris";

/**
 * Quem atende os leads da campanha. O caminho recomendado é a cópia: um agente
 * igual ao de sempre, que você ajusta para a campanha sem mexer no original.
 * Usar um agente existente "como está" também vale. Sem escolha, cada lead
 * segue com o agente que já atende a conversa.
 */
export function CampaignAgentPanel({ campaignId, editable, setup }: { campaignId: string; editable: boolean; setup: AgentSetup }) {
  const router = useRouter();
  const save = useSaveFeedback({ entity: "agente", action: "update", gender: "m" });
  const [busy, setBusy] = useState<string | null>(null);
  const current = setup.agents.find((a) => a.id === setup.agentId) ?? null;
  const base = setup.agents.find((a) => a.id === setup.baseAgentId) ?? null;
  const primary = setup.agents.find((a) => a.isPrimary) ?? setup.agents[0] ?? null;
  const [choice, setChoice] = useState(base?.id ?? current?.id ?? primary?.id ?? "");
  const labelId = useId();

  async function run(key: string, task: () => ReturnType<typeof setCampaignAgent>) {
    setBusy(key);
    try {
      const result = await save.run(task);
      if (result.ok) router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const chosen = setup.agents.find((a) => a.id === choice);
  const options = setup.agents.map((a) => ({
    value: a.id,
    label: `${a.name}${a.isPrimary ? " (principal)" : ""}${a.enabled ? "" : " (desligado)"}`,
  }));

  return (
    <section className="space-y-4" aria-labelledby={`${labelId}-titulo`}>
      <h3 id={`${labelId}-titulo`} className="font-display text-base font-semibold text-ink panel:text-white">
        Agente desta campanha
      </h3>

      <div className="rounded-control border border-ink/10 p-4 panel:border-white/15">
        {current ? (
          <div className="space-y-2">
            <p className="flex flex-wrap items-center gap-2 text-sm text-ink panel:text-white/90">
              <Bot size={16} aria-hidden />
              <strong className="font-medium">{current.name}</strong>
              {base && <Badge tone="iris">cópia de {base.name}</Badge>}
              {!current.enabled && <Badge tone="warn">desligado</Badge>}
            </p>
            <p className="text-sm text-neutral panel:text-white/60">
              Atende os leads da campanha enquanto ela estiver ativa. Depois do fim, eles voltam ao agente de sempre.
              {base ? ` A ${base.name} não muda.` : ""}
            </p>
            <div className="flex flex-wrap gap-4">
              <Link href={`/agentes/${current.id}`} className={LINK}>
                Ajustar jeito de falar e base
                <ExternalLink size={16} aria-hidden />
              </Link>
              <Link href="/conversas" className={LINK}>
                Testar no chat de teste
                <ExternalLink size={16} aria-hidden />
              </Link>
            </div>
          </div>
        ) : (
          <p className="text-sm text-ink panel:text-white/90">
            Hoje cada lead da campanha é atendido pelo agente que já atende a conversa dele, com as regras da campanha por cima.
          </p>
        )}
      </div>

      {editable && setup.agents.length > 0 && (
        <div className="space-y-3">
          <p id={labelId} className="text-sm font-medium text-ink panel:text-white/90">
            {current ? "Trocar o agente" : "Escolher um agente para a campanha"}
          </p>
          <SelectMenu label="Agente" labelledBy={labelId} value={choice} onChange={setChoice} options={options} className="w-full sm:w-auto" />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="max-sm:h-11"
              disabled={!chosen || save.saving}
              loading={busy === "copy"}
              loadingLabel="Criando a cópia"
              onClick={() => void run("copy", () => copyAgentForCampaign(campaignId, choice))}
            >
              <Copy size={16} aria-hidden />
              Criar cópia para a campanha
            </Button>
            <Button
              type="button"
              variant="outline"
              className="max-sm:h-11"
              disabled={!chosen || chosen.id === current?.id || save.saving}
              loading={busy === "use"}
              loadingLabel="Salvando"
              onClick={() => void run("use", () => setCampaignAgent(campaignId, choice))}
            >
              Usar {chosen ? chosen.name : "este agente"} como está
            </Button>
            {current && (
              <Button
                type="button"
                variant="ghost"
                className="max-sm:h-11"
                disabled={save.saving}
                loading={busy === "reset"}
                loadingLabel="Salvando"
                onClick={() => void run("reset", () => setCampaignAgent(campaignId, null))}
              >
                Voltar ao agente de sempre
              </Button>
            )}
          </div>
          <p className="text-sm text-neutral panel:text-white/60">
            Recomendado: a cópia. Ela começa igual ao agente escolhido, e você muda o que quiser só para a campanha.
          </p>
        </div>
      )}

      {base && current && <LearningBlock campaignId={campaignId} baseName={base.name} learned={setup.learned} editable={editable} />}
    </section>
  );
}

/** O que a cópia aprendeu e ainda não foi levado para o agente original. */
function LearningBlock({
  campaignId,
  baseName,
  learned,
  editable,
}: {
  campaignId: string;
  baseName: string;
  learned: AgentSetup["learned"];
  editable: boolean;
}) {
  const router = useRouter();
  const save = useSaveFeedback({ entity: "aprendizado", action: "save", gender: "m" });
  const pending = learned.filter((d) => !d.merged);
  const [picked, setPicked] = useState<string[]>([]);

  return (
    <div className="space-y-3 rounded-control border border-ink/10 p-4 panel:border-white/15">
      <h4 className="flex items-center gap-2 font-display text-base font-semibold text-ink panel:text-white">
        <GraduationCap size={16} aria-hidden />
        Levar para {baseName}
      </h4>
      <p className="text-sm text-neutral panel:text-white/60">
        O que entrou na base da cópia depois que ela foi criada (documentos e perguntas respondidas). Marque só o que vale fora da
        campanha — data e oferta do evento não devem ir.
      </p>
      {learned.length === 0 ? (
        <p className="text-sm text-ink panel:text-white/90">A cópia ainda não aprendeu nada novo.</p>
      ) : (
        <ul className="space-y-2">
          {learned.map((doc) => (
            <li key={doc.id}>
              <label className="flex min-h-11 items-start gap-3 text-sm text-ink panel:text-white/90 sm:min-h-0">
                <input
                  type="checkbox"
                  className="mt-1 size-4 accent-iris"
                  disabled={doc.merged || !editable}
                  checked={doc.merged || picked.includes(doc.id)}
                  onChange={(e) => setPicked((list) => (e.target.checked ? [...list, doc.id] : list.filter((id) => id !== doc.id)))}
                />
                <span>
                  {doc.title}
                  <span className="block text-neutral panel:text-white/60">
                    {doc.createdAt}
                    {doc.merged ? ` · já está na ${baseName}` : ""}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {editable && pending.length > 0 && (
        <Button
          type="button"
          size="sm"
          className="max-sm:h-11"
          disabled={!picked.length || save.saving}
          loading={save.saving}
          loadingLabel="Levando"
          onClick={async () => {
            const result = await save.run(() => mergeCampaignLearning(campaignId, picked));
            if (result.ok) {
              setPicked([]);
              router.refresh();
            }
          }}
        >
          Levar {picked.length || ""} para {baseName}
        </Button>
      )}
    </div>
  );
}
