"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Ellipsis, Pause, Pencil, Play, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSaveFeedback } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { CampaignActionResult } from "@/modules/campaigns/result";
import type { CampaignView } from "@/modules/campaigns/view";
import { archiveCampaign, pauseCampaign, resumeCampaign, unarchiveCampaign } from "./actions";
import { CampaignFormPanel } from "./CampaignForm";

type Kind = "pause" | "resume" | "archive" | "unarchive";

/**
 * Ações da página da campanha: Editar, Pausar ou Retomar, Arquivar ou
 * Desarquivar. Quais aparecem vem de `campaign.allowed` (a mesma tabela que as
 * actions usam para recusar), então terminada e arquivada não mostram botão de
 * edição — e esconder o botão é só aparência: a action confere de novo.
 *
 * **Sem confirmação:** as quatro são reversíveis (o oposto está a um clique) e
 * nenhuma apaga nada, então não perguntam "tem certeza?" — o `CONVENTIONS.md`
 * reserva a confirmação para o que é destrutivo. O retorno é o botão em
 * carregando e o toast no topo, que diz o que aconteceu ("Campanha pausada.").
 *
 * Telas largas: uma fileira de botões. No celular, quando há mais de uma ação,
 * elas ficam atrás de "Mais ações" (botão de revelar, com `aria-expanded`),
 * para não empurrar o título para fora da tela. É o MESMO conjunto de botões
 * nos dois casos — só a apresentação muda por CSS.
 */
export function CampaignActions({ campaign }: { campaign: CampaignView }) {
  const router = useRouter();
  const save = useSaveFeedback({ entity: "campanha", action: "update", gender: "f" });
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  /** Qual botão está carregando: só ele mostra os três pontos, os outros ficam desabilitados. */
  const [busy, setBusy] = useState<Kind | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const { allowed } = campaign;
  const count = [allowed.edit, allowed.pause, allowed.resume, allowed.archive, allowed.unarchive].filter(Boolean).length;
  const collapsible = count > 1;

  // Menu aberto: clique fora e Esc fecham. O Esc de um diálogo aberto (o painel
  // de edição) é do diálogo — não derruba o menu por baixo dele.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector("dialog[open]")) return;
      setMenuOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  async function run(kind: Kind, task: () => Promise<CampaignActionResult>) {
    setBusy(kind);
    try {
      const result = await save.run(task);
      // Falhou (status que mudou em outra aba, por exemplo): atualiza a página
      // para os botões voltarem a refletir o estado real.
      if (!result.ok) router.refresh();
    } finally {
      setBusy(null);
      setMenuOpen(false);
    }
  }

  const statusActions: { kind: Kind; shown: boolean; Icon: LucideIcon; label: string; loadingLabel: string; task: () => Promise<CampaignActionResult> }[] = [
    { kind: "pause", shown: allowed.pause, Icon: Pause, label: "Pausar", loadingLabel: "Pausando a campanha", task: () => pauseCampaign(campaign.id) },
    { kind: "resume", shown: allowed.resume, Icon: Play, label: "Retomar", loadingLabel: "Retomando a campanha", task: () => resumeCampaign(campaign.id) },
    { kind: "archive", shown: allowed.archive, Icon: Archive, label: "Arquivar", loadingLabel: "Arquivando a campanha", task: () => archiveCampaign(campaign.id) },
    { kind: "unarchive", shown: allowed.unarchive, Icon: ArchiveRestore, label: "Desarquivar", loadingLabel: "Desarquivando a campanha", task: () => unarchiveCampaign(campaign.id) },
  ];

  // 44 px de altura de toque no celular; lista cheia de largura dentro do menu.
  // Largura mínima igual nas telas largas: o botão que vira "carregando" (só os
  // três pontos) não encolhe nem empurra os vizinhos da fileira.
  const item = cn("max-sm:h-11 sm:min-w-32", collapsible && "max-sm:w-full max-sm:justify-start");

  return (
    <div ref={rootRef} className="relative">
      {collapsible && (
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          className="h-11 sm:hidden"
          aria-expanded={menuOpen}
          aria-controls={menuId}
          onClick={() => setMenuOpen((value) => !value)}
        >
          <Ellipsis size={16} aria-hidden />
          Mais ações
        </Button>
      )}

      <div
        id={menuId}
        className={cn(
          "flex gap-2 sm:flex-row sm:items-center",
          collapsible && [
            !menuOpen && "max-sm:hidden",
            // No celular vira um painel suspenso sob o botão (opaco: sobrepõe o conteúdo).
            // Ancorado à ESQUERDA: no celular o gatilho fica na borda esquerda, abaixo do título.
            "max-sm:absolute max-sm:left-0 max-sm:top-full max-sm:z-20 max-sm:mt-2 max-sm:w-60 max-sm:flex-col max-sm:gap-1",
            "max-sm:rounded-surface max-sm:border max-sm:border-ink/10 max-sm:bg-white max-sm:p-2 max-sm:shadow-sm",
            "panel:max-sm:border-white/15 panel:max-sm:bg-ink",
          ],
        )}
      >
        {allowed.edit && (
          <Button
            type="button"
            variant="outline"
            className={item}
            disabled={save.saving}
            onClick={() => {
              setMenuOpen(false);
              setEditing(true);
            }}
          >
            <Pencil size={16} aria-hidden />
            Editar
          </Button>
        )}

        {statusActions
          .filter((action) => action.shown)
          .map(({ kind, Icon, label, loadingLabel, task }) => (
            <Button
              key={kind}
              type="button"
              variant="outline"
              className={item}
              loading={busy === kind}
              loadingLabel={loadingLabel}
              disabled={save.saving}
              onClick={() => void run(kind, task)}
            >
              <Icon size={16} aria-hidden />
              {label}
            </Button>
          ))}
      </div>

      {/* Fora do menu de propósito: um `<dialog>` dentro de um contêiner
          escondido (`display: none` no celular, menu fechado) não aparece. */}
      {allowed.edit && (
        <CampaignFormPanel
          open={editing}
          onClose={() => setEditing(false)}
          onSaved={() => setEditing(false)}
          campaign={campaign}
        />
      )}
    </div>
  );
}
