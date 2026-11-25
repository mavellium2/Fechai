"use client";

import { createContext, useContext, useId, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Filter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import { CRM_ASSIGNEE_NONE, CRM_ASSIGNEE_UNIDENTIFIED, crmBoardHref, type readCrmFilters } from "@/modules/crm/board-filters";
import { CRM_ORIGIN_OPTIONS } from "@/modules/crm/lead-origin";

/**
 * Filtros do quadro: o botão fica no cabeçalho, junto das outras ações, e abre
 * uma faixa larga com os campos lado a lado logo acima do quadro. A faixa
 * acompanha a rolagem (sticky) e só fecha no X — aplicar não fecha, para dar
 * para ajustar e ver o quadro mudar. Os valores continuam na URL (`etapa`,
 * `responsavel`, `origem`, `etiqueta`, `periodo`, `de`, `ate`).
 */
type Filters = ReturnType<typeof readCrmFilters>;
const PanelContext = createContext<{ open: boolean; setOpen: (open: boolean) => void; panelId: string } | null>(null);

function usePanel() {
  const value = useContext(PanelContext);
  if (!value) throw new Error("CrmFilters fora de CrmFiltersProvider");
  return value;
}

export function CrmFiltersProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return <PanelContext.Provider value={{ open, setOpen, panelId }}>{children}</PanelContext.Provider>;
}

const activeCount = (filters: Filters) =>
  [filters.stages.length, filters.assignees.length, filters.origins.length, filters.tags.length, filters.from || filters.to].filter(Boolean).length;

export function CrmFiltersButton({ filters }: { filters: Filters }) {
  const { open, setOpen, panelId } = usePanel();
  const active = activeCount(filters);
  return (
    <Button variant="outline" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
      <Filter size={16} aria-hidden />
      Filtros
      {active > 0 && (
        <span className="ml-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-iris px-1 font-mono text-xs text-white">{active}</span>
      )}
    </Button>
  );
}

export function CrmFiltersPanel({ filters, stages, tags, users }: {
  filters: Filters;
  stages: { id: string; name: string }[];
  tags: { id: string; name: string }[];
  users: { id: string; name: string }[];
}) {
  const { open, setOpen, panelId } = usePanel();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Cada filtro aceita vários valores (vale qualquer um deles); vazio é "todos".
  const [stage, setStage] = useState<string[]>(filters.stages);
  const [origin, setOrigin] = useState<string[]>(filters.origins);
  const [tag, setTag] = useState<string[]>(filters.tags);
  const [assignee, setAssignee] = useState<string[]>(filters.assignees);
  const [basis, setBasis] = useState<string>(filters.basis);
  // Valor da URL que não está mais na lista (pessoa ou etiqueta removida) continua visível para dar para tirar.
  const missingPeople = assignee.filter((id) => id !== CRM_ASSIGNEE_NONE && id !== CRM_ASSIGNEE_UNIDENTIFIED && !users.some((user) => user.id === id));
  const missingTags = tag.filter((id) => !tags.some((item) => item.id === id));
  if (!open) return null;

  const go = (values: Record<string, string>) => startTransition(() => router.push(crmBoardHref({}, values)));
  return (
    <form id={panelId} aria-label="Filtrar leads" action="/crm" method="get" onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      go({ etapa: stage.join(","), responsavel: assignee.join(","), origem: origin.join(","), etiqueta: tag.join(","),
        periodo: basis, de: String(data.get("de") ?? ""), ate: String(data.get("ate") ?? "") });
    }} className="sticky top-0 z-20 grid min-w-0 grid-cols-2 items-end gap-3 rounded-surface border border-ink/10 bg-white p-3 shadow-lg panel:border-white/12 panel:bg-ink sm:grid-cols-4 xl:grid-cols-[repeat(7,minmax(0,1fr))_auto]">
      <Field className="min-w-0" label="Etapa" htmlFor="crm-stage" labelId="crm-stage-label">
        <SelectMenu multiple label="Etapa" labelledBy="crm-stage-label" placeholder="Todas as etapas" value={stage} onChange={setStage}
          options={stages.map(({ id, name }) => ({ value: id, label: name }))} />
      </Field>
      <Field className="min-w-0" label="Responsável" htmlFor="crm-assignee" labelId="crm-assignee-label">
        <SelectMenu multiple label="Responsável" labelledBy="crm-assignee-label" placeholder="Todos os responsáveis" value={assignee} onChange={setAssignee}
          options={[...users.map(({ id, name }) => ({ value: id, label: name })),
            { value: CRM_ASSIGNEE_NONE, label: "Sem responsável" },
            { value: CRM_ASSIGNEE_UNIDENTIFIED, label: "Humano não identificado" },
            ...missingPeople.map((id) => ({ value: id, label: "Pessoa indisponível" }))]} />
      </Field>
      <Field className="min-w-0" label="Origem" htmlFor="crm-origin" labelId="crm-origin-label">
        <SelectMenu multiple label="Origem" labelledBy="crm-origin-label" placeholder="Todas as origens" value={origin} onChange={setOrigin}
          options={Object.entries(CRM_ORIGIN_OPTIONS).map(([value, label]) => ({ value, label }))} />
      </Field>
      <Field className="min-w-0" label="Etiqueta" htmlFor="crm-tag" labelId="crm-tag-label">
        <SelectMenu multiple label="Etiqueta" labelledBy="crm-tag-label" placeholder="Todas as etiquetas" value={tag} onChange={setTag}
          options={[...tags.map(({ id, name }) => ({ value: id, label: name })),
            ...missingTags.map((id) => ({ value: id, label: "Etiqueta indisponível" }))]} />
      </Field>
      <Field className="min-w-0" label="Período por" htmlFor="crm-period" labelId="crm-period-label">
        <SelectMenu label="Período por" labelledBy="crm-period-label" value={basis} onChange={setBasis}
          options={[{ value: "entrada", label: "Entrada do lead" }, { value: "atividade", label: "Última atividade" }]} />
      </Field>
      <Field className="min-w-0" label="De" htmlFor="crm-from">
        <Input key={`de-${filters.from}`} className="min-w-0" type="date" id="crm-from" name="de" defaultValue={filters.from} />
      </Field>
      <Field className="min-w-0" label="Até" htmlFor="crm-to">
        <Input key={`ate-${filters.to}`} className="min-w-0" type="date" id="crm-to" name="ate" defaultValue={filters.to} />
      </Field>
      <div className="col-span-2 flex items-end justify-end gap-2 sm:col-span-1">
        {activeCount(filters) > 0 && (
          <Button type="button" variant="ghost" disabled={pending} onClick={() => {
            setStage([]); setAssignee([]); setOrigin([]); setTag([]); setBasis("entrada");
            go({});
          }}>Limpar</Button>
        )}
        <Button type="submit" loading={pending}>Aplicar</Button>
        <Button type="button" variant="ghost" size="icon" aria-label="Fechar filtros" onClick={() => setOpen(false)}><X size={18} aria-hidden /></Button>
      </div>
    </form>
  );
}
