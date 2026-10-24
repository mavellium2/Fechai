import { Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { timeLabel } from "@/lib/format";

export type ThreadSurvey = {
  status: string;
  sentAt: Date;
  rating: number | null;
  comment: string | null;
  commentAudioUrl?: string | null;
  isTest: boolean;
};

const STATUS_TEXT: Record<string, string> = {
  sending: "Enviando a pergunta da nota…",
  awaiting_rating: "Aguardando a nota",
  awaiting_comment: "Nota recebida; aguardando o comentário",
  no_reply: "Sem resposta",
  unknown: "O WhatsApp não confirmou o envio",
};

/**
 * A pesquisa de satisfação na linha do tempo. Não é mensagem do contato nem do
 * agente: fica fora do histórico que o agente lê e dos números de atendimento,
 * então aparece aqui como um cartão à parte, no horário em que foi enviada.
 */
export function SurveyThreadCard({ survey }: { survey: ThreadSurvey }) {
  const rated = survey.rating !== null;
  return (
    <div
      role="note"
      aria-label="Pesquisa de satisfação"
      className="my-4 rounded-surface border border-white/10 bg-white/5 px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Star size={14} className="text-white/60" aria-hidden />
        <p className="font-mono text-micro uppercase tracking-[0.15em] text-white/60">
          Pesquisa de satisfação · {timeLabel(survey.sentAt)}
        </p>
        {survey.isTest && <Badge tone="neutral">teste</Badge>}
        {rated && <Badge tone={survey.rating! <= 2 ? "danger" : survey.rating === 3 ? "warn" : "success"}>nota {survey.rating}</Badge>}
      </div>
      {rated ? (
        survey.comment ? (
          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-white/85">“{survey.comment}”</p>
        ) : survey.commentAudioUrl ? (
          <audio controls preload="none" src={survey.commentAudioUrl} className="mt-2 h-9 w-full min-w-[220px]">
            <a href={survey.commentAudioUrl}>Baixar áudio</a>
          </audio>
        ) : (
          <p className="mt-2 text-sm text-white/55">Sem comentário.</p>
        )
      ) : (
        <p className="mt-2 text-sm text-white/60">{STATUS_TEXT[survey.status] ?? "Pesquisa enviada"}</p>
      )}
    </div>
  );
}
