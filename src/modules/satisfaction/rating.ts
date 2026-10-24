/**
 * Lê a nota (1 a 5) de uma resposta à pesquisa. Puro e conservador: só mensagem
 * CURTA e inequívoca vira nota. "5 pessoas vão comigo" ou "preciso remarcar a
 * consulta das 4" não são nota — e o que não for nota segue o atendimento
 * normal, em vez de sumir dentro da pesquisa.
 */

const MAX_LENGTH = 32;
const STAR = /[⭐★🌟✨]/gu;

const WORDS: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5 };

const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");

/**
 * `replyId` é o id da linha da lista interativa da Meta (`rating_N`): vale
 * sozinho, não precisa do texto.
 */
export function parseRating(text: string, replyId?: string | null): number | null {
  if (replyId) {
    const m = /^rating_([1-5])$/.exec(replyId.trim());
    if (m) return Number(m[1]);
  }
  // U+FE0F (seletor de emoji) acompanha "⭐️" em vários teclados e não é conteúdo.
  const raw = (text ?? "").replace(/\uFE0F/g, "").trim();
  if (!raw || raw.length > MAX_LENGTH) return null;

  const stars = (raw.match(STAR) ?? []).length;
  const rest = normalize(raw.replace(STAR, " "))
    .replace(/[.!,;:()\-_*]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!rest) return stars >= 1 && stars <= 5 ? stars : null;

  // "5/5", "4 / 5"
  const outOf = /^([1-5]) ?\/ ?5$/.exec(rest);
  if (outOf && !stars) return Number(outOf[1]);

  // "nota 4", "4", "4 estrelas", "dou nota 5", "nota: 4 estrelas"
  const m = /^(?:(?:eu )?(?:dou |daria |foi )?nota )?([1-5]|um|uma|dois|duas|tres|quatro|cinco)(?: estrelas?)?$/.exec(rest);
  if (!m) return null;
  const token = m[1];
  const value = /^[1-5]$/.test(token) ? Number(token) : WORDS[token];
  // "um"/"uma" sozinhos são artigo, não nota: exigem "nota" ou "estrela".
  if ((token === "um" || token === "uma") && !/nota|estrela/.test(rest)) return null;
  // "4 ⭐⭐" (número e estrelas que não batem) é ambíguo; uma estrela só ao lado
  // do número ("5 ⭐") é enfeite.
  if (stars && stars !== value && stars !== 1) return null;
  return value;
}

/**
 * Pedido CLARO de parar de receber mensagens, durante a pesquisa. "Cancelar" não
 * está aqui de propósito: quem tem consulta marcada escreve "cancelar" para
 * desmarcar, e isso é assunto do agente (não pode virar `followUpReason: stop`).
 */
export function isOptOutText(text: string): boolean {
  const t = normalize(text ?? "").replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!t || t.length > 40) return false;
  return /^(pare|parar|pare de (me )?(enviar|mandar)( mensagens?)?|parar de receber( mensagens?)?|sair|sair da lista|stop|nao quero (mais )?(receber|mensagens?)|nao me (envie|mande) (mais )?mensagens?)$/.test(t);
}
