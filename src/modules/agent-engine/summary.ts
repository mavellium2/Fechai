import { prisma } from "@/lib/prisma";
import {
  AiError,
  isAiError,
  createProvider,
  getUsableChain,
  resolveSecret,
  type LlmMessage,
} from "@/modules/ai";
import { recordUsage } from "@/modules/ai/usage";
import { splitSummaryAndVariables, variableExtractionPrompt } from "./summary-variables";
import {
  allVariableDefinitions,
  parseConversationVariables,
  parseVariableDefinitions,
  withContactDefaults,
} from "./variables";

/**
 * Resumo de conversa — "o que rolou aqui, em 30 segundos".
 *
 * O painel já mostrava a conversa inteira, o que resolve o caso de 6 mensagens
 * e falha no de 60: para saber se o cliente quer orçamento, já visitou o imóvel
 * ou está só pesquisando, o dono da conta precisava ler tudo de novo a cada
 * vez que reabria. Este módulo gera esse resumo com o LLM ativo.
 *
 * Decisões que valem registrar:
 *
 * - **Sob demanda, não a cada turno.** Resumir dentro de `runAgentTurn`
 *   dobraria o custo de tokens de TODA mensagem recebida (e o consumo conta na
 *   cota do plano, ver `modules/billing/usage.ts`) para produzir um resumo que
 *   ninguém talvez leia. Aqui quem paga o resumo é quem pede.
 * - **Cache com contagem de mensagens** (`summaryMsgCount`), não só data: é o
 *   que deixa a interface dizer "há 4 mensagens novas desde o resumo" sem
 *   gastar uma chamada para descobrir. Um resumo em cache que não sabe estar
 *   velho é pior do que resumo nenhum.
 * - **Sem tools.** É uma chamada de leitura pura; passar os schemas de ação
 *   abriria espaço para o modelo tentar agendar reunião no meio de um resumo.
 * - **Preenche as variáveis da conversa de quebra.** As variáveis só se
 *   preenchem quando o agente chama `remember_variables` durante o turno, então
 *   conversa antiga (ou atendida à mão, ou anterior à variável ser criada)
 *   fica com tudo "não informado" mesmo tendo o dado escrito no histórico.
 *   Resumir já relê a conversa inteira: pedir os valores no MESMO retorno
 *   recupera esse passado sem uma segunda chamada paga. Ver `extractVariables`.
 */

/** Abaixo disto não há o que resumir — ler as mensagens é mais rápido. */
export const MIN_MESSAGES_TO_SUMMARIZE = 4;

/** Teto de mensagens enviadas ao modelo: as N mais recentes é o que importa. */
const MAX_MESSAGES_IN_PROMPT = 60;

const SYSTEM_PROMPT = `Você resume conversas de atendimento por WhatsApp para o dono do negócio, que vai ler o resumo antes de responder ao cliente.

Escreva em português do Brasil, direto, sem saudação e sem repetir o nome do cliente a cada frase. Use no máximo 6 linhas, neste formato:

O que o cliente quer: <uma frase>
Onde parou: <uma frase — a última coisa combinada ou pendente>
Próximo passo: <o que o dono do negócio precisa fazer, ou "nada, o agente segue">

Se algo relevante apareceu na conversa (orçamento citado, data marcada, objeção, reclamação), acrescente uma linha começando com "Atenção:".

Regras: não invente informação que não está na conversa; não repita as mensagens; se a conversa não tem conteúdo suficiente, diga isso em uma linha.`;

export type SummaryResult =
  | { ok: true; summary: string; summaryAt: Date; messageCount: number }
  | { ok: false; error: string };

/**
 * Gera (ou regenera) o resumo de uma conversa e grava em cache.
 *
 * `tenantId` entra no `where` — nunca resume conversa de outra conta, mesmo
 * que o id venha de fora da interface.
 */
