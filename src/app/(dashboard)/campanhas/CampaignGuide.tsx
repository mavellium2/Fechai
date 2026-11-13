"use client";

import { useEffect, useState } from "react";
import { BookOpen, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SidePanel } from "@/components/ui/side-panel";

/**
 * O tutorial da aba Campanhas, em linguagem de quem usa: o que é uma campanha,
 * os passos para montar uma e um exemplo real. Abre de qualquer tela de
 * campanha pelo botão "Como funciona".
 */
function GuideContent() {
  return (
    <div className="space-y-6 text-sm text-ink panel:text-white/90">
      <section className="space-y-2">
        <h3 className="font-display text-base font-semibold">O que é uma campanha</h3>
        <p>
          Uma ação de marketing com começo e fim — um evento, uma promoção, uma leva de anúncios. Ela junta num lugar só de onde
          vêm os contatos, como o agente atende esses contatos e qual foi o resultado.
        </p>
        <p>Só os contatos da campanha são afetados, e só enquanto ela está ativa. Os outros seguem o atendimento de sempre.</p>
      </section>

      <section className="space-y-3">
        <h3 className="font-display text-base font-semibold">Como montar, passo a passo</h3>
        <ol className="space-y-3">
          {[
            ["O básico", "Nome, objetivo e período. A campanha só vale dentro das datas."],
            [
              "Quem atende",
              "Escolha o agente. O melhor é criar uma cópia do agente de sempre só para a campanha: você ajusta o jeito de falar sem mexer no original.",
            ],
            ["Agenda da campanha", "Se o evento é em dias e horários fixos, diga quais. O agente só oferece esses, e o sistema recusa qualquer outro."],
            ["De onde vêm os leads", "Vincule os anúncios, escolha palavras-chave (ex.: IMPLANTE) ou disparos. Quem chega por eles entra na campanha sozinho."],
            ["Arquivos (opcional)", "Folder, vídeo ou PDF que o agente pode mandar na conversa."],
            ["Revisar e ativar", "Confira o resumo e ative. Antes de ativar, nada muda no atendimento."],
          ].map(([title, text], index) => (
            <li key={title} className="flex gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-iris/15 font-mono text-sm text-iris panel:text-white">
                {index + 1}
              </span>
              <span>
                <strong className="block font-medium">{title}</strong>
                <span className="text-neutral panel:text-white/60">{text}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-2 rounded-control border border-ink/10 p-4 panel:border-white/15">
        <h3 className="font-display text-base font-semibold">Exemplo: evento de implantes</h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>Período: 01 a 19/11. Agente: cópia da Paula, chamada “Paula – Implantes”.</li>
          <li>Agenda: só 18 e 19/11 às 09:00, 40 vagas por horário, “chegar às 08h40”, lembretes desligados.</li>
          <li>Se o contato não puder: transferir para a equipe.</li>
          <li>Leads: o anúncio AD37 e a palavra-chave IMPLANTE.</li>
        </ul>
        <p className="text-neutral panel:text-white/60">
          Quem pedir dia 20 ouve as opções 18 ou 19. Depois do dia 19 tudo volta ao normal sozinho.
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="font-display text-base font-semibold">Depois da campanha</h3>
        <p>
          Em Configuração › Quem atende, “Levar para o agente original” mostra o que a cópia aprendeu (documentos e perguntas
          respondidas) para você escolher o que passa para o agente de sempre.
        </p>
      </section>
    </div>
  );
}

export function CampaignGuideButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="ghost" className="max-sm:h-11" onClick={() => setOpen(true)}>
        <BookOpen size={16} aria-hidden />
        Como funciona
      </Button>
      <SidePanel open={open} onClose={() => setOpen(false)} title="Como funciona uma campanha" subtitle="Leva dois minutos de leitura.">
        <GuideContent />
      </SidePanel>
    </>
  );
}

const DISMISS_KEY = "fechai:campanhas:guia-fechado";

/**
 * Cartão de boas-vindas da lista: aparece até a pessoa fechar (fica guardado
 * no navegador). Sem acesso ao armazenamento, aparece sempre — nunca quebra.
 */
export function CampaignIntro() {
  const [hidden, setHidden] = useState(true);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      dismissed = false;
    }
    const frame = requestAnimationFrame(() => setHidden(dismissed));
    return () => cancelAnimationFrame(frame);
  }, []);
  if (hidden) return null;
  return (
    <Card className="relative p-4 sm:p-6">
      <button
        type="button"
        aria-label="Fechar o guia"
        className="absolute right-2 top-2 inline-flex size-11 items-center justify-center rounded-full text-neutral hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris panel:text-white/60 panel:hover:text-white"
        onClick={() => {
          try {
            window.localStorage.setItem(DISMISS_KEY, "1");
          } catch {
            /* sem armazenamento: só esconde agora */
          }
          setHidden(true);
        }}
      >
        <X size={16} aria-hidden />
      </button>
      <h2 className="pr-12 font-display text-lg font-semibold text-ink panel:text-white">Como as campanhas funcionam</h2>
      <p className="mt-2 max-w-prose text-sm text-neutral panel:text-white/60">
        Crie a campanha, escolha quem atende, diga os dias e horários do evento e de onde vêm os contatos. Ative, e o agente passa a
        seguir essas regras só com os contatos da campanha, até a data de fim.
      </p>
      <Button type="button" variant="outline" size="sm" className="mt-4 max-sm:h-11" onClick={() => setOpen(true)}>
        <BookOpen size={16} aria-hidden />
        Ver o passo a passo com exemplo
      </Button>
      <SidePanel open={open} onClose={() => setOpen(false)} title="Como funciona uma campanha" subtitle="Leva dois minutos de leitura.">
        <GuideContent />
      </SidePanel>
    </Card>
  );
}
