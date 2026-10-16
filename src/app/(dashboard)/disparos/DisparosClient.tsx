"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { FileSpreadsheet, RefreshCw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import { Alert } from "@/components/ui/alert";
import type { BroadcastTemplate } from "@/modules/broadcasts/template";
import type {
  BroadcastPage,
  BroadcastFilter,
} from "@/modules/broadcasts/queries";
import type { ColumnMapping } from "@/modules/broadcasts/import";
import { BroadcastReview, type Review } from "./BroadcastReview";
import { BroadcastHistory } from "./BroadcastHistory";
import { downloadBase64 } from "./download";
import {
  downloadBroadcastExample,
  inspectBroadcastImport,
  loadBroadcastTemplates,
  prepareBroadcast,
  refreshBroadcasts,
} from "./actions";

export function DisparosClient({
  connected,
  displayPhone,
  initialCampaigns,
}: {
  connected: boolean;
  displayPhone: string | null;
  initialCampaigns: BroadcastPage;
}) {
  const [templates, setTemplates] = useState<BroadcastTemplate[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({
    phone: "",
    name: "",
    parameters: [],
  });
  const [review, setReview] = useState<Review | null>(null);
  const [data, setData] = useState(initialCampaigns);
  const [filter, setFilter] = useState<BroadcastFilter>({ page: 1 });
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [issues, setIssues] = useState<{ row: number; error: string }[]>([]);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const reviewPanel = useRef<HTMLDivElement>(null);
  const requestVersion = useRef(0);
  const template = templates.find((t) => t.id === templateId);

  useEffect(() => {
    if (review) {
      reviewPanel.current?.focus();
      reviewPanel.current?.scrollIntoView({
        block: "start",
        behavior: "smooth",
      });
    }
  }, [review]);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const version = ++requestVersion.current;
      try {
        const next = await refreshBroadcasts(filter);
        if (!stopped && version === requestVersion.current) setData(next);
      } catch {
        if (!stopped)
          setError(
            "Não foi possível atualizar o andamento. Tente atualizar novamente.",
          );
      }
      if (!stopped) timer = setTimeout(tick, 5000);
    };
    timer = setTimeout(tick, 0);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [filter]);
  async function refresh() {
    const version = ++requestVersion.current;
    const next = await refreshBroadcasts(filter);
    if (version === requestVersion.current) setData(next);
  }
  function notify(message: string, failure = false) {
    if (failure) setError(message);
    else setInfo(message);
  }
  function run(action: () => Promise<void>) {
    setError("");
    setInfo("");
    startTransition(async () => {
      try {
        await action();
      } catch {
        setError(
          "Não foi possível concluir. Atualize o histórico antes de tentar novamente.",
        );
      }
    });
  }
  function autoMapping(available: string[], count: number) {
    return {
      phone:
        ["telefone", "phone", "whatsapp"].find((c) => available.includes(c)) ??
        "",
      name: ["nome", "name"].find((c) => available.includes(c)) ?? "",
      parameters: Array.from({ length: count }, (_, i) =>
        available.includes(`var_${i + 1}`) ? `var_${i + 1}` : "",
      ),
    };
  }
  const options = [
    { value: "", label: "Selecione uma coluna" },
    ...columns.map((value) => ({ value, label: value })),
  ];
  return (
    <div className="space-y-6">
      {error && <Alert tone="danger">{error}</Alert>}
      {info && <Alert tone="success">{info}</Alert>}
      {issues.length > 0 && (
        <Card>
          <h2 className="font-semibold text-white">
            Corrija as linhas e importe novamente
          </h2>
          <ul className="mt-3 max-h-60 space-y-2 overflow-auto text-sm text-white/70">
            {issues.map((i) => (
              <li key={i.row}>
                Linha {i.row}: {i.error}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {review ? (
        <div
          ref={reviewPanel}
          tabIndex={-1}
          className="outline-none"
          aria-label="Revisão do disparo"
        >
          <BroadcastReview
            key={review.id}
            review={review}
            connected={connected}
            pending={pending}
            run={run}
            notify={notify}
            onBack={() => setReview(null)}
            onStarted={async () => {
              setReview(null);
              setName("");
              setFile(null);
              setColumns([]);
              if (fileInput.current) fileInput.current.value = "";
              notify(
                "Disparo confirmado. Os envios continuarão em segundo plano, dentro do horário escolhido.",
              );
              await refresh();
            }}
          />
        </div>
      ) : (
        <Card className="space-y-6">
          <div className="flex justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-semibold text-white">
                Novo disparo
              </h2>
              <p className="mt-1 text-sm text-white/60">
                {displayPhone
                  ? `Número de envio: ${displayPhone}`
                  : "Envios pela API oficial do WhatsApp."}
              </p>
            </div>
            <FileSpreadsheet className="text-iris" size={28} aria-hidden />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-5">
              <label className="block text-sm text-white/80">
                Nome do disparo
                <Input
                  className="mt-2"
                  placeholder="Ex.: Novidades de outubro"
                  value={name}
                  maxLength={100}
                  onChange={(e) => setName(e.target.value)}
                  disabled={!connected || pending}
                />
              </label>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-white/80" id="template-label">
                    Template da mensagem
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!connected}
                    loading={pending}
                    onClick={() =>
                      run(async () => {
                        const result = await loadBroadcastTemplates();
                        if (!result.ok) return notify(result.error, true);
                        setTemplates(result.templates);
                        setLoaded(true);
                        if (!result.templates.some((t) => t.id === templateId))
                          setTemplateId("");
                      })
                    }
                  >
                    <RefreshCw size={14} aria-hidden />
                    {loaded ? "Atualizar" : "Carregar templates"}
                  </Button>
                </div>
                <SelectMenu
                  label="Template da mensagem"
                  labelledBy="template-label"
                  value={templateId}
                  onChange={(value) => {
                    setTemplateId(value);
                    setMapping(
                      autoMapping(
                        columns,
                        templates.find((t) => t.id === value)?.parameterCount ??
                          0,
                      ),
                    );
                  }}
                  disabled={!connected || pending || !templates.length}
                  className="w-full"
                  options={[
                    { value: "", label: "Selecione um template" },
                    ...templates.map((t) => ({
                      value: t.id,
                      label: `${t.name} · ${t.language}`,
                    })),
                  ]}
                />
                <p className="text-xs text-white/60">
                  Templates aprovados de texto, sem botões ou mídia, com
                  variáveis numéricas no corpo.
                </p>
                {loaded && !templates.length && (
                  <Alert tone="warn">
                    Nenhum template compatível.{" "}
                    <Link href="/disparos/modelos" className="underline underline-offset-2">
                      Crie um modelo
                    </Link>{" "}
                    e aguarde a aprovação da Meta.
                  </Alert>
                )}
              </div>
              <div>
                <label
                  htmlFor="broadcast-file"
                  className="mb-2 block text-sm text-white/80"
                >
                  Arquivo de contatos
                </label>
                <input
                  ref={fileInput}
                  id="broadcast-file"
                  type="file"
                  accept=".xlsx,.json"
                  disabled={!connected || pending}
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null);
                    setColumns([]);
                    setIssues([]);
                  }}
                  className="block w-full rounded-control border border-dashed border-white/25 p-4 text-sm text-white/70 file:mr-3 file:rounded-control file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris"
                />
                <p className="mt-2 text-xs text-white/60">
                  Excel (.xlsx) ou JSON · até 2 MB e 1.000 contatos. Excel usa a
                  primeira aba.
                </p>
                <Button
                  className="mt-3"
                  size="sm"
                  variant="outline"
                  loading={pending}
                  disabled={!file || !template}
                  onClick={() =>
                    run(async () => {
                      if (!file || !template) return;
                      const form = new FormData();
                      form.set("file", file);
                      const result = await inspectBroadcastImport(form);
                      if (!result.ok) return notify(result.error, true);
                      setColumns(result.columns);
                      setMapping(
                        autoMapping(result.columns, template.parameterCount),
                      );
                    })
                  }
                >
                  Ler colunas do arquivo
                </Button>
              </div>
            </div>
            <div className="space-y-4 rounded-control bg-black/15 p-5">
              <h3 className="text-sm font-semibold text-white">
                Prepare sua lista
              </h3>
              <p className="text-sm leading-relaxed text-white/65">
                Inclua DDI e DDD no telefone (ex.: 5511987654321). Depois de ler
                o arquivo, associe suas colunas ao telefone, ao nome e às
                variáveis da mensagem. No Excel, guarde telefones como texto.
              </p>
              <div className="flex flex-wrap gap-2">
                {(["xlsx", "json"] as const).map((format) => (
                  <Button
                    key={format}
                    size="sm"
                    variant="outline"
                    disabled={!template || pending}
                    onClick={() =>
                      run(async () =>
                        downloadBase64(
                          await downloadBroadcastExample(
                            format,
                            template?.parameterCount ?? 0,
                          ),
                          `modelo-disparos.${format}`,
                          format === "json"
                            ? "application/json"
                            : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        ),
                      )
                    }
                  >
                    Modelo {format === "xlsx" ? "Excel" : "JSON"}
                  </Button>
                ))}
              </div>
              {template && (
                <div className="border-t border-white/10 pt-4">
                  <p className="mb-2 text-xs text-white/60">
                    Mensagem aprovada · {template.language}
                  </p>
                  <p className="whitespace-pre-wrap break-words text-sm text-white/85">
                    {[template.header, template.body, template.footer]
                      .filter(Boolean)
                      .join("\n\n")}
                  </p>
                </div>
              )}
            </div>
          </div>
          {columns.length > 0 && (
            <div className="space-y-3 border-t border-white/10 pt-5">
              <h3 className="font-medium text-white">Associe as colunas</h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <p className="mb-2 text-sm text-white/70">Telefone *</p>
                  <SelectMenu
                    label="Coluna do telefone"
                    value={mapping.phone}
                    onChange={(phone) => setMapping({ ...mapping, phone })}
                    options={options}
                    disabled={pending}
                  />
                </div>
                <div>
                  <p className="mb-2 text-sm text-white/70">Nome (opcional)</p>
                  <SelectMenu
                    label="Coluna do nome"
                    value={mapping.name ?? ""}
                    onChange={(name) => setMapping({ ...mapping, name })}
                    options={[
                      { value: "", label: "Não importar nome" },
                      ...options.slice(1),
                    ]}
                    disabled={pending}
                  />
                </div>
                {mapping.parameters.map((value, i) => (
                  <div key={i}>
                    <p className="mb-2 text-sm text-white/70">
                      Variável {`{{${i + 1}}}`} *
                    </p>
                    <SelectMenu
                      label={`Coluna da variável ${i + 1}`}
                      value={value}
                      onChange={(column) =>
                        setMapping({
                          ...mapping,
                          parameters: mapping.parameters.map((p, j) =>
                            i === j ? column : p,
                          ),
                        })
                      }
                      options={options}
                      disabled={pending}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-5">
            <p className="max-w-xl text-sm text-white/60">
              Revise os contatos e experimente a mensagem antes de confirmar.
              Números repetidos recebem uma única vez neste disparo.
            </p>
            <Button
              loading={pending}
              disabled={
                !connected ||
                !file ||
                !template ||
                !name.trim() ||
                !columns.length ||
                !mapping.phone ||
                mapping.parameters.some((p) => !p)
              }
              onClick={() =>
                run(async () => {
                  if (!file) return;
                  setIssues([]);
                  const form = new FormData();
                  form.set("name", name);
                  form.set("templateId", templateId);
                  form.set("file", file);
                  form.set("mapping", JSON.stringify(mapping));
                  const result = await prepareBroadcast(form);
                  if (!result.ok) {
                    notify(result.error, true);
                    setIssues(result.issues ?? []);
                    return;
                  }
                  setReview(result);
                  await refresh();
                })
              }
            >
              <Upload size={16} aria-hidden />
              Importar e revisar
            </Button>
          </div>
        </Card>
      )}
      <BroadcastHistory
        data={data}
        filter={filter}
        onFilter={setFilter}
        pending={pending}
        run={run}
        refresh={refresh}
        notify={notify}
        onReview={setReview}
      />
    </div>
  );
}
