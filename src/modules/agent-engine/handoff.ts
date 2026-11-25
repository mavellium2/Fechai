import { prisma } from "@/lib/prisma";
import { crmOriginLabel } from "@/modules/crm/lead-origin";
import { getWhatsAppProviderForInstance } from "@/modules/whatsapp/meta-config";
import {
  findWhatsappChannel,
  isReadyChannel,
  listWhatsappChannels,
  pickWhatsappChannel,
} from "@/modules/whatsapp/instances";
import type { WhatsAppGroup } from "@/modules/whatsapp/provider";
import { openHandoffNotice, recordHandoffNoticeSent, type HandoffTrigger } from "./handoff-notice";

/**
 * Configuração da ação "Transferir para humano", guardada em `TenantAction.config`
 * (chave `handoff_human`) — mesmo padrão de `follow-up/config.ts` para
 * "Follow-up automático" e `scheduling/config.ts` para "Agendar horário".
 *
 * Quando `notifyGroup` está ligado, a equipe recebe um aviso num grupo fixo do
 * WhatsApp (cadastrado aqui pelo `groupId`) no momento em que a conversa vira
 * "precisa de você" — reação do atendente ou a tool `handoff_human` chamada
 * pelo agente. O grupo é o mesmo para toda transferência
 * deste agente (não um grupo novo por atendimento): normalmente é o grupo onde
 * a equipe de atendimento já está.
 */
export type HandoffConfig = {
  /** Avisar a equipe no grupo interno, sem adicionar o contato. */
  notifyGroup: boolean;
  /** JID do grupo (`...@g.us`), escolhido na lista de grupos do número ou colado à mão. */
  groupId: string | null;
  /** Nome do grupo quando foi escolhido na lista. Só exibição: quem vale é o `groupId`. */
  groupName: string | null;
  /**
   * Quando o agente deve transferir e avisar a equipe no grupo, nas
   * palavras do dono da conta. Vai para a descrição da tool `handoff_human`
   * (`handoffToolDescription`). Vazio: o agente decide sozinho, como antes.
   */
  groupReason: string;
  /**
   * O que a IA faz enquanto a conversa espera alguém da equipe (CRM-06):
   * `continue` (padrão, o comportamento de sempre) ou `pause` (para de
   * responder até alguém devolver a conversa para o agente).
   */
  whileWaiting: HandoffWhileWaiting;
};

export type HandoffWhileWaiting = "continue" | "pause";

export const MAX_GROUP_NAME = 100;
export const MAX_GROUP_REASON = 500;

export const DEFAULT_HANDOFF_CONFIG: HandoffConfig = {
  notifyGroup: false,
  groupId: null,
  groupName: null,
  groupReason: "",
  whileWaiting: "continue",
};

/** Aceita o JID completo (`120363...@g.us`) ou só os dígitos, e normaliza. */
export function normalizeGroupId(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withSuffix = trimmed.endsWith("@g.us") ? trimmed : `${trimmed}@g.us`;
  const digits = withSuffix.slice(0, -"@g.us".length);
  // JID de grupo é dígitos, opcionalmente com "-" (grupos antigos da Evolution).
  if (!/^\d[\d-]*$/.test(digits)) return null;
  return withSuffix;
}

/**
 * Lê o Json cru do banco com default. Nunca lança: config pode ser null (ação
 * recém-criada), de antes deste campo existir, ou editada à mão.
 */
export function parseHandoffConfig(raw: unknown): HandoffConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const groupId =
    typeof c.groupId === "string" ? normalizeGroupId(c.groupId) : null;
  const groupName =
    groupId && typeof c.groupName === "string" && c.groupName.trim()
      ? c.groupName.trim().slice(0, MAX_GROUP_NAME)
      : null;
  return {
    // Sem grupo cadastrado, a opção não pode estar ligada — evita um toggle
    // "ligado" que na prática não envia nenhum aviso. A chave antiga é lida
    // apenas para preservar a opção e o grupo já configurados, nunca convites.
    notifyGroup: (typeof c.notifyGroup === "boolean" ? c.notifyGroup : c.addToGroup === true) && Boolean(groupId),
    groupId,
    groupName,
    groupReason:
      typeof c.groupReason === "string" ? c.groupReason.trim().slice(0, MAX_GROUP_REASON) : "",
    // Só "pause" explícito pausa: valor ausente, antigo ou estranho mantém a IA
    // respondendo, que é o que toda conta fazia antes desta opção existir.
    whileWaiting: c.whileWaiting === "pause" ? "pause" : "continue",
  };
}

