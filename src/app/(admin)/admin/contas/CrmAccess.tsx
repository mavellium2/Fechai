"use client";

import { useState } from "react";
import { FormFeedback } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { sanitizeReason } from "@/components/ui/toast/messages";
import { errorToResult, isFrameworkSignal } from "@/components/ui/toast/save-service";
import type { ActionResult } from "@/components/ui/toast/types";
import { useSaveFeedback } from "@/components/ui/toast/use-save-feedback";
import { setTenantCrmEnabled } from "../../actions";

export function CrmAccess({ tenantId, tenantName, enabled, active }: {
  tenantId: string;
  tenantName: string;
  enabled: boolean;
  active: boolean;
}) {
  const [feedback, setFeedback] = useState<ActionResult | null>(null);
  const save = useSaveFeedback({ entity: "CRM", action: "update" });
  const helpId = `${tenantId}-crm-help`;

  function toggle(next: boolean) {
    void save.run(async () => {
      setFeedback(null);
      const result = await setTenantCrmEnabled(tenantId, next).catch((error: unknown) => {
        if (isFrameworkSignal(error)) throw error;
        return errorToResult(error);
      });
      setFeedback(result);
      return result;
    });
  }

  return (
    <section className="space-y-3 border-t border-white/10 pt-5">
      <div className="flex items-start justify-between gap-4 rounded-control border border-white/10 bg-white/[0.03] p-3">
        <div>
          <p className="text-sm font-medium text-white/85">CRM do Fechai</p>
          <p id={helpId} className="mt-1 text-sm text-white/50">
            {active || enabled
              ? "Ao liberar, o sistema prepara o pipeline e classifica os leads existentes. Desativar mantém as etapas e o histórico."
              : "Reative a conta antes de liberar o CRM."}
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={toggle}
          loading={save.saving}
          disabled={!active && !enabled}
          label={`Acesso ao CRM para ${tenantName}`}
          describedBy={helpId}
        />
      </div>
      <FormFeedback
        error={feedback?.ok === false ? sanitizeReason(feedback.error) ?? "Não foi possível salvar o acesso ao CRM." : null}
        info={sanitizeReason(feedback?.info)}
      />
    </section>
  );
}
