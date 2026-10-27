"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { Button, ButtonLink } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { useActionToast } from "@/components/ui/toast/use-save-feedback";
import { dateTimeLabel } from "@/lib/format";
import type { HistoryRecoveryView } from "@/modules/whatsapp/history-recovery-types";
import { recoverWhatsappHistory } from "./history-recovery-actions";

const active = (run: HistoryRecoveryView | null) => run?.status === "queued" || run?.status === "running";

export function WhatsappHistoryRecovery({ initial }: { initial: HistoryRecoveryView | null }) {
  const router = useRouter();
  const [result, action, pending] = useActionState(recoverWhatsappHistory, null);
  useActionToast(result, pending, { entity: "recuperação do histórico", action: "create", gender: "f" });
  const [polled, setPolled] = useState<HistoryRecoveryView | null>(null);
  const [pollError, setPollError] = useState(false);
  const latest = result?.run ?? initial;
  const run = polled && (!latest || polled.id === latest.id || polled.updatedAt > latest.updatedAt) ? polled : latest;
  const running = active(run);
  const completion = useMemo(() => run?.status === "completed"
    ? { ok: true, info: `Varredura concluída: ${run.stats.imported} mensagens recuperadas. Confira as ressalvas no resultado.` }
    : run?.status === "failed" ? { ok: false, error: run.error ?? "A recuperação foi interrompida. Confira o resultado parcial." } : null,
  [run]);
  useActionToast(completion, false, { entity: "recuperação do histórico", gender: "f" });

  useEffect(() => {
    if (!running) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const response = await fetch("/api/whatsapp/historico", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("read failed");
        const data = await response.json() as { run: HistoryRecoveryView | null };
        if (stopped) return;
        setPolled(data.run);
        setPollError(false);
        if (!active(data.run)) { router.refresh(); return; }
      } catch {
        if (stopped) return;
        setPollError(true);
      }
      timer = setTimeout(poll, 3_000);
    };
    timer = setTimeout(poll, 1_000);
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  }, [running, run?.id, router]);

  const stats = run?.stats;
  const unresolved = stats ? stats.invalid + stats.unresolvedPhone + stats.unsupported + stats.ambiguousPhone : 0;
  const status = running ? "Recuperação em andamento" : run?.status === "completed"
    ? unresolved || stats?.mediaWithoutFile ? "Varredura concluída com ressalvas" : "Varredura concluída"
    : run?.status === "failed" ? "Recuperação interrompida" : null;

  return <Card className="space-y-4">
    <CardTitle>Recuperar histórico do WhatsApp</CardTitle>
    <p className="max-w-prose text-sm text-neutral panel:text-white/70">
      Confere todas as conversas do número por QR nos últimos 30 dias e recupera mensagens ausentes, inclusive de contatos que ainda não aparecem no Fechai.
      Mantém as datas originais, sem duplicar mensagens nem enviar respostas.
    </p>
    <p className="max-w-prose text-sm text-neutral panel:text-white/70">
      Só é possível recuperar o que ainda está guardado na origem. Áudios e anexos entram como registros, com legenda quando houver; seus arquivos não são recuperados aqui.
      O início aguarda dois minutos para terminar de receber mensagens ao vivo. Conversas novas ficam pausadas para revisão. O atendimento das conversas existentes é preservado.
    </p>
    <form action={action}>
      <Button type="submit" loading={pending || running} loadingLabel="Recuperando histórico">
        {run?.status === "failed" ? "Conferir novamente os últimos 30 dias" : "Recuperar últimos 30 dias"}
      </Button>
    </form>
    {run && stats && <div className="space-y-3" aria-live="polite">
      <p className="text-sm font-medium text-ink panel:text-white">{status}</p>
      <p className="text-sm text-neutral panel:text-white/70">{dateTimeLabel(new Date(run.since))} até {dateTimeLabel(new Date(run.until))}</p>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {[
          ["Registros conferidos", run.total === null ? `${stats.scanned}` : `${stats.scanned} de ${run.total}`],
          ["Mensagens recuperadas", stats.imported], ["Já estavam no Fechai", stats.existing], ["Para conferir", unresolved],
        ].map(([label, value]) => <div key={label}><dt className="text-neutral panel:text-white/70">{label}</dt><dd className="font-mono text-ink panel:text-white">{value}</dd></div>)}
      </dl>
      <p className="text-sm text-neutral panel:text-white/70">
        {stats.blocked} de bloqueados · {stats.test} de testes · {stats.survey} de pesquisas · {stats.ignored} de grupos ou eventos · {stats.outsideWindow} fora do período.
      </p>
      {!!unresolved && <p className="text-sm text-neutral panel:text-white/70">
        Não recuperadas: {stats.unresolvedPhone} sem telefone identificável, {stats.ambiguousPhone} com cadastro ambíguo, {stats.unsupported} com conteúdo não suportado e {stats.invalid} com dados inválidos ou conflito de identificação.
      </p>}
      {!!stats.mediaWithoutFile && <p className="text-sm text-neutral panel:text-white/70">{stats.mediaWithoutFile} registros de mídia sem o arquivo original.</p>}
      {run.error && <Alert tone="warn" title="Resultado parcial">{run.error}</Alert>}
      {pollError && <Alert tone="warn" title="Atualização indisponível">A recuperação continua no servidor. Esta tela tentará atualizar novamente.</Alert>}
      <ButtonLink href="/conversas" variant="outline" size="sm">Ver conversas</ButtonLink>
    </div>}
  </Card>;
}
