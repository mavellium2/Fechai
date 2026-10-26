"use client";

import { Button } from "@/components/ui/button";

export default function AgentsError({ reset }: { reset: () => void }) {
  return <div role="alert" className="agents-empty"><h1 className="text-lg font-semibold">Não foi possível abrir o agente</h1><p className="my-3 text-sm text-neutral">Tente novamente para carregar suas configurações.</p><Button variant="outline" onClick={reset}>Tentar novamente</Button></div>;
}