/** Resumo em uma linha — usado no card da ação, fechado. */
export function describeHandoff(cfg: HandoffConfig): string {
  const pause = cfg.whileWaiting === "pause" ? " e pausa a IA" : "";
  if (!cfg.notifyGroup || !cfg.groupId) return `marca a conversa como “precisa de você”${pause}`;
  return cfg.groupName
    ? `também avisa a equipe no grupo “${cfg.groupName}”${pause}`
    : `também avisa a equipe em um grupo do WhatsApp${pause}`;
}

const HANDOFF_TOOL_BASE = "Transfere a conversa para um atendente humano. Use quando o contato pedir uma pessoa, quando houver uma pergunta que você não pode responder com a base disponível ou quando a equipe precisar tomar uma decisão. Não marque prioridade apenas porque o contato demonstrou interesse.";

/**
 * Descrição da tool `handoff_human` que o LLM lê. É por ela que o motivo
 * escrito pelo dono chega ao agente: sem isso, "quando mandar para o grupo"
 * dependia de alguém lembrar de repetir a regra na persona.
 *
 * "Use sempre que" e não "use só quando": o motivo acrescenta um gatilho, não
 * proíbe os outros — quem pede para falar com uma pessoa continua sendo
 * transferido. Só vale com o grupo ligado, porque o campo mora dentro dessa
 * opção na tela; desligada, o texto fica guardado e sem efeito.
 */
export function handoffToolDescription(cfg?: HandoffConfig): string {
  // Com a pausa, esta é a última resposta da IA na conversa: ela precisa saber
  // disso para despedir-se em vez de prometer o que não vai mais responder.
  const pause = cfg?.whileWaiting === "pause"
    ? " Depois de transferir, você não responde mais nesta conversa até a equipe devolvê-la: diga ao contato que alguém da equipe vai continuar o atendimento."
    : "";
  if (!cfg?.notifyGroup || !cfg.groupId) return `${HANDOFF_TOOL_BASE}${pause}`;
  const reason = cfg.groupReason.replace(/\s+/g, " ").replace(/[\s.;]+$/, "");
  const trigger = reason ? ` Use sempre que: ${reason}.` : "";
  return `${HANDOFF_TOOL_BASE}${trigger} Ao transferir, envia um aviso com nome, número, origem, resumo e motivo ao grupo interno da equipe no WhatsApp. O contato nunca é adicionado ao grupo. Informe no motivo o que o contato quer e por que precisa de prioridade.${pause}`;
}

export type GroupListResult =
  | { ok: true; groups: WhatsAppGroup[] }
  | {
      ok: false;
      /**
       * `unsupported`: a conexão não tem grupos (Meta) — colar o ID não
       * adiantaria. Os outros dois são passageiros, e a tela oferece o ID à mão.
       */
      reason: "unsupported" | "disconnected" | "failed";
      error: string;
    };

/**
 * Grupos do número conectado, para a tela da transferência. **Nunca lança**:
 * a lista é conveniência — Evolution fora do ar não pode impedir de salvar a
 * transferência, só obriga a colar o ID.
 */
export async function listWhatsAppGroups(tenantId: string): Promise<GroupListResult> {
  try {
    // Grupo só existe no número conectado por QR code: com as duas conexões, é
    // a Evolution que responde, e a Meta de pé não a substitui.
    const channels = await listWhatsappChannels(tenantId);
    const instance = pickWhatsappChannel(channels, "evolution");
    if (!instance?.externalId) {
      if (channels.some(isReadyChannel)) {
        return {
          ok: false,
          reason: "unsupported",
          error:
            "Só a API oficial da Meta está conectada, e ela não dá acesso a grupos. Avisar a equipe em um grupo só funciona com o número conectado por QR code — conecte-o em Integrações. Enquanto isso, o transbordo continua no Fechai: o card vai para Aguardando humano e a conversa aparece em Precisa de você.",
        };
      }
      return {
        ok: false,
        reason: "disconnected",
        error: "O WhatsApp não está conectado, então não dá para listar os grupos agora.",
      };
    }
    const provider = getWhatsAppProviderForInstance(instance);
    if (!provider.listGroups) {
      return {
        ok: false,
        reason: "unsupported",
        error:
          "Esta conexão não dá acesso a grupos. Avisar a equipe em um grupo só funciona com o número conectado por QR code.",
      };
    }
    if (!provider.isConfigured()) {
      return { ok: false, reason: "failed", error: "Não foi possível buscar os grupos do WhatsApp agora." };
    }
    return { ok: true, groups: await provider.listGroups(instance.externalId) };
  } catch (err) {
    console.error("[handoff] falha ao listar grupos do WhatsApp", err);
    return { ok: false, reason: "failed", error: "Não foi possível buscar os grupos do WhatsApp agora." };
  }
}

