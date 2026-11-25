"use client";

import { startTransition, useActionState, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeftRight, GripVertical } from "lucide-react";
import { FormFeedback } from "@/components/ui/alert";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { SelectMenu } from "@/components/ui/select-menu";
import { Textarea } from "@/components/ui/textarea";
import { useActionToast } from "@/components/ui/toast";
import type { ActionResult } from "@/components/ui/toast/types";
import type { CrmBoardCard, getCrmBoard } from "@/modules/crm/board";
import { CRM_COLUMN_SIZE, crmBoardHref, type CrmSearchParams } from "@/modules/crm/board-filters";
import { CRM_LOSS_NOTE_LIMIT } from "@/modules/crm/limits";
import { crmSlaLabel, crmSlaLevel, crmWaitMinutes, type CrmSlaLevel, type CrmSlaLimits } from "@/modules/crm/sla";
import { moveCrmCard } from "./actions";
import { useCrmLiveRefresh } from "./useCrmLiveRefresh";

type Board = Awaited<ReturnType<typeof getCrmBoard>>;
type Stage = Board["pipeline"]["stages"][number];
type Move = { card: CrmBoardCard; to?: string };
type LossReason = { key: string; label: string };

function timeInStage(value: string | null, now: number) {
  if (!value) return "Tempo na etapa indisponível";
  const minutes = Math.max(0, Math.floor((now - Date.parse(value)) / 60_000));
  if (minutes < 1) return "Há menos de 1 min";
  if (minutes < 60) return `Há ${minutes} min`;
  if (minutes < 1440) return `Há ${Math.floor(minutes / 60)} h`;
  return `Há ${Math.floor(minutes / 1440)} d`;
}

const slaTone: Record<CrmSlaLevel, string> = {
  ok: "border-success/40 bg-success/10 text-ink panel:text-white",
  alert: "border-warn/50 bg-warn/15 text-ink panel:text-white",
  late: "border-danger/50 bg-danger/10 text-danger panel:text-white",
  unknown: "border-ink/15 bg-ink/5 text-neutral panel:border-white/15 panel:bg-white/10 panel:text-white/70",
};

