import { isOptOutText } from "@/modules/satisfaction/rating";

/**
 * Texto de botão de modelo que pede para **parar de receber** ("Bloquear",
 * "Parar mensagens", "Sair"…). Só vale para o toque no botão: é um pedido
 * explícito, sem a ambiguidade de uma frase solta. "Cancelar" fica de fora de
 * propósito — quem tem consulta marcada escreve "cancelar" para desmarcar, e
 * isso é assunto do agente.
 *
 * Puro (sem banco): o editor de modelos usa a mesma regra para avisar quem
 * cria o botão, e o webhook para tratar o toque.
 */
const BLOCK_BUTTON =
  /^(bloquear|bloquear mensagens?|bloquear contato|descadastrar|parar mensagens?|parar envios?|nao quero receber|nao receber mais|cancelar inscricao|cancelar recebimento)$/;

const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function isBlockButton(text: string): boolean {
  return isOptOutText(text ?? "") || BLOCK_BUTTON.test(normalize(text ?? ""));
}