export async function summarizeConversation(
  tenantId: string,
  conversationId: string,
): Promise<SummaryResult> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId },
    select: {
      id: true,
      variables: true,
      lead: { select: { name: true, phone: true } },
      agent: { select: { id: true, variableDefinitions: true } },
      _count: { select: { messages: true } },
    },
  });
  if (!conversation) return { ok: false, error: "Conversa não encontrada." };

  if (conversation._count.messages < MIN_MESSAGES_TO_SUMMARIZE) {
    return {
      ok: false,
      error: `A conversa ainda é curta demais para um resumo — leia as ${conversation._count.messages} mensagens acima.`,
    };
  }

  // As mais recentes, mas apresentadas ao modelo em ordem cronológica: pedir
  // "resuma" com o histórico de trás para frente produz resumo invertido.
  const recent = await prisma.message.findMany({
    where: { conversationId, role: { in: ["user", "assistant"] } },
    orderBy: { createdAt: "desc" },
    take: MAX_MESSAGES_IN_PROMPT,
    select: { role: true, content: true, sentBy: true },
  });
  const ordered = recent.reverse();

  const who = conversation.lead.name?.trim() || "Cliente";
  const transcript = ordered
    .map((m) => {
      const speaker =
        m.role === "user" ? who : m.sentBy === "human" ? "Atendente (humano)" : "Agente (IA)";
      return `${speaker}: ${m.content}`;
    })
    .join("\n");

  // Só pede o que esta conversa ainda não sabe: variável já preenchida pelo
  // agente durante o turno vale mais que uma releitura, e listá-la só gastaria
  // tokens para receber de volta o que já está no banco.
  const known = withContactDefaults(
    parseConversationVariables(conversation.variables),
    conversation.lead,
  );
  const missing = allVariableDefinitions(parseVariableDefinitions(conversation.agent?.variableDefinitions))
    .filter((item) => item.key !== "numero" && !known[item.key]);

  const messages: LlmMessage[] = [
    { role: "system", content: SYSTEM_PROMPT + variableExtractionPrompt(missing) },
    { role: "user", content: `Conversa a resumir:\n\n${transcript}` },
  ];

  let text: string;
  try {
    text = await completeBackgroundText(messages);
  } catch (err) {
    if (!isAiError(err)) throw err;
    console.error(`[summary] IA indisponível (${err.code}) ao resumir ${conversationId}`, err);
    return { ok: false, error: err.userMessage };
  }

  const { summary, values } = splitSummaryAndVariables(text, missing);
  if (!summary) return { ok: false, error: "A IA não devolveu um resumo. Tente de novo." };

  const summaryAt = new Date();
  // SQL cru, e não `prisma.conversation.update`: `updatedAt` tem `@updatedAt`,
  // então qualquer escrita pelo client o reescreveria. Essa coluna é "última
  // atividade da conversa" e ordena a caixa de entrada — gerar um resumo não
  // pode empurrar a conversa para o topo como se o cliente tivesse escrito.
  // O `tenantId` continua no WHERE: nunca escreve fora da conta.
  await prisma.$executeRaw`
    UPDATE "Conversation"
    SET "summary" = ${summary},
        "summaryAt" = ${summaryAt},
        "summaryMsgCount" = ${conversation._count.messages}
    WHERE "id" = ${conversationId} AND "tenantId" = ${tenantId}
  `;

  // Depois do resumo, e nunca no lugar dele: a extração é um brinde da mesma
  // chamada, então falha dela não pode derrubar o que o dono pediu. `known`
  // vem por último de propósito — se o agente guardou o valor ao vivo durante
  // a geração, é ele que vale, não a releitura.
  if (Object.keys(values).length) {
    try {
      await prisma.conversation.updateMany({
        where: { id: conversationId, tenantId },
        data: { variables: { ...values, ...known } },
      });
      // Mesma regra de `rememberConversationVariables`: {{nome}} e o nome do
      // contato são a mesma informação em dois lugares. Gravar só a variável
      // deixaria a lista de contatos com o nome antigo do perfil.
      if (values.nome && !known.nome) {
        await prisma.lead.updateMany({
          where: { tenantId, conversation: { id: conversationId }, nameEditedAt: null },
          data: { name: values.nome },
        });
      }
    } catch (err) {
      console.error(`[summary] variáveis extraídas não foram salvas em ${conversationId}`, err);
    }
  }

  return { ok: true, summary, summaryAt, messageCount: conversation._count.messages };
}

/**
 * Mesma cadeia do orquestrador, sem tools e sem loop: um resumo é uma única
 * chamada de texto. Percorre `getUsableChain()` — a ordem e as credenciais que
 * o admin montou em /admin/ia — para o resumo não ficar numa cadeia própria,
 * ignorando a configuração do painel.
 *
 * Diferença deliberada do caminho do atendimento: aqui NÃO se marca quarentena
 * na credencial. Resumo é trabalho de segundo plano; deixar uma chave de molho
 * por causa dele penalizaria o atendimento, que é o que importa.
 *
 * Exportada porque o follow-up escrito pela IA (`modules/follow-up/compose.ts`)
 * é o mesmo tipo de chamada: uma frase, fora do turno de atendimento.
 */
export async function completeBackgroundText(messages: LlmMessage[]): Promise<string> {
  const chain = await getUsableChain();
  let lastErr: unknown = null;

  for (const step of chain) {
    const apiKey = await resolveSecret(step.model.provider, step.credentialId);
    const provider = createProvider(step.model, apiKey);
    if (!provider.isConfigured()) continue;
    try {
      const result = await provider.complete(messages, []);
      recordUsage(provider.provider, result.usage).catch(() => {});
      return result.content;
    } catch (e) {
      if (!isAiError(e)) throw e;
      lastErr = e;
    }
  }

  // Mesmo motivo do orquestrador: cadeia vazia/sem credencial é `AiError` de
  // configuração, para o chamador devolver `{ ok: false }` em vez de estourar.
  throw (
    lastErr ??
    new AiError("auth", "Nenhum provedor de IA disponível para a tarefa de segundo plano.", {
      provider: chain[0]?.model.provider ?? "openai",
      model: chain[0]?.model.id ?? "-",
    })
  );
}
