"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
export default function Error({ reset }: { reset: () => void }) {
  return <div className="conversation-empty"><div className="p-8 text-center" role="alert"><h1 className="text-xl font-semibold">Não foi possível carregar as conversas</h1><p className="my-4 text-sm text-neutral">Tente novamente para continuar o atendimento.</p><Button onClick={reset}>Tentar novamente</Button><Link href="/inicio" className="mt-4 block text-sm text-iris">Voltar ao início</Link></div></div>;
}