/** Config de transferência do agente (ou o padrão, se a ação nunca foi tocada). */
export async function getHandoffConfig(agentId: string): Promise<HandoffConfig> {
  const action = await prisma.tenantAction.findUnique({
    where: { agentId_key: { agentId, key: "handoff_human" } },
    select: { config: true },
  });
  return parseHandoffConfig(action?.config);
}

/**
 * A config **e** se a ação está ligada. Separada de `getHandoffConfig` (que a
 * tela usa para preencher o formulário mesmo com a ação desligada — desligar
 * não pode apagar o que foi configurado) porque quem vai AGIR precisa das duas
 * respostas: uma ação desligada não envia avisos ao grupo.
 */
async function getActiveHandoffConfig(tenantId: string, agentId: string): Promise<HandoffConfig | null> {
  const action = await prisma.tenantAction.findUnique({
    where: { agentId_key: { agentId, key: "handoff_human" }, tenantId },
    select: { enabled: true, config: true },
  });
  if (!action?.enabled) return null;
  return parseHandoffConfig(action.config);
}

export async function saveHandoffConfig(
  tenantId: string,
  agentId: string,
  config: HandoffConfig,
): Promise<void> {
  await prisma.tenantAction.upsert({
    where: { agentId_key: { agentId, key: "handoff_human" } },
    // Salvar a config não liga a ação sozinha — quem liga é o toggle.
    create: { tenantId, agentId, key: "handoff_human", enabled: false, config },
    update: { config },
  });
}

/**
 * Pausa a IA ao transferir? Só com a ação ligada e a opção "pausa" escolhida
 * (CRM-06). **Nunca lança**: na dúvida a IA continua respondendo, que é o
 * comportamento de sempre.
 */
export async function handoffPausesAgent(tenantId: string, agentId: string | null | undefined): Promise<boolean> {
  if (!agentId) return false;
  try {
    return (await getActiveHandoffConfig(tenantId, agentId))?.whileWaiting === "pause";
  } catch (err) {
    console.error("[handoff] falha ao ler a pausa da transferência", err);
    return false;
  }
}

/**
 * Liga os comandos do grupo na linha final do aviso ("assumo", 👍 e "#ia"),
 * lidos por `crm/handoff-group.ts` (CRM-08) no webhook da Evolution.
 */
export const HANDOFF_GROUP_COMMANDS = true;

/** Base do link do card. `null` sem a URL do app configurada (o aviso sai sem link). */
export function panelBaseUrl(): string | null {
  const configured = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL;
  return configured ? configured.trim().replace(/\/+$/, "") : null;
}

/**
 * Registra o transbordo (`HandoffNotice`) e avisa a equipe no grupo interno do
 * agente, se a ação "Transferir para humano" estiver LIGADA e configurada para
 * isso. Chamado quando a tool `handoff_human` (ou a fila de perguntas, ou a
 * regra da campanha) transfere a conversa, e quando o atendente reage pelo
 * próprio número do WhatsApp para assumi-la.
 *
 * A espera é registrada mesmo sem grupo (conta só com a Meta, aviso desligado):
 * o transbordo acontece no Fechai de qualquer jeito. Com uma espera já aberta
 * para a conversa, nenhum aviso novo vai ao grupo — só a espera é atualizada.
 * O id da mensagem enviada fica em `HandoffNotice.messageId`.
 *
 * **Nunca lança**, e por isso o `try` cobre as consultas ao banco também, não
 * só a chamada de rede. Mesma regra do resto de `scheduling`/`voice`: nada aqui
 * pode impedir a transferência para humano de acontecer — a conversa já foi
 * marcada `needsHuman`, e é isso que importa. No webhook, deixar escapar uma
 * exceção seria pior que perder o aviso: a rota devolveria 500 e a Evolution
 * reentregaria a mesma mensagem em laço.
 *
 * **Conversa de teste não entra** (`isTest`): o sandbox usa um telefone
 * sintético, e enviar um aviso a um grupo de verdade poluiria o grupo da equipe com
 * um número que não existe — mesma regra do worker de follow-up e do envio de
 * resposta, que também não falam com o WhatsApp em teste.
 */
