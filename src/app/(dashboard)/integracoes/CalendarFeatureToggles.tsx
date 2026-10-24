"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Apple, CalendarCheck2, Stethoscope } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useUnsavedNavigation } from "@/components/ui/unsaved-changes";
import { setCalendarFeatureAction } from "./actions";
import type { CalendarFeatureKey } from "@/modules/scheduling/features";

/**
 * O ícone é escolhido AQUI, pela chave, e não recebido por prop.
 *
 * Um componente React não atravessa a fronteira Server → Client: ele é uma
 * função, e só objeto simples é serializável. Passar `icon: Stethoscope` de um
 * Server Component quebra a página inteira.
 */
const ICONS: Record<CalendarFeatureKey, React.ComponentType<{ size?: number | string; className?: string }>> = {
  google: CalendarCheck2,
  clinicorp: Stethoscope,
  icloud: Apple,
};

type Item = {
  key: CalendarFeatureKey;
  name: string;
  description: string;
  enabled: boolean;
  /** Já tem credencial gravada? Muda o texto de "o que fazer agora". */
  connected: boolean;
  /** Falta configuração no servidor (ex.: credenciais do Google no env). */
  unavailable?: string;
};

/**
 * Liga cada calendário e, logo abaixo do toggle, mostra a configuração dele.
 *
 * Habilitar e configurar acontecem aqui, no mesmo lugar: a /agenda só exibe o
 * status ("conectado, enviando e recebendo"). Quem está olhando a agenda quer
 * saber se o horário que vai marcar chega na clínica — não preencher token.
 *
 * Desligar não apaga credencial: a sincronização para e o formulário se
 * recolhe, mas o que foi configurado continua lá para quando religar.
 */
export function CalendarFeatureToggles({
  items,
  /**
   * Formulário de configuração de cada calendário, por chave. Renderiza DENTRO
   * do mesmo card do toggle: solto embaixo, com título próprio, parecia uma
   * terceira integração em vez da configuração daquela ali.
   */
  panels,
}: {
  items: Item[];
  panels?: Partial<Record<CalendarFeatureKey, React.ReactNode>>;
}) {
  const router = useRouter();
  const confirmNavigation = useUnsavedNavigation();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<CalendarFeatureKey | null>(null);
  const [, startTransition] = useTransition();

  function toggle(key: CalendarFeatureKey, next: boolean) {
    setBusy(key);
    setError(null);
    startTransition(async () => {
      const res = await setCalendarFeatureAction(key, next);
      if (!res.ok) setError(res.error ?? "Falha ao atualizar.");
      setBusy(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const Icon = ICONS[item.key];
        const descId = `cal-${item.key}-desc`;

        return (
          <Card key={item.key} className="p-4">
            <div className="flex flex-wrap items-start gap-3">
              <Icon
                size={18}
                aria-hidden
                className={item.enabled ? "mt-0.5 text-success" : "mt-0.5 text-white/50"}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white">{item.name}</p>
                <p id={descId} className="mt-0.5 text-xs text-white/55">
                  {item.description}
                </p>

                {/* Conectado: o status vira link para a agenda, que é onde os
                    horários aparecem. Falta conectar: o formulário já está
                    logo abaixo, então não há para onde mandar a pessoa. */}
                {item.enabled && !item.unavailable && (
                  <p className="mt-2 text-xs text-white/70">
                    {item.connected ? (
                      <>
                        {item.key === "clinicorp" || item.key === "icloud" ? "Credenciais salvas." : "Conectado."}{" "}
                        <Link
                          href="/agenda"
                          className="rounded-control underline underline-offset-4 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
                        >
                          Ver na Agenda
                        </Link>
                      </>
                    ) : (
                      "Falta conectar — veja abaixo."
                    )}
                  </p>
                )}
              </div>

              {item.unavailable ? (
                <span className="font-mono text-micro uppercase tracking-wide text-white/40">
                  indisponível
                </span>
              ) : (
                <Switch
                  checked={item.enabled}
                  loading={busy === item.key}
                  label={`${item.name}: ${item.enabled ? "habilitado" : "desabilitado"}`}
                  describedBy={descId}
                  onCheckedChange={(next) => confirmNavigation(() => toggle(item.key, next))}
                />
              )}
            </div>

            {item.unavailable && (
              <p className="mt-3 text-xs text-white/50">{item.unavailable}</p>
            )}

            {item.enabled && !item.unavailable && panels?.[item.key] && (
              <div className="mt-4 border-t border-white/10 pt-4">{panels[item.key]}</div>
            )}
          </Card>
        );
      })}

      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}
