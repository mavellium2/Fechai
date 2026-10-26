export default function AgentsLoading() {
  return <div role="status" aria-label="Carregando agente" className="p-6"><span className="sr-only">Carregando agente…</span><div className="h-8 w-48 animate-pulse rounded-control bg-ink/5 motion-reduce:animate-none" /><div className="mt-10 grid grid-cols-2 gap-6 sm:grid-cols-4">{Array.from({ length: 8 }, (_, index) => <div key={index} className="h-28 animate-pulse rounded-surface bg-ink/5 motion-reduce:animate-none" />)}</div></div>;
}
