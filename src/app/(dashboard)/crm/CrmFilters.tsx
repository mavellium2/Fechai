"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import { CRM_ASSIGNEE_NONE, CRM_ASSIGNEE_UNIDENTIFIED, crmBoardHref, type readCrmFilters } from "@/modules/crm/board-filters";
import { CRM_ORIGIN_OPTIONS } from "@/modules/crm/lead-origin";

export function CrmFilters({ filters, stages, tags, users }: {
  filters: ReturnType<typeof readCrmFilters>;
  stages: { id: string; name: string }[];
  tags: { id: string; name: string }[];
  users: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [stage, setStage] = useState(filters.stage);
  const [origin, setOrigin] = useState<string>(filters.origin);
  const [tag, setTag] = useState(filters.tag);
  const [assignee, setAssignee] = useState(filters.assignee);
  const known = assignee === CRM_ASSIGNEE_NONE || assignee === CRM_ASSIGNEE_UNIDENTIFIED || users.some(({ id }) => id === assignee);
  const [basis, setBasis] = useState<string>(filters.basis);

  return (
    <form action="/crm" method="get" onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      router.push(crmBoardHref({}, Object.fromEntries(Array.from(data, ([key, value]) => [key, String(value)]))));
    }} className="grid min-w-0 grid-cols-2 gap-3 rounded-surface border border-ink/10 p-3 panel:border-white/10 sm:grid-cols-3 2xl:grid-cols-[repeat(7,minmax(0,1fr))_auto]">
      <div className="col-span-2 min-w-0 sm:col-span-1">
        <Field label="Etapa" htmlFor="crm-stage" labelId="crm-stage-label">
          <SelectMenu name="etapa" label="Etapa" labelledBy="crm-stage-label" value={stage} onChange={setStage}
            options={[{ value: "", label: "Todas as etapas" }, ...stages.map(({ id, name }) => ({ value: id, label: name }))]} />
        </Field>
      </div>
      <Field className="min-w-0" label="Responsável" htmlFor="crm-assignee" labelId="crm-assignee-label">
        <SelectMenu name="responsavel" label="Responsável" labelledBy="crm-assignee-label" value={assignee} onChange={setAssignee}
          options={[{ value: "", label: "Todos os responsáveis" }, ...users.map(({ id, name }) => ({ value: id, label: name })),
            { value: CRM_ASSIGNEE_NONE, label: "Sem responsável" },
            { value: CRM_ASSIGNEE_UNIDENTIFIED, label: "Humano não identificado" },
            ...(assignee && !known ? [{ value: assignee, label: "Pessoa indisponível" }] : [])]} />
      </Field>
      <Field className="min-w-0" label="Origem" htmlFor="crm-origin" labelId="crm-origin-label">
        <SelectMenu name="origem" label="Origem" labelledBy="crm-origin-label" value={origin} onChange={setOrigin}
          options={[{ value: "", label: "Todas as origens" }, ...Object.entries(CRM_ORIGIN_OPTIONS).map(([value, label]) => ({ value, label }))]} />
      </Field>
      <Field className="min-w-0" label="Etiqueta" htmlFor="crm-tag" labelId="crm-tag-label">
        <SelectMenu name="etiqueta" label="Etiqueta" labelledBy="crm-tag-label" value={tag} onChange={setTag}
          options={[{ value: "", label: "Todas as etiquetas" }, ...tags.map(({ id, name }) => ({ value: id, label: name })),
            ...(tag && !tags.some(({ id }) => id === tag) ? [{ value: tag, label: "Etiqueta indisponível" }] : [])]} />
      </Field>
      <Field className="min-w-0" label="Período por" htmlFor="crm-period" labelId="crm-period-label">
        <SelectMenu name="periodo" label="Período por" labelledBy="crm-period-label" value={basis} onChange={setBasis}
          options={[{ value: "entrada", label: "Entrada do lead" }, { value: "atividade", label: "Última atividade" }]} />
      </Field>
      <Field className="min-w-0" label="De" htmlFor="crm-from">
        <Input className="min-w-0" type="date" id="crm-from" name="de" defaultValue={filters.from} />
      </Field>
      <Field className="min-w-0" label="Até" htmlFor="crm-to">
        <Input className="min-w-0" type="date" id="crm-to" name="ate" defaultValue={filters.to} />
      </Field>
      <div className="col-span-2 flex flex-wrap items-end gap-2 sm:col-span-1">
        <Button type="submit">Filtrar</Button>
        {(filters.stage || filters.assignee || filters.origin || filters.tag || filters.from || filters.to) && <ButtonLink href="/crm" variant="ghost">Limpar</ButtonLink>}
      </div>
    </form>
  );
}
