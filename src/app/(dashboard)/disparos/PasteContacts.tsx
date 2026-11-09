"use client";
import { useMemo } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  addBrazilCountryCode,
  MAX_RECIPIENTS,
  parsePastedContacts,
} from "@/modules/broadcasts/contacts";

export function PasteContacts({
  text,
  onChange,
  disabled,
}: {
  text: string;
  onChange: (text: string) => void;
  disabled?: boolean;
}) {
  const lines = useMemo(() => parsePastedContacts(text), [text]);
  const valid = lines.filter((l) => l.ok).length;
  const invalid = lines.filter((l) => !l.ok);
  const missingCountry = invalid.filter((l) => !l.ok && l.missingCountry).length;

  return (
    <div className="space-y-3">
      <label htmlFor="broadcast-paste" className="block text-sm text-white/80">
        Um contato por linha: telefone e, se quiser, o nome
      </label>
      <Textarea
        id="broadcast-paste"
        rows={8}
        value={text}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder={"+55 11 98765-4321, Ana\n+55 21 99876-5432; Bruno\n5531988887777"}
        className="font-mono text-sm"
        aria-describedby="broadcast-paste-help"
      />
      <p id="broadcast-paste-help" className="text-xs text-white/60">
        Separe o nome com vírgula, ponto e vírgula ou tabulação. Também dá para
        copiar as colunas de telefone e nome direto do Excel ou do Google
        Planilhas e colar aqui. Inclua o DDI (55 no Brasil).
      </p>

      {lines.length > 0 && (
        <div className="space-y-2 text-sm" aria-live="polite">
          <p className="text-white/70">
            <span className="font-semibold text-white">{valid}</span>{" "}
            {valid === 1 ? "número reconhecido" : "números reconhecidos"}
            {invalid.length > 0 && (
              <>
                {" · "}
                <span className="text-warn">
                  {invalid.length}{" "}
                  {invalid.length === 1 ? "linha com problema" : "linhas com problema"}
                </span>
              </>
            )}
            {valid > MAX_RECIPIENTS && (
              <span className="text-danger">
                {" "}
                · o limite é de {MAX_RECIPIENTS} por disparo
              </span>
            )}
          </p>
          {missingCountry > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-control border border-warn/30 bg-warn/10 p-3">
              <p className="flex-1 text-white/80">
                {missingCountry === 1
                  ? "1 número parece brasileiro sem o 55."
                  : `${missingCountry} números parecem brasileiros sem o 55.`}
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => onChange(addBrazilCountryCode(text))}
              >
                Adicionar +55
              </Button>
            </div>
          )}
          {invalid.length > 0 && (
            <ul className="max-h-32 space-y-1 overflow-auto text-xs text-white/60">
              {invalid.slice(0, 20).map((l) =>
                l.ok ? null : (
                  <li key={l.line}>
                    Linha {l.line}:{" "}
                    <span className="font-mono text-white/80">{l.text}</span>{" "}
                    — telefone não reconhecido
                  </li>
                ),
              )}
              {invalid.length > 20 && <li>e mais {invalid.length - 20}…</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
