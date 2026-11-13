"use client";

import { useRouter } from "next/navigation";
import { CalendarRange } from "lucide-react";
import { SelectMenu } from "@/components/ui/select-menu";

/** Filtro de período da lista: um menu só, para não virar uma segunda fileira de abas. */
export function PeriodSelect({ value, options, hrefFor }: { value: string; options: { value: string; label: string }[]; hrefFor: Record<string, string> }) {
  const router = useRouter();
  return (
    <SelectMenu
      label="Filtrar campanhas por período"
      icon={CalendarRange}
      value={value}
      onChange={(next) => router.push(hrefFor[next] ?? "/campanhas")}
      options={options}
    />
  );
}
