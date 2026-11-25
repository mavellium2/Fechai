"use client";

import { CrmLiveSearch } from "./CrmLiveSearch";
import type { CrmSearchParams } from "@/modules/crm/board-filters";

/**
 * Busca geral do quadro: nome ou telefone em todas as colunas, somando-se aos
 * filtros já escolhidos. Fica na linha do título, junto dos demais controles,
 * e filtra sozinha enquanto se digita. Como a busca é do servidor, vale para
 * todos os leads da conta — não só os 20 primeiros de cada etapa.
 *
 * Largura fluida no celular e fixa a partir de `sm`: os botões ao lado nunca
 * empurram a busca para fora da linha, e o quadro não ganha rolagem horizontal.
 */
export function CrmGlobalSearch({ params, term }: { params: CrmSearchParams; term: string }) {
  return (
    <CrmLiveSearch params={params} term={term} name="q"
      label="Buscar lead por nome ou telefone em todas as etapas"
      placeholder="Buscar lead em todas as etapas"
      className="min-w-0 flex-1 sm:w-44 sm:flex-none lg:w-56 xl:w-72"
      inputClassName="h-10 text-sm" />
  );
}
