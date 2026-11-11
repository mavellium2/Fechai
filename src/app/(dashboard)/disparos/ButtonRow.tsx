import { ExternalLink, Reply } from "lucide-react";
import type { TemplateButton } from "@/modules/broadcasts/template-buttons";

/**
 * Botões do modelo como o WhatsApp mostra: faixas abaixo do balão, com o ícone
 * do tipo (resposta ou link). Só visual — nada aqui é clicável.
 */
export function ButtonRow({ buttons }: { buttons?: TemplateButton[] }) {
  if (!buttons?.length) return null;
  return (
    <ul className="mt-1 space-y-1" aria-label="Botões da mensagem">
      {buttons.map((b, i) => (
        <li
          key={i}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-sm font-medium text-iris shadow-sm"
        >
          {b.type === "URL" ? <ExternalLink size={14} aria-hidden /> : <Reply size={14} aria-hidden />}
          <span className="truncate">{b.text}</span>
        </li>
      ))}
    </ul>
  );
}
