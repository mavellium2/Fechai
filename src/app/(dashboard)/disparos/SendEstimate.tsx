"use client";
import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { dayKeyInZone, timeInZone } from "@/modules/scheduling/time";
import { dayLabel, durationLabel, estimateBroadcast } from "@/modules/broadcasts/estimate";

/**
 * Quando o disparo começa, quanto leva e quando termina — calculado com a
 * mesma faixa diária que a fila respeita. O relógio só existe no navegador
 * (atualiza a cada 30 s), então o primeiro desenho no servidor não mostra hora.
 */
export function SendEstimate({
  total,
  timezone,
  scheduled,
  windowStart,
  windowEnd,
}: {
  total: number;
  timezone: string;
  scheduled: { date: string; time: string } | null;
  windowStart: string;
  windowEnd: string;
}) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  if (!now) return null;
  const today = dayKeyInZone(now, timezone);
  const e = estimateBroadcast({
    total,
    today,
    nowTime: timeInZone(now, timezone),
    scheduled,
    windowStart,
    windowEnd,
  });
  if (!e) return null;
  if (scheduled && (!scheduled.date || !scheduled.time)) return null;

  return (
    <div className="space-y-2 rounded-control bg-white/5 p-3 text-xs text-white/70" aria-live="polite">
      <p className="flex items-center gap-2 text-sm font-medium text-white">
        <Clock size={14} aria-hidden />
        Leva {durationLabel(e.sendingMinutes)}
        <span className="font-normal text-white/55">para {total} {total === 1 ? "mensagem" : "mensagens"}</span>
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-white/55">Começa</dt>
        <dd className="text-white/85">
          {dayLabel(e.startDay, today)} às {e.startTime}
        </dd>
        <dt className="text-white/55">Termina</dt>
        <dd className="text-white/85">
          por volta de {dayLabel(e.endDay, today)} às {e.endTime}
        </dd>
      </dl>
      {e.days > 1 && (
        <p className="text-white/60">
          Não cabe em um dia: para às {windowEnd} e continua no dia seguinte a partir de {windowStart}.
        </p>
      )}
    </div>
  );
}
