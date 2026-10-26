import Link from "next/link";

export default function AgentNotFound() {
  return <div className="agents-empty"><h1 className="text-lg font-semibold">Agente não encontrado</h1><p className="my-3 text-sm text-neutral">Escolha um dos seus agentes para continuar.</p><Link href="/agentes" className="text-iris underline underline-offset-4">Ver meus agentes</Link></div>;
}
