"use client";

import { useEffect, useEffectEvent } from "react";
import { useRouter } from "next/navigation";

const PULSE_MS = 20_000;

export function useCrmLiveRefresh(version: string, paused: boolean) {
  const router = useRouter();
  const allowed = useEffectEvent(() => !paused && document.visibilityState === "visible");

  useEffect(() => {
    let request: AbortController | null = null;
    async function check() {
      if (!allowed() || request) return;
      const controller = new AbortController();
      request = controller;
      try {
        const response = await fetch("/api/crm/pulso", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const next = await response.json() as { version?: string };
        if (!controller.signal.aborted && allowed() && next.version && next.version !== version) router.refresh();
      } catch {
        // A próxima leitura tenta de novo. O quadro mantém os dados atuais.
      } finally {
        if (request === controller) request = null;
      }
    }
    const timer = window.setInterval(() => { void check(); }, PULSE_MS);
    function visibilityChanged() {
      if (document.visibilityState === "visible") void check();
      else request?.abort();
    }
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visibilityChanged);
      request?.abort();
    };
  }, [router, version]);
}
