# campaign-override — Padrões de Código

## Checagem no caminho do agente (nunca lança)
```ts
// src/modules/campaign-override/lead.ts
export async function isCampaignLead(tenantId: string, leadId: string, now: Date = new Date()): Promise<boolean> {
  try {
    return (await resolveCampaignLeadMatches(tenantId, [leadId], now)).has(leadId);
  } catch {
    return false;
  }
}
```

## Script com gravação protegida (`--apply` + `--actor`)
```ts
// scripts/campanha-override.ts
if (apply && !actorId) throw new Error("--actor <userId> é obrigatório para gravar.");
if (!apply) return console.log("\nRode de novo com --apply --actor <userId> para gravar.");
const resolved = await resolveScriptActor(actorId!, tenantId);
if (!resolved.ok) throw new Error(resolved.message);
```

A auditoria é importada **depois** de gravar (`await import("../src/modules/audit/log")`), para `--show` e a simulação não abrirem Redis.
