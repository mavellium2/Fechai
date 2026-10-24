"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { KeyRound } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Field, fieldProps } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import { issueMcpTokenAction, type IssueMcpTokenActionResult } from "./actions";

type TenantOption = { id: string; name: string };

/** Só `read` funciona nesta etapa; as outras já existem no schema. */
const SCOPE_OPTIONS = [
  { value: "read", label: "Ler a configuração do agente", available: true },
  { value: "simulate", label: "Simular conversas (em breve)", available: false },
  { value: "propose", label: "Propor mudanças (em breve)", available: false },
] as const;

export function McpTokenIssuer({ tenants }: { tenants: TenantOption[] }) {
  const uid = useId();
  const [tenantId, setTenantId] = useState(tenants[0]?.id ?? "");
  const [label, setLabel] = useState("");
  const [ttlDays, setTtlDays] = useState("30");
  const [scopes, setScopes] = useState<string[]>(["read"]);
  const [result, setResult] = useState<IssueMcpTokenActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const tenantOptions = useMemo(
    () => tenants.map((tenant) => ({ value: tenant.id, label: tenant.name })),
    [tenants],
  );

  function toggleScope(value: string) {
    setScopes((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    );
  }

  function issue() {
    setResult(null);
    startTransition(async () => {
      const next = await issueMcpTokenAction({
        tenantId,
        label,
        scopes,
        ttlDays: Number(ttlDays),
      });
      setResult(next);
      // O token em claro fica só neste estado; limpar o nome evita emitir dois
      // tokens iguais por clique duplo.
      if (next.ok) setLabel("");
    });
  }

  return (
    <section className="rounded-surface border border-white/10 bg-white/5 p-6">
      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <p id={`${uid}-tenant`} className="mb-1.5 text-sm font-medium text-white/85">
            Conta
          </p>
          <SelectMenu
            label="Conta do token"
            labelledBy={`${uid}-tenant`}
            value={tenantId}
            options={tenantOptions}
            onChange={(value) => { setTenantId(value); setResult(null); }}
          />
          <p className="mt-1.5 text-xs text-white/50">
            O token só enxerga os agentes desta conta. Não há como mudar isso na chamada.
          </p>
        </div>

        <Field label="Nome do token" htmlFor={`${uid}-label`} hint="Para reconhecê-lo na lista. Ex: Claude Code do Marcio.">
          <Input
            {...fieldProps(`${uid}-label`, { hint: true })}
            value={label}
            maxLength={80}
            placeholder="Ex: Claude Code do Marcio"
            onChange={(event) => setLabel(event.target.value)}
          />
        </Field>

        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-white/85">Permissões</legend>
          <div className="space-y-2">
            {SCOPE_OPTIONS.map((scope) => (
              <label
                key={scope.value}
                className={`flex items-center gap-2 text-sm ${scope.available ? "text-white/85" : "text-white/40"}`}
              >
                <input
                  type="checkbox"
                  className="size-4 accent-iris"
                  checked={scopes.includes(scope.value)}
                  disabled={!scope.available}
                  onChange={() => toggleScope(scope.value)}
                />
                {scope.label}
              </label>
            ))}
          </div>
        </fieldset>

        <Field label="Validade (dias)" htmlFor={`${uid}-ttl`} hint="De 1 a 365. O padrão é 30 dias.">
          <Input
            {...fieldProps(`${uid}-ttl`, { hint: true })}
            type="number"
            inputMode="numeric"
            min={1}
            max={365}
            value={ttlDays}
            onChange={(event) => setTtlDays(event.target.value)}
          />
        </Field>
      </div>

      {result && !result.ok && <Alert tone="danger" className="mt-5">{result.error}</Alert>}

      {result?.ok && (
        <Alert tone="success" title="Token emitido" className="mt-5">
          <p>
            {result.label} · {result.tenantName}. Vale até{" "}
            {new Date(result.expiresAt).toLocaleDateString("pt-BR")}.
          </p>
          <p className="mt-2 font-medium">
            Copie agora: por segurança ele não é guardado e não aparece de novo.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code
              data-testid="mcp-token-once"
              className="min-w-0 flex-1 break-all rounded-control bg-ink/60 px-3 py-2 font-mono text-xs text-white"
            >
              {result.token}
            </code>
            <CopyButton value={result.token} label="Copiar token" />
          </div>
        </Alert>
      )}

      <div className="mt-5 flex justify-end">
        <Button
          type="button"
          onClick={issue}
          loading={pending}
          loadingLabel="Emitindo token"
          disabled={!tenantId || !label.trim() || scopes.length === 0}
        >
          <KeyRound size={15} aria-hidden />
          Emitir token
        </Button>
      </div>
    </section>
  );
}