function SlaBadge({ since, now, limits }: { since: string | null; now: number; limits: CrmSlaLimits }) {
  const minutes = crmWaitMinutes(since, now);
  const level = crmSlaLevel(minutes, limits);
  return (
    <p data-crm-sla={level} className={`mt-2 inline-flex max-w-full items-center gap-1.5 rounded-control border px-2 py-0.5 text-xs [overflow-wrap:anywhere] ${slaTone[level]}`}>
      <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${level === "ok" ? "bg-success" : level === "alert" ? "bg-warn" : level === "late" ? "bg-danger" : "bg-neutral"}`} />
      {crmSlaLabel(minutes, limits)}
    </p>
  );
}

export function CrmBoard({ columns, stages, lossReasons, params, version, now, sla }: {
  columns: Board["columns"]; stages: Stage[]; lossReasons: LossReason[]; params: CrmSearchParams; version: string; now: number;
  /** Prazos da conta (CRM-10): as cores do selo seguem os mesmos limites dos avisos. */
  sla: CrmSlaLimits;
}) {
  const [move, setMove] = useState<Move | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [clock, setClock] = useState(0);
  const dragged = useRef<CrmBoardCard | null>(null);
  const [state, submit, pending] = useActionState(async (previous: ActionResult | null, data: FormData) => {
    const result = await moveCrmCard(previous, data);
    if (result.ok) setMove(null);
    return result;
  }, null);
  useActionToast(state, pending, { entity: "lead", action: "update" });
  useCrmLiveRefresh(version, Boolean(params.lead || move || dragging || pending));
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  function endDrag() {
    dragged.current = null;
    setDragging(null);
    setHover(null);
  }

  function drop(stage: Stage) {
    const card = dragged.current;
    endDrag();
    if (!card?.stageId || card.stageId === stage.id || pending) return;
    if (stage.kind === "lost") {
      setMove({ card, to: stage.id });
      return;
    }
    const data = new FormData();
    data.set("leadId", card.id);
    data.set("fromStageId", card.stageId);
    data.set("stageId", stage.id);
    startTransition(() => submit(data));
  }

  return (
    <>
      <div data-crm-board className="w-full min-w-0 max-w-full rounded-surface md:flex md:items-start md:gap-3 md:overflow-x-auto md:pb-3" aria-label="Quadro de leads">
        {columns.map((column, index) => (
          <section key={column.id} className={`${index ? "hidden md:block" : "block"} min-w-0 rounded-surface border px-3 py-3 md:w-64 md:shrink-0 ${
            hover === column.id ? "border-iris bg-iris/10" : "border-ink/10 bg-ink/[0.03] panel:border-white/10 panel:bg-white/[0.04]"
          }`} aria-labelledby={`crm-column-${column.id}`} onDragOver={(event) => {
            if (!dragged.current || dragged.current.stageId === column.id || pending) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setHover(column.id);
          }} onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHover(null);
          }} onDrop={(event) => {
            if (!dragged.current) return;
            event.preventDefault();
            drop(column);
          }}>
            <div className="mb-3 flex items-start justify-between gap-2">
              <h2 id={`crm-column-${column.id}`} className="min-w-0 break-words text-sm font-semibold">{column.name}</h2>
              <span className="rounded-control bg-ink/5 px-2 py-1 text-xs tabular-nums panel:bg-white/10" aria-label={`${column.total} leads`}>{column.total.toLocaleString("pt-BR")}</span>
            </div>
            {column.cards.length === 0 ? <p className="py-4 text-sm text-neutral panel:text-white/55">Nenhum lead nesta etapa.</p> : (
              <ul className="space-y-2">
                {column.cards.map((card) => (
                  <li key={card.id} data-crm-card={card.id} draggable={!pending} className={`min-w-0 rounded-control border border-ink/10 bg-white p-3 panel:border-white/10 panel:bg-ink ${dragging === card.id ? "opacity-45" : ""}`}
                    onDragStart={(event) => {
                      dragged.current = card;
                      setDragging(card.id);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", card.id);
                    }} onDragEnd={endDrag}>
                    <div className="flex items-start gap-2">
                      <GripVertical size={15} className="mt-0.5 hidden shrink-0 cursor-grab text-neutral md:block" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <Link href={crmBoardHref(params, { lead: card.id })} prefetch={false} draggable={false}
                          className="block text-sm font-medium [overflow-wrap:anywhere] hover:underline">{card.name}</Link>
                        <p className="mt-1 text-xs text-neutral panel:text-white/60">{card.phone}</p>
                      </div>
                      <Button type="button" variant="ghost" size="icon" disabled={pending} aria-label={`Mover ${card.name}`} title="Mover lead" onClick={() => setMove({ card })}>
                        <ArrowLeftRight size={15} aria-hidden />
                      </Button>
                    </div>
                    <p className="mt-2 text-xs text-neutral panel:text-white/60">{card.origin} · {timeInStage(card.stageSince, Math.max(now, clock))}</p>
                    <p className={`mt-1 text-xs [overflow-wrap:anywhere] ${card.assignee.kind === "user" ? "text-ink panel:text-white/85" : "text-neutral panel:text-white/55"}`}>
                      <span className="sr-only">Responsável: </span>{card.assignee.label}
                    </p>
                    {column.kind === "waiting_human" && <SlaBadge since={card.stageSince} now={Math.max(now, clock)} limits={sla} />}
                    {card.tags.length > 0 && (
                      <ul className="mt-2 flex flex-wrap gap-1" aria-label="Etiquetas">
                        {card.tags.map((tag) => <li key={tag.id} className="min-w-0 rounded-control bg-ink/5 px-2 py-0.5 text-xs [overflow-wrap:anywhere] panel:bg-white/10">{tag.name}</li>)}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {column.total > CRM_COLUMN_SIZE && (
              <nav className="mt-3 flex flex-wrap items-center justify-between gap-1" aria-label={`Páginas de ${column.name}`}>
                {column.page > 1 && <ButtonLink size="sm" variant="ghost" scroll={false} prefetch={false}
                  href={crmBoardHref(params, { [`p_${column.id}`]: String(column.page - 1) })}>Anterior</ButtonLink>}
                <span className="text-xs text-neutral panel:text-white/55">{column.page} de {Math.ceil(column.total / CRM_COLUMN_SIZE)}</span>
                {column.page * CRM_COLUMN_SIZE < column.total && <ButtonLink size="sm" variant="ghost" scroll={false} prefetch={false}
                  href={crmBoardHref(params, { [`p_${column.id}`]: String(column.page + 1) })}>Próxima</ButtonLink>}
              </nav>
            )}
          </section>
        ))}
      </div>
      {move && <MoveCardDialog key={`${move.card.id}:${move.to ?? ""}`} move={move} stages={stages} lossReasons={lossReasons}
        close={() => setMove(null)} action={submit} pending={pending} state={state} />}
    </>
  );
}

function MoveCardDialog({ move, stages, lossReasons, close, action, pending, state }: {
  move: Move; stages: Stage[]; lossReasons: LossReason[]; close: () => void; action: (data: FormData) => void; pending: boolean; state: ActionResult | null;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const title = useId();
  const [oldState] = useState(state);
  const [to, setTo] = useState(move.to ?? "");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const lost = stages.find(({ id }) => id === to)?.kind === "lost";
  const selectedReason = lossReasons.some(({ key }) => key === reason) ? reason : "";
  useEffect(() => { ref.current?.showModal(); }, []);

  return (
    <dialog ref={ref} onClose={close} aria-labelledby={title} onCancel={(event) => { if (pending) event.preventDefault(); }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-surface border border-ink/10 bg-white p-5 text-ink backdrop:bg-ink/70 panel:border-white/15 panel:bg-ink panel:text-white">
      <h2 className="font-display break-words text-lg font-semibold" id={title}>Mover {move.card.name}</h2>
      <form action={action} className="mt-4 space-y-4">
        <input type="hidden" name="leadId" value={move.card.id} />
        <input type="hidden" name="fromStageId" value={move.card.stageId ?? ""} />
        <SelectMenu name="stageId" label="Etapa de destino" value={to} onChange={setTo} disabled={pending}
          options={[{ value: "", label: "Escolha a etapa de destino" }, ...stages.filter(({ id }) => id !== move.card.stageId)
            .map(({ id, name }) => ({ value: id, label: name }))]} />
        {lost && (
          <>
            <SelectMenu name="reason" label="Motivo da perda" value={selectedReason} onChange={setReason} disabled={pending}
              options={[{ value: "", label: "Escolha o motivo da perda" }, ...lossReasons.map(({ key, label }) => ({ value: key, label }))]} />
            <Field label="Justificativa da perda" htmlFor={`${title}-note`}>
              <Textarea id={`${title}-note`} name="lossReasonNote" required maxLength={CRM_LOSS_NOTE_LIMIT} readOnly={pending}
                value={note} onChange={(event) => setNote(event.target.value)} />
            </Field>
          </>
        )}
        {state !== oldState && <FormFeedback error={state?.error} info={state?.info} />}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => ref.current?.close()} disabled={pending}>Cancelar</Button>
          <Button type="submit" variant={lost ? "destructive" : "default"} loading={pending} disabled={!to || (lost && (!selectedReason || !note.trim()))}>
            {lost ? "Confirmar perda" : "Mover lead"}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
