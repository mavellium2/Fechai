export default function Loading() {
  return <div className="conversations-workspace" role="status" aria-label="Carregando conversas"><aside className="conversation-sidebar"><div className="p-6"><div className="h-6 w-32 animate-pulse rounded bg-neutral/15" />{[1, 2, 3].map(i => <div key={i} className="mt-8 h-20 animate-pulse rounded bg-neutral/10" />)}</div></aside><div className="conversation-empty"><p className="text-sm text-neutral">Carregando o atendimento...</p></div></div>;
}
