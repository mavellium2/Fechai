"use client";
import { useMemo, useState } from "react";
import { Search, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { MessagePreview } from "./TemplatePicker";
import { formatPhone } from "./labels";
import type { Review } from "./NewBroadcastWizard";

/**
 * Revisar e testar: resumo em números, contatos numa tabela compacta com busca
 * e, ao lado, a prévia (com/sem nome) e o envio de teste.
 */
export function ReviewStep({
  review,
  testPhone,
  onTestPhone,
  onSendTest,
  testing,
  disabled,
  children,
}: {
  review: Review;
  testPhone: string;
  onTestPhone: (value: string) => void;
  onSendTest: () => void;
  testing: boolean;
  disabled?: boolean;
  /** Mais blocos na coluna da direita (quando enviar, autorização). */
  children?: React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const withName = review.recipients.filter((r) => r.variant !== "nameless");
  const without = review.recipients.filter((r) => r.variant === "nameless");
  const hasBoth = Boolean(review.namelessTemplate && without.length && withName.length);
  const [version, setVersion] = useState<"main" | "nameless">(withName.length ? "main" : "nameless");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    if (!q) return review.recipients;
    return review.recipients.filter(
      (r) => r.name?.toLowerCase().includes(q) || (digits.length >= 3 && r.phone.includes(digits)),
    );
  }, [review.recipients, query]);

  const sample = version === "nameless" ? without[0] : withName[0];
  const template =
    version === "nameless" && review.namelessTemplate ? review.namelessTemplate : review.template;


  return (
    <div className="space-y-5">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <section aria-labelledby="review-contacts" className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 id="review-contacts" className="text-sm font-medium text-white">
              Contatos
              <span className="ml-2 font-normal text-white/60">
                {review.recipients.length} {review.recipients.length === 1 ? "vai receber" : "vão receber"}
              </span>
            </h3>
            {review.recipients.length > 8 && (
              <div className="relative w-full sm:w-64">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/40"
                  aria-hidden
                />
                <Input
                  aria-label="Buscar contato na lista"
                  placeholder="Buscar nome ou telefone"
                  className="h-9 pl-8 text-sm"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            )}
          </div>
          <div className="max-h-[calc(100vh-15rem)] min-h-64 overflow-auto rounded-control border border-white/10">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-ink text-xs text-white/55">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">Nome</th>
                  <th scope="col" className="px-4 py-2 font-medium">Telefone</th>
                  {without.length > 0 && (
                    <th scope="col" className="px-4 py-2 text-right font-medium">Mensagem</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {rows.map((r) => (
                  <tr key={r.row} className="hover:bg-white/5">
                    <td className="max-w-0 truncate px-4 py-2 text-white">
                      {r.name || <span className="text-white/45">Sem nome</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-white/60">
                      {formatPhone(r.phone)}
                    </td>
                    {without.length > 0 && (
                      <td className="px-4 py-2 text-right">
                        {r.variant === "nameless" ? (
                          <Badge tone="iris">sem nome</Badge>
                        ) : (
                          <span className="text-xs text-white/45">com nome</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-sm text-white/55">
                      Ninguém com esse nome ou telefone na lista.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="space-y-4" aria-label="Prévia e teste">
          <div className="space-y-3 rounded-control bg-black/20 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-white/55">
                {sample ? `Como fica para ${sample.name || formatPhone(sample.phone)}` : "Prévia"}
              </p>
              {hasBoth && (
                <SegmentedControl
                  label="Ver versão da mensagem"
                  value={version}
                  options={[
                    { value: "main", label: "Com nome" },
                    { value: "nameless", label: "Sem nome" },
                  ]}
                  onSelect={setVersion}
                />
              )}
            </div>
            <MessagePreview
              template={template}
              values={sample?.parameters}
              media={sample ? { url: sample.mediaUrl, filename: sample.mediaFilename } : null}
            />
          </div>

          <section aria-labelledby="test-title" className="space-y-2 rounded-control border border-white/10 p-4">
            <h3 id="test-title" className="text-sm font-medium text-white">
              Testar no seu WhatsApp <span className="font-normal text-white/50">(opcional)</span>
            </h3>
            <div className="flex gap-2">
              <Input
                id="test-phone"
                aria-label="Seu número, com DDI e DDD"
                value={testPhone}
                inputMode="tel"
                onChange={(e) => onTestPhone(e.target.value)}
                placeholder="+55 11 98765-4321"
                disabled={disabled}
              />
              <Button
                variant="outline"
                loading={testing}
                disabled={disabled || !testPhone.trim()}
                onClick={onSendTest}
              >
                <Send size={16} aria-hidden />
                Testar
              </Button>
            </div>
          </section>
          {children}
        </aside>
      </div>
    </div>
  );
}
