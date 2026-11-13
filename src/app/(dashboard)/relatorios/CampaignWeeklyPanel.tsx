"use client";

import { useState, type ReactNode } from "react";

export function CampaignWeeklyPanel({ preview, children }: { preview?: ReactNode; children: ReactNode }) {
  const [opened, setOpened] = useState(false);
  return (
    <details className="space-y-4" onToggle={(event) => { if (event.currentTarget.open) setOpened(true); }}>
      <summary className="min-h-11 cursor-pointer py-3 font-medium text-ink focus-visible:outline-iris panel:text-white">
        Configurar relatório semanal
      </summary>
      {opened && <div className="space-y-4">{preview}{children}</div>}
    </details>
  );
}