export async function notifyHandoffGroup(
  tenantId: string,
  agentId: string | null,
  conversationId: string,
  options: { isTest?: boolean; reason?: string; trigger?: HandoffTrigger } = {},
): Promise<void> {
  if (options.isTest) return;

  try {
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      select: {
        isTest: true,
        summary: true,
        leadId: true,
        tenant: { select: { crmEnabled: true, status: true } },
        lead: { select: { name: true, phone: true, isTest: true, originChannel: true, adOrigin: { select: { tenantId: true } } } },
        messages: {
          where: { role: "user" },
          orderBy: { createdAt: "desc" },
          take: 3,
          select: { content: true },
        },
      },
    });
    if (!conversation || conversation.isTest || conversation.lead.isTest) return;

    const notice = await openHandoffNotice({
      tenantId, conversationId, trigger: options.trigger ?? "agent", reason: options.reason,
    });
    // Espera já aberta: a equipe já foi avisada deste contato.
    if (notice && !notice.created) return;
    if (!agentId) return;

    const config = await getActiveHandoffConfig(tenantId, agentId);
    if (!config?.notifyGroup || !config.groupId) return;

    // O grupo é do número conectado por QR code, seja qual for o número por
    // onde o contato falou: a equipe recebe o aviso no grupo que já usa.
    const instance = await findWhatsappChannel(tenantId, "evolution");
    if (!instance?.externalId) return;

    const provider = getWhatsAppProviderForInstance(instance);
    if (!provider.sendGroupMessage || !provider.isConfigured()) return;

    // Reusa o resumo salvo; se ainda não existe, usa as últimas falas reais.
    // Não gera uma segunda chamada de IA só para notificar a equipe.
    const summary = conversation.summary?.trim() || conversation.messages
      .map((m) => m.content).reverse().join(" · ");
    const base = panelBaseUrl();
    const crmOn = conversation.tenant.crmEnabled && conversation.tenant.status === "active";
    const messageId = await provider.sendGroupMessage(
      instance.externalId,
      config.groupId,
      formatHandoffNotice({
        name: conversation.lead.name,
        phone: conversation.lead.phone,
        origin: crmOriginLabel(conversation.lead.originChannel, conversation.lead.adOrigin?.tenantId === tenantId),
        summary,
        reason: options.reason,
        link: crmOn && base ? `${base}/crm?lead=${encodeURIComponent(conversation.leadId)}` : null,
        commands: HANDOFF_GROUP_COMMANDS,
      }),
    );
    if (notice) await recordHandoffNoticeSent(tenantId, notice.id, { groupId: config.groupId, messageId });
  } catch (err) {
    console.error("[handoff] falha ao avisar a equipe no grupo do WhatsApp", err);
  }
}

function noticeLine(value: string | null | undefined, maxLength: number): string {
  const line = (value ?? "").replace(/\s+/g, " ").trim();
  return line.length > maxLength ? `${line.slice(0, maxLength - 1).trimEnd()}…` : line;
}

const UNKNOWN_ORIGIN = "Origem não registrada";

/**
 * O aviso do grupo (CRM-06): nome, número, origem, resumo, motivo e link do
 * card, uma informação por linha. Nenhum dado do contato cria outra linha
 * (quebras viram espaço). O motivo só aparece quando o resumo ainda não o diz,
 * e o link só quando há card para abrir (CRM ligado e URL do app configurada).
 */
export function formatHandoffNotice(input: {
  name: string | null;
  phone: string;
  summary: string | null;
  reason?: string;
  origin?: string | null;
  link?: string | null;
  commands?: boolean;
}): string {
  const digits = input.phone.replace(/\D/g, "");
  const br = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(digits);
  const phone = br ? `+55 ${br[1]} ${br[2]}-${br[3]}` : `+${digits}`;
  const summary = noticeLine(input.summary, 600);
  const reason = noticeLine(input.reason, 300);
  const showReason = reason && !summary.toLocaleLowerCase("pt-BR").includes(reason.toLocaleLowerCase("pt-BR"));
  const origin = noticeLine(input.origin, 60);
  const link = input.link && /^https?:\/\/\S+$/.test(input.link) ? input.link : "";
  return [
    `Nome: ${noticeLine(input.name, 150) || "Não informado"}`,
    `Número: ${phone}`,
    `Origem: ${!origin || origin === UNKNOWN_ORIGIN ? "não registrada" : origin}`,
    `Resumo: ${summary || "Atendimento humano solicitado."}`,
    ...(showReason ? [`Motivo: ${reason}`] : []),
    ...(link ? [`Card: ${link}`] : []),
    ...(input.commands ? ["Responda *assumo* ou reaja 👍 para ficar com este lead. *#ia* devolve para a IA."] : []),
  ].join("\n");
}
