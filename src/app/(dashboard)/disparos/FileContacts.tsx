"use client";
import { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SelectMenu } from "@/components/ui/select-menu";
import type { ColumnMapping } from "@/modules/broadcasts/import";
import type { BroadcastTemplate } from "@/modules/broadcasts/template";
import { downloadBase64 } from "./download";
import { downloadBroadcastExample, inspectBroadcastImport } from "./actions";

/**
 * Planilha Excel ou JSON. Ler as colunas acontece sozinho ao escolher o
 * arquivo — antes era um botão a mais que ninguém entendia.
 */
export function FileContacts({
  template,
  file,
  onFile,
  columns,
  onColumns,
  mapping,
  onMapping,
  mediaColumn,
  disabled,
}: {
  template: BroadcastTemplate;
  file: File | null;
  onFile: (file: File | null) => void;
  columns: string[];
  onColumns: (columns: string[]) => void;
  mapping: ColumnMapping;
  onMapping: (mapping: ColumnMapping) => void;
  /** Mensagem com mídia e "link na planilha": pede a coluna do link. */
  mediaColumn?: boolean;
  disabled?: boolean;
}) {
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<number | null>(null);

  async function read(next: File) {
    setReading(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", next);
      const result = await inspectBroadcastImport(form);
      if (!result.ok) {
        setError(result.error);
        onColumns([]);
      } else {
        onColumns(result.columns);
        setRows(result.total);
      }
    } catch {
      setError("Não foi possível ler o arquivo. Tente de novo.");
    } finally {
      setReading(false);
    }
  }

  async function example(format: "xlsx" | "json") {
    downloadBase64(
      await downloadBroadcastExample(format, template.parameterCount, Boolean(template.mediaFormat)),
      `modelo-disparos.${format}`,
      format === "json"
        ? "application/json"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  }

  const options = [
    { value: "", label: "Escolha a coluna" },
    ...columns.map((value) => ({ value, label: value })),
  ];

  return (
    <div className="space-y-5">
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <label htmlFor="broadcast-file" className="mb-2 block text-sm text-white/80">
            Planilha de contatos
          </label>
          <input
            id="broadcast-file"
            type="file"
            accept=".xlsx,.json"
            disabled={disabled || reading}
            onChange={(e) => {
              const next = e.target.files?.[0] ?? null;
              onFile(next);
              setRows(null);
              if (next) void read(next);
            }}
            className="block w-full rounded-control border border-dashed border-white/25 p-4 text-sm text-white/70 file:mr-3 file:rounded-control file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
          />
          <p className="mt-2 text-xs text-white/60" aria-live="polite">
            {reading
              ? "Lendo o arquivo…"
              : file && rows !== null
                ? `${file.name} · ${rows} linhas`
                : "Excel (.xlsx) ou JSON · até 2 MB e 1.000 contatos. No Excel, vale a primeira aba."}
          </p>
        </div>
        <div className="space-y-3 rounded-control bg-black/20 p-5">
          <p className="flex items-center gap-2 text-sm font-medium text-white">
            <FileSpreadsheet size={16} className="text-iris" aria-hidden />
            Não tem planilha pronta?
          </p>
          <p className="text-sm text-white/65">
            Baixe o modelo com as colunas certas para esta mensagem. Telefone com
            DDI e DDD (ex.: 5511987654321), guardado como texto no Excel.
            {template.mediaFormat && " A coluna link_arquivo é usada só no modo “Link na planilha”."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={disabled} onClick={() => void example("xlsx")}>
              Modelo Excel
            </Button>
            <Button size="sm" variant="ghost" disabled={disabled} onClick={() => void example("json")}>
              Modelo JSON
            </Button>
          </div>
        </div>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}

      {columns.length > 0 && (
        <div className="space-y-3 border-t border-white/10 pt-5">
          <div>
            <h3 className="font-medium text-white">Qual coluna é o quê?</h3>
            <p className="mt-1 text-sm text-white/60">
              Já sugerimos pelas colunas com nomes conhecidos. Confira antes de seguir.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <MappingField
              label="Telefone"
              value={mapping.phone}
              options={options}
              disabled={disabled}
              onChange={(phone) => onMapping({ ...mapping, phone })}
            />
            <MappingField
              label="Nome (opcional)"
              value={mapping.name ?? ""}
              options={[{ value: "", label: "Sem nome" }, ...options.slice(1)]}
              disabled={disabled}
              onChange={(name) => onMapping({ ...mapping, name })}
            />
            {mediaColumn && (
              <MappingField
                label="Link do arquivo"
                value={mapping.media ?? ""}
                options={options}
                disabled={disabled}
                onChange={(media) => onMapping({ ...mapping, media })}
              />
            )}
            {mapping.parameters.map((value, i) => (
              <MappingField
                key={i}
                label={`Variável {{${i + 1}}}`}
                value={value}
                options={options}
                disabled={disabled}
                onChange={(column) =>
                  onMapping({
                    ...mapping,
                    parameters: mapping.parameters.map((p, j) => (i === j ? column : p)),
                  })
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MappingField({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const id = `map-${label.replace(/\W+/g, "-")}`;
  return (
    <div>
      <p id={id} className="mb-2 text-sm text-white/70">
        {label}
      </p>
      <SelectMenu
        label={label}
        labelledBy={id}
        value={value}
        onChange={onChange}
        options={options}
        disabled={disabled}
        className="w-full"
      />
    </div>
  );
}
