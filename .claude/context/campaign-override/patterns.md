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

## Trava de vaga por horário (contar e gravar na mesma transação)
```ts
// src/modules/campaign-override/slot-lock.ts (trecho; ver o arquivo para a mensagem completa)
return prisma.$transaction(async (tx) => {
  const key = `${input.tenantId}|${input.startsAt.toISOString()}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
  const taken = await tx.appointment.count({
    where: {
      tenantId: input.tenantId,
      status: "scheduled",
      startsAt: input.startsAt,
      ...(input.ignoreAppointmentId ? { id: { not: input.ignoreAppointmentId } } : {}),
    },
  });
  if (taken >= input.capacity) throw new OverrideSlotFullError(slotFullProblem(dia, hora)); // dia/hora do instante, no arquivo
  return work(tx);
});
```

Uso em `scheduling/repository.ts`: `createAppointment` e `rescheduleAppointment` chamam `withOverrideSlotLock` só quando `overrideSlotCapacity(slot)` não é `null`.

## Script com gravação protegida (`--apply` + `--actor`)
```ts
// scripts/campanha-override.ts
if (apply && !actorId) throw new Error("--actor <userId> é obrigatório para gravar.");
if (!apply) return console.log("\nRode de novo com --apply --actor <userId> para gravar.");
const resolved = await resolveScriptActor(actorId!, tenantId);
if (!resolved.ok) throw new Error(resolved.message);
```

A auditoria é importada **depois** de gravar (`await import("../src/modules/audit/log")`), para `--show` e a simulação não abrirem Redis.
