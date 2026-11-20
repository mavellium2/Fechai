import type { ContactContextSummary as Summary } from "@/modules/reports/contact-context";
import { formatCount, formatPercent } from "@/modules/reports/monthly-format";
import { Card, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";

export function ContactContextSummary({ summary }: { summary: Summary }) {
  const autonomy = summary.autonomy;
  return <Card>
    <CardTitle hint="Cada contato aparece uma vez, pelo início da atividade no período. A taxa usa os contatos e as avaliações do mesmo grupo.">Quem iniciou, quem resolveu e o que virou agendamento</CardTitle>
    <DataTable caption="Conversão e resolução por contexto"
      head={["Contexto", "Contatos", "Atendidos", "Só IA", "IA + humano", "Só humano", "Contatos que agendaram", "Conversão"]}
      headerAlign="left" columnAlign={["left", "right", "right", "right", "right", "right", "right", "right"]}
      rows={summary.groups.filter((g) => g.contacts > 0).map((g) => ({ id: g.key, cells: [g.label, formatCount(g.contacts), formatCount(g.attended),
        formatCount(g.aiOnly), formatCount(g.aiAndHuman), formatCount(g.humanOnly),
        formatCount(g.scheduledContacts), formatPercent(g.conversionPercent)] }))} />
    {autonomy && <p className="mt-3 text-sm text-ink panel:text-white/85">
      Resolução autônoma: <strong>{formatPercent(autonomy.percent)}</strong>{autonomy.base > 0 && <> — {formatCount(autonomy.aiOnly)} de {formatCount(autonomy.base)} conversas que o paciente iniciou e foram respondidas ({formatCount(autonomy.aiAndHuman)} com IA e equipe, {formatCount(autonomy.humanOnly)} só com a equipe)</>}.
    </p>}
    <p className="mt-3 text-sm text-neutral panel:text-white/60">Só IA: só o agente respondeu, sem pessoa nem transferência registrada. IA + humano: o agente respondeu e a equipe também entrou (ou recebeu a transferência). Só humano: só a equipe respondeu. A resolução autônoma usa apenas conversas iniciadas pelo paciente; abordagens da equipe, campanhas, lembretes e retomadas ficam fora da base.</p>
    <p className="mt-2 text-sm text-neutral panel:text-white/60">Contatos incluem quem não respondeu ou não recebeu resposta. Agendaram conta pessoas, uma vez por grupo, com avaliação criada pelo agente após a entrada do contato. Lembretes e abordagens não são novas entradas, e envio automático (lembrete, disparo, retomada) não conta como resposta da equipe.</p>
    <p className="mt-2 text-sm text-neutral panel:text-white/60">Origem de aquisição não registrada: entrada espontânea não comprova anúncio; contato antigo não comprova base qualificada. Finalidade das abordagens da equipe depende de registro, sem inferência pelo texto.</p>
    {summary.unattributedEvaluations > 0 && <p className="mt-2 text-sm text-neutral panel:text-white/60">{formatCount(summary.unattributedEvaluations)} avaliações sem vínculo com uma entrada anterior nesta janela ficam fora destas taxas.</p>}
  </Card>;
}
