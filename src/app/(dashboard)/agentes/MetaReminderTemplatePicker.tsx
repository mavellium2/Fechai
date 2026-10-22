"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { renderBroadcast, type BroadcastTemplate } from "@/modules/broadcasts/template";
import {
  META_REMINDER_VARIABLES,
  metaReminderParameters,
  type MetaReminderTemplate,
  type MetaReminderVariable,
} from "@/modules/scheduling/meta-reminder";
import { Button } from "@/components/ui/button";
import { SelectMenu } from "@/components/ui/select-menu";
import { loadReminderTemplatesAction } from "./actions";

/** Valores de exemplo da prévia — a mesma forma que o worker preenche. */
const SAMPLE = { nome: "Maria Souza", data: "terça-feira, 29 de setembro", hora: "17:45" };

/**
 * Qual template aprovado da Meta vai para quem está fora da janela de 24h
 * (inclusive quem nunca conversou com o número, como os pacientes marcados
 * direto no Clinicorp), e o que entra em cada `{{n}}`.
 *
 * A lista vem da Meta no clique (`loadReminderTemplatesAction`), não no
 * carregamento da tela. O servidor confere de novo, ao salvar, se o template
 * continua aprovado e igual — ver `readMetaReminderTemplate`.
 */
export function MetaReminderTemplatePicker({
  value,
  onChange,
  location,
  disabled = false,
}: {
  value: MetaReminderTemplate | null;
  onChange: (value: MetaReminderTemplate | null) => void;
  /** "Local ou formato" salvo — alimenta `{{local}}` na prévia. */
  location: string;
  disabled?: boolean;
}) {
  const [templates, setTemplates] = useState<BroadcastTemplate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const result = await loadReminderTemplatesAction();
      if (result.ok) setTemplates(result.templates);
      else setError(result.error);
    } catch {
      setError("Não foi possível falar com a Meta agora. Tente de novo.");
    } finally {
      setLoading(false);
    }
  }

  function choose(id: string) {
    const template = templates?.find((t) => t.id === id);
    if (!template) return;
    // Palpite pela ordem mais comum ("Olá {{1}}, sua consulta é {{2}} às
    // {{3}}"); cada variável pode ser trocada logo abaixo, com a prévia.
    const variables = Array.from({ length: template.parameterCount }, (_, i): MetaReminderVariable =>
      META_REMINDER_VARIABLES[i]?.value ?? "nome");
    onChange({ ...template, variables });
    setTemplates(null);
  }

  const preview = value
    ? (() => {
        const params = metaReminderParameters(value, { ...SAMPLE, local: location });
        return params ? renderBroadcast(value, params) : null;
      })()
    : null;

  return (
    <div className="space-y-3 rounded-control border border-white/10 p-4">
      <div>
        <p className="text-sm font-medium text-white/85">
          Contatos fora da janela de 24h da Meta
        </p>
        <p className="mt-1 text-sm text-white/60">
          Para quem não falou com seu número nas últimas 24h (inclusive pacientes marcados direto
          no Clinicorp), a Meta só aceita template aprovado — escolha qual usar. Sem template,
          esses contatos não recebem lembrete.
        </p>
      </div>

      {value && (
        <div className="space-y-3">
          <p className="font-mono text-micro uppercase tracking-wider text-white/55">
            {value.name} · {value.language}
          </p>
          {value.variables.map((variable, index) => (
            <div key={index} className="grid items-center gap-2 sm:grid-cols-[4rem_1fr]">
              <p id={`meta-reminder-var-${index}`} className="font-mono text-xs text-white/70">
                {`{{${index + 1}}}`}
              </p>
              <SelectMenu
                label={`O que vai em {{${index + 1}}}`}
                labelledBy={`meta-reminder-var-${index}`}
                options={META_REMINDER_VARIABLES.map((o) => ({ value: o.value, label: o.label }))}
                value={variable}
                disabled={disabled}
                onChange={(next) =>
                  onChange({
                    ...value,
                    variables: value.variables.map((v, i) => (i === index ? (next as MetaReminderVariable) : v)),
                  })
                }
              />
            </div>
          ))}
          {preview ? (
            <p className="whitespace-pre-line rounded-control border border-white/5 bg-black/20 px-3 py-2 text-sm leading-relaxed text-white/80">
              {preview}
            </p>
          ) : (
            <p className="text-sm text-amber/90">
              O template usa o local da consulta, mas &quot;Local ou formato&quot; está em branco.
            </p>
          )}
        </div>
      )}

      {templates && (
        <div className="space-y-2">
          <p id="meta-reminder-choose" className="text-sm text-white/70">Escolha o template</p>
          <SelectMenu
            label="Escolha o template"
            labelledBy="meta-reminder-choose"
            options={[
              { value: "", label: "Escolha um template" },
              ...templates.map((t) => ({ value: t.id, label: `${t.name} · ${t.language}` })),
            ]}
            value=""
            disabled={disabled}
            onChange={choose}
          />
        </div>
      )}

      {error && <p className="text-sm text-amber/90">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" loading={loading}
          loadingLabel="Buscando templates na Meta" disabled={disabled} onClick={load}>
          <Download size={14} aria-hidden />
          {value ? "Trocar template" : "Carregar templates da Meta"}
        </Button>
        {value && (
          <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onChange(null)}>
            Remover
          </Button>
        )}
      </div>
    </div>
  );
}
