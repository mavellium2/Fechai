"use client";

import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SelectMenu } from "@/components/ui/select-menu";
import { weekdayLabel } from "@/modules/scheduling/config";
import { describeRanges, emptyWeek, minuteLabel, paintAvailability, rangeCoverage, type WeeklyAvailability } from "@/modules/scheduling/weekly-availability";

type Gesture = { base: WeeklyAvailability; day: number; slot: number; available: boolean; pointer: number; last: string };
const DAYS = [1, 2, 3, 4, 5, 6, 0];


export function WeeklyAvailabilityGrid({ value, onChange, disabled = false }: {
  value: WeeklyAvailability;
  onChange: (next: WeeklyAvailability) => void;
  disabled?: boolean;
}) {
  const [step, setStep] = useState(60);
  const [allHours, setAllHours] = useState(false);
  const [undo, setUndo] = useState<WeeklyAvailability | null>(null);
  const [focused, setFocused] = useState({ day: 1, slot: 9 });
  const [message, setMessage] = useState("");
  const tableRef = useRef<HTMLTableElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const hintId = useId();
  const columns = 1440 / step;
  const countDays = value.filter((ranges) => ranges.length).length;
  const minutes = value.flat().reduce((total, range) => total + range.end - range.start, 0);

  function change(next: WeeklyAvailability, announcement: string) {
    if (disabled) return;
    setUndo(value);
    onChange(next);
    setMessage(announcement);
  }

  function paint(day: number, slot: number) {
    const g = gesture.current;
    if (!g || disabled || g.last === `${day}:${slot}`) return;
    g.last = `${day}:${slot}`;
    onChange(paintAvailability(g.base, g.day, day, Math.min(g.slot, slot) * step, (Math.max(g.slot, slot) + 1) * step, g.available));
  }

  function start(event: PointerEvent<HTMLButtonElement>, day: number, slot: number) {
    if (disabled || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    setFocused({ day, slot });
    const available = rangeCoverage(value[day], slot * step, (slot + 1) * step) < step;
    gesture.current = { base: value, day, slot, available, pointer: event.pointerId, last: "" };
    setUndo(value);
    tableRef.current?.setPointerCapture(event.pointerId);
    paint(day, slot);
  }

  function move(event: PointerEvent<HTMLTableElement>) {
    if (!gesture.current || event.pointerId !== gesture.current.pointer) return;
    const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-week-cell]");
    if (cell && tableRef.current?.contains(cell)) paint(Number(cell.dataset.day), Number(cell.dataset.slot));
  }

  function finish(cancel = false) {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    if (cancel) { onChange(g.base); setMessage("Seleção cancelada."); }
    else setMessage(g.available ? "Período selecionado. Salve as configurações para aplicar." : "Período removido. Salve as configurações para aplicar.");
    if (tableRef.current?.hasPointerCapture(g.pointer)) tableRef.current.releasePointerCapture(g.pointer);
  }

  function keyboard(event: KeyboardEvent<HTMLButtonElement>, day: number, slot: number) {
    if (event.key === "Escape") { finish(true); return; }
    let nextDay = day, nextSlot = slot;
    if (event.key === "ArrowRight") nextDay = DAYS[Math.min(6, DAYS.indexOf(day) + 1)];
    else if (event.key === "ArrowLeft") nextDay = DAYS[Math.max(0, DAYS.indexOf(day) - 1)];
    else if (event.key === "ArrowDown") nextSlot = Math.min(lastSlot - 1, slot + 1);
    else if (event.key === "ArrowUp") nextSlot = Math.max(firstSlot, slot - 1);
    else if (event.key === "Home") nextSlot = firstSlot;
    else if (event.key === "End") nextSlot = lastSlot - 1;
    else return;
    event.preventDefault();
    setFocused({ day: nextDay, slot: nextSlot });
    tableRef.current?.querySelector<HTMLButtonElement>(`button[data-day="${nextDay}"][data-slot="${nextSlot}"]`)?.focus();
  }

  const ranges = value.flat();
  const firstSlot = allHours ? 0 : Math.floor(Math.min(480, ...ranges.map(r => r.start)) / step);
  const lastSlot = allHours ? columns : Math.ceil(Math.max(1080, ...ranges.map(r => r.end)) / step);
  const slots = Array.from({ length: lastSlot - firstSlot }, (_, i) => firstSlot + i);
  return <section className="availability-v7" aria-label="Disponibilidade semanal">
    <input type="hidden" name="weeklyAvailability" value={JSON.stringify(value)} />
    <div className="availability-heading"><div><h3>Horários disponíveis</h3><p id={hintId}>Selecione os períodos em que o agente pode agendar.</p></div><SelectMenu label="Tamanho dos blocos da grade" value={String(step)} disabled={disabled} options={[{ value: "60", label: "Blocos de 60 min" }, { value: "30", label: "Blocos de 30 min" }, { value: "15", label: "Blocos de 15 min" }]} onChange={next => { const newStep = Number(next); setFocused(current => ({ ...current, slot: Math.floor(current.slot * step / newStep) })); setStep(newStep); }} /></div>
    <div className="availability-table-scroll"><table ref={tableRef} onPointerMove={move} onPointerUp={() => finish()} onPointerCancel={() => finish(true)} onLostPointerCapture={() => finish()} aria-describedby={hintId}>
      <caption className="sr-only">Disponibilidade semanal. Use setas para navegar e Espaço ou Enter para marcar.</caption>
      <thead><tr><th scope="col"><span className="sr-only">Horário</span></th>{DAYS.map(day => <th scope="col" key={day}><button type="button" disabled={disabled} aria-label={`${value[day].length ? "Limpar horários de" : "Liberar 24 horas de"} ${weekdayLabel(day)}`} title={describeRanges(value[day])} onClick={() => change(value.map((r, i) => i === day ? r.length ? [] : [{ start: 0, end: 1440 }] : r), `${weekdayLabel(day)} atualizado.`)}>{["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"][day]}</button></th>)}</tr></thead>
      <tbody>{slots.map(slot => <tr key={slot}><th scope="row">{minuteLabel(slot * step)}</th>{DAYS.map(day => {
        const startMinute = slot * step, endMinute = startMinute + step;
        const coverage = rangeCoverage(value[day], startMinute, endMinute);
        const full = coverage === step;
        const label = `${weekdayLabel(day)}, ${minuteLabel(startMinute)} às ${minuteLabel(endMinute)}`;
        const focusSlot = Math.max(firstSlot, Math.min(lastSlot - 1, focused.slot));
        return <td key={day} data-week-cell data-day={day} data-slot={slot}><button type="button" disabled={disabled} data-week-cell data-day={day} data-slot={slot} aria-label={label} aria-pressed={full ? true : coverage ? "mixed" : false} title={`${label} · ${full ? "Disponível" : coverage ? "Parcialmente disponível" : "Indisponível"}`} tabIndex={focused.day === day && focusSlot === slot ? 0 : -1} onPointerDown={event => start(event, day, slot)} onKeyDown={event => keyboard(event, day, slot)} onClick={event => { if (event.detail === 0) change(paintAvailability(value, day, day, startMinute, endMinute, !full), `${label}: ${full ? "indisponível" : "disponível"}.`); }}>{value[day].map((range, i) => { const from = Math.max(startMinute, range.start), to = Math.min(endMinute, range.end); return to > from ? <span key={i} aria-hidden style={{ left: `${(from - startMinute) / step * 100}%`, width: `${(to - from) / step * 100}%` }} /> : null; })}</button></td>;
      })}</tr>)}</tbody>
    </table></div>
    <p className="agent-help">{countDays} dias · {(minutes / 60).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}h por semana. Clique e arraste para selecionar ou remover períodos.</p>
    <details className="agent-extra"><summary>Ajustes da grade e horários por dia</summary><div className="availability-tools"><Button size="sm" type="button" variant="outline" onClick={() => setAllHours(v => !v)}>{allHours ? "Focar expediente" : "Ver 24 horas"}</Button><Button size="sm" type="button" variant="outline" disabled={disabled} onClick={() => change(DAYS.map(day => day > 0 && day < 6 ? [{ start: 540, end: 1080 }] : []), "Segunda a sexta, das 9 às 18 horas.")}>Seg–Sex, 9h–18h</Button><Button size="sm" type="button" variant="ghost" disabled={disabled || !minutes} onClick={() => change(emptyWeek(), "Todos os horários foram removidos.")}>Limpar semana</Button><Button size="sm" type="button" variant="ghost" disabled={disabled || !undo} onClick={() => { if (undo) { onChange(undo); setUndo(null); } }}><Undo2 size={14} />Desfazer</Button></div><dl>{DAYS.map(day => <div className="agent-info-row" key={day}><dt>{weekdayLabel(day)}</dt><dd>{describeRanges(value[day])}</dd></div>)}</dl></details>
    {!minutes && <p role="status" className="agent-help">Sem horário disponível: ao salvar assim, o agente não oferece novos agendamentos.</p>}
    <p role="status" className="sr-only">{message}</p>
  </section>;
}