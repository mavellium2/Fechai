"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Ellipsis, Pause, Pencil, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-dialog";
import { useSaveFeedback } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { CampaignActionResult } from "@/modules/campaigns/result";
import type { CampaignView } from "@/modules/campaigns/view";
import { archiveCampaign, pauseCampaign, resumeCampaign, unarchiveCampaign } from "./actions";
import { CampaignFormPanel } from "./CampaignForm";

/**
 * Ações da página da campanha: Editar, Pausar ou Retomar, Arquivar ou
 * Desarquivar. Quais aparecem vem de `campaign.allowed` (a mesma tabela que as
 * actions usam para recusar), então terminada e arquivada não mostram botão de
 * edição — e esconder o botão é só aparência: a action confere de novo.
 *
 * Telas largas: uma fileira de botões. No celular, quando há mais de uma ação,
 * elas ficam atrás de "Mais ações" (botão de revelar, com `aria-expanded`),
 * para não empurrar o título para fora da tela. É o MESMO conjunto de botões
 * nos dois casos — só a apresentação muda por CSS —, então não há diálogo de
 * confirmação duplicado no DOM.
 */
export function CampaignActions({ campaign }: { campaign: CampaignView }) {
  const router = useRouter();
  const save = useSaveFeedback({ entity: "campanha", action: "update", gender: "f" });
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const { allowed } = campaign;
  const count = [allowed.edit, allowed.pause, allowed.resume, allowed.archive, allowed.unarchive].filter(Boolean).length;
  const collapsible = count > 1;

  // Menu aberto: clique fora e Esc fecham. O Esc de um diálogo aberto (a
  // confirmação) é do diálogo — não derruba o menu por baixo dele.
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

  async function run(task: () => Promise<CampaignActionResult>) {
    const result = await save.run(task);
    // Falhou (status que mudou em outra aba, por exemplo): atualiza a página
    // para os botões voltarem a refletir o estado real.
    if (!result.ok) router.refresh();
    setMenuOpen(false);
  }

  // 44 px de altura de toque no celular; lista cheia de largura dentro do menu.
  const item = "max-sm:h-11";
  const itemInMenu = collapsible ? "max-sm:w-full max-sm:justify-start" : undefined;

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
            "max-sm:rounded-surface max-sm:border max-sm:border-ink/10 max-sm:bg-white max-sm:p-2 max-sm:shadow-md",
            "panel:max-sm:border-white/15 panel:max-sm:bg-ink",
          ],
        )}
      >
        {allowed.edit && (
          <Button
            type="button"
            variant="outline"
            className={cn(item, itemInMenu)}
            onClick={() => {
              setMenuOpen(false);
              setEditing(true);
            }}
          >
            <Pencil size={16} aria-hidden />
            Editar
          </Button>
        )}

        {allowed.pause && (
          <ConfirmButton
            variant="outline"
            className={cn(item, itemInMenu)}
            disabled={save.saving}
            confirm={{
              title: "Pausar esta campanha?",
              description: "Ela deixa de aparecer como ativa até você retomar. Nada é apagado e o período continua o mesmo.",
              confirmLabel: "Pausar campanha",
            }}
            onConfirm={() => run(() => pauseCampaign(campaign.id))}
          >
            <Pause size={16} aria-hidden />
            Pausar
          </ConfirmButton>
        )}

        {allowed.resume && (
          <ConfirmButton
            variant="outline"
            className={cn(item, itemInMenu)}
            disabled={save.saving}
            confirm={{
              title: "Retomar esta campanha?",
              description: "Ela volta a ficar ativa, dentro do período que você definiu.",
              confirmLabel: "Retomar campanha",
            }}
            onConfirm={() => run(() => resumeCampaign(campaign.id))}
          >
            <Play size={16} aria-hidden />
            Retomar
          </ConfirmButton>
        )}

        {allowed.archive && (
          <ConfirmButton
            variant="outline"
            className={cn(item, itemInMenu)}
            disabled={save.saving}
            confirm={{
              title: "Arquivar esta campanha?",
              description:
                "Ela sai da lista principal e fica só para consulta, e continua nos relatórios. Você pode desarquivar quando quiser.",
              confirmLabel: "Arquivar campanha",
            }}
            onConfirm={() => run(() => archiveCampaign(campaign.id))}
          >
            <Archive size={16} aria-hidden />
            Arquivar
          </ConfirmButton>
        )}

        {allowed.unarchive && (
          <Button
            type="button"
            variant="outline"
            className={cn(item, itemInMenu)}
            loading={save.saving}
            loadingLabel="Desarquivando"
            onClick={() => void run(() => unarchiveCampaign(campaign.id))}
          >
            <ArchiveRestore size={16} aria-hidden />
            Desarquivar
          </Button>
        )}
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
