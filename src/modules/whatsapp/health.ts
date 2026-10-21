import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/mail";
import type { WhatsAppProviderName } from "./index";
import { channelProvider } from "./instances";
import { getWhatsAppProviderForInstance } from "./meta-config";
import { trackWhatsappIncident } from "./incidents";

/**
 * Saúde da conexão de WhatsApp de cada conta.
 *
 * Por que existe: o painel mostrava "Seu número está atendendo" lendo
 * `WhatsappInstance.status`, um campo gravado no momento da conexão e nunca
 * mais revisitado. Quando a sessão morria, ninguém reescrevia esse campo — a
 * tela seguia verde por dias, o cliente achava que estava atendendo e os leads
 * caíam no vácuo. Foi assim que o Instituto do Sorriso ficou horas fora do ar
 * sem ninguém perceber: quem descobriu foi um humano estranhando o silêncio.
 *
 * São DOIS sinais, e os dois são necessários:
 *
 * 1. Estado no provedor (`getConnectionState`) — pega a sessão derrubada, que
 *    é o caso comum.
 * 2. Silêncio (`lastInboundAt`) — pega o caso que o estado NÃO pega: a
 *    Evolution chegou a responder `"open"` para um socket fechado (o mesmo
 *    `logout` devolvia "Connection Closed" no mesmo segundo). Número que diz
 *    estar conectado e não recebe nada há horas está quebrado até prova em
 *    contrário, mesmo que o provedor jure o contrário.
 *
 * Nada aqui lança: é monitoramento, e um alerta que derruba o worker não
 * monitora nada. Toda função devolve o que achou e segue.
 */

/**
 * Horas de silêncio que tornam um número "conectado" suspeito.
 *
 * Generoso de propósito. Uma clínica pequena passa a madrugada e boa parte de
 * um domingo sem mensagem nenhuma, e alarme falso treina o dono a ignorar o
 * aviso — o que custa mais caro que não avisar. A checagem de horário
 * comercial (`isLikelyBusinessHours`) existe pelo mesmo motivo.
 */
const SILENCE_ALERT_HOURS = 6;

/** Não repete o mesmo alerta antes disso (evita e-mail a cada ciclo do worker). */
const ALERT_COOLDOWN_HOURS = 12;

export type WhatsappHealth = {
  tenantId: string;
  /** Qual das conexões da conta foi checada (cada uma tem a sua linha). */
  provider: WhatsAppProviderName;
  /** O que o banco dizia antes desta checagem. */
  storedStatus: string;
  /** O que o provedor respondeu agora (null = não deu para perguntar). */
  liveStatus: string | null;
  /** A instância ainda existe no provedor. */
  exists: boolean;
  /** Deu para falar com o provedor. `false` = problema nosso, não do cliente. */
  reachable: boolean;
  /** Última mensagem RECEBIDA de um cliente neste tenant. */
  lastInboundAt: Date | null;
  /** Horas desde a última mensagem recebida (null = nunca recebeu nenhuma). */
  silentHours: number | null;
  /** Diagnóstico final. */
  verdict: "ok" | "desconectado" | "sumiu" | "silencioso" | "indeterminado";
};

/**
 * Horário em que uma conta normalmente receberia mensagem. Silêncio de
 * madrugada não é sintoma de nada — alertar às 4h da manhã por causa disso
 * seria alarme falso garantido, e o custo de um alarme falso é o dono parar
 * de ler os alertas.
 *
 * Aproximação de propósito: America/Sao_Paulo, 8h–20h, sem domingo. A conta
 * tem horário de atendimento configurável (`scheduling/config.ts`), mas usá-lo
 * aqui acoplaria monitoramento a uma config que muitas contas nem preencheram.
 */
export function isLikelyBusinessHours(now: Date): boolean {
  const local = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const day = local.getDay();
  const hour = local.getHours();
  if (day === 0) return false;
  return hour >= 8 && hour < 20;
}

/**
 * Cruza o que o banco diz, o que o provedor diz e o fluxo real de mensagens.
 *
 * A ordem dos testes importa: "não consegui perguntar" vem antes de qualquer
 * veredito sobre o cliente, senão uma queda da Evolution viraria um e-mail
 * dizendo ao dono da clínica que o WhatsApp DELE caiu.
 */
export function diagnose(input: {
  storedStatus: string;
  liveStatus: string | null;
  exists: boolean;
  reachable: boolean;
  silentHours: number | null;
  duringBusinessHours: boolean;
}): WhatsappHealth["verdict"] {
  const { storedStatus, liveStatus, exists, reachable, silentHours, duringBusinessHours } = input;

  // Problema nosso (Evolution fora do ar): não é veredito sobre o cliente.
  if (!reachable) return "indeterminado";

  // Instância apagada no provedor. Só volta criando de novo (QR), então é o
  // caso mais grave: nem reconexão automática salva.
  if (!exists) return "sumiu";

  // O provedor confirma que caiu.
  if (liveStatus !== "connected") {
    // Só é notícia se o banco achava que estava conectado. Número que já
    // estava desconectado no painel não é falha nova — é estado conhecido.
    return storedStatus === "connected" ? "desconectado" : "ok";
  }

  // Aqui o provedor diz "conectado". É exatamente o cenário em que ele mentiu:
  // o silêncio é o único sinal honesto que sobra.
  if (
    duringBusinessHours &&
    silentHours !== null &&
    silentHours >= SILENCE_ALERT_HOURS
  ) {
    return "silencioso";
  }

  return "ok";
}

/**
 * Checa uma conta e SINCRONIZA `WhatsappInstance.status` com a realidade.
 *
 * A sincronização é o conserto do bug de fundo: o campo deixa de ser uma
 * lembrança do dia da conexão e passa a refletir o provedor. `indeterminado`
 * não grava nada — quando não dá para perguntar, o certo é manter o que se
 * sabia, não chutar "desconectado" e assustar o cliente à toa.
 */
export async function checkTenantWhatsapp(
  tenantId: string,
  now = new Date(),
  providerName: WhatsAppProviderName = "evolution",
): Promise<WhatsappHealth> {
  const instance = await prisma.whatsappInstance.findUnique({
    where: { tenantId_provider: { tenantId, provider: providerName } },
  });

  const base: WhatsappHealth = {
    tenantId,
    provider: providerName,
    storedStatus: instance?.status ?? "disconnected",
    liveStatus: null,
    exists: Boolean(instance?.externalId),
    reachable: false,
    lastInboundAt: null,
    silentHours: null,
    verdict: "indeterminado",
  };

  // Sem instância criada não há nada para monitorar (conta que ainda não
  // conectou o WhatsApp não está "quebrada"). Provedor sem a checagem de
  // estado também sai daqui: sem ela não há o que diagnosticar, e inventar um
  // veredito seria pior que não ter nenhum.
  if (!instance?.externalId) {
    return { ...base, verdict: "ok" };
  }
  // Meta desconectada é decisão de quem clicou "Desconectar" (ou do admin que
  // recolheu a liberação): as credenciais ficam guardadas e o token segue
  // válido, então perguntar à Meta e sincronizar religaria o que foi desligado.
  if (providerName === "meta" && instance.status !== "connected") {
    return { ...base, verdict: "ok" };
  }
  const provider = getWhatsAppProviderForInstance(instance);
  if (!provider.isConfigured() || !provider.getConnectionState) return { ...base, verdict: "ok" };

  const live = await provider.getConnectionState(instance.externalId);

  // Um restart pode preservar a sessão do WhatsApp e ainda assim apagar URL,
  // eventos ou o header secreto do webhook. Nesse estado a Evolution diz
  // `open`, mas nenhuma mensagem chega no fechai. A checagem é idempotente:
  // Evolution lê a configuração atual e só faz POST quando precisa reparar.
  if (provider.name === "evolution" && live.reachable && live.exists) {
    await provider.ensureWebhook(instance.externalId).catch((err) =>
      console.error(`[whatsapp health] falha ao garantir webhook de ${tenantId}`, err),
    );
  }

  // Última mensagem recebida de um cliente real. `Conversation.lastInboundAt`
  // já é mantido pelo motor e espelha `isTest`, então não precisa de join nem
  // de varrer Message. Sandbox fora: conversa de teste não prova que o número
  // está recebendo.
  //
  // Só a Evolution tem o sinal do silêncio: o socket "aberto" que não recebe é
  // falha da sessão dela. A Cloud API não tem sessão para morrer em silêncio —
  // o estado que a Meta devolve já é a verdade — e, com as duas conexões, a Meta
  // costuma servir aos Disparos e ficar dias sem receber, o que viraria alarme
  // falso. E, com as duas, as conversas da Meta não provam nada sobre o QR: o
  // silêncio dele é medido só entre as conversas que falam por ele.
  const lastInbound =
    providerName === "evolution"
      ? await prisma.conversation
          .findFirst({
            where: {
              tenantId,
              isTest: false,
              lastInboundAt: { not: null },
              OR: [{ whatsappProvider: null }, { whatsappProvider: { not: "meta" } }],
            },
            orderBy: { lastInboundAt: "desc" },
            select: { lastInboundAt: true },
          })
          .catch(() => null)
      : null;

  const lastInboundAt = lastInbound?.lastInboundAt ?? null;
  const silentHours = lastInboundAt
    ? (now.getTime() - lastInboundAt.getTime()) / 3_600_000
    : null;

  const verdict = diagnose({
    storedStatus: instance.status,
    liveStatus: live.reachable ? live.status : null,
    exists: live.exists,
    reachable: live.reachable,
    silentHours,
    duringBusinessHours: isLikelyBusinessHours(now),
  });

  // Sincroniza o banco com o provedor — o conserto do status congelado. Só
  // quando deu para perguntar, e só quando mudou. Meta nunca sobe para
  // "conectado" por aqui (a checagem acima já a deixa de fora): ligar é do
  // botão da tela, que também valida o token.
  if (live.reachable && live.status !== instance.status) {
    await prisma.whatsappInstance
      .update({
        where: { tenantId_provider: { tenantId, provider: providerName } },
        data: { status: live.status },
      })
      .catch((err) => console.error(`[whatsapp health] falha ao sincronizar ${tenantId}`, err));
  }

  return {
    tenantId,
    provider: providerName,
    storedStatus: instance.status,
    liveStatus: live.reachable ? live.status : null,
    exists: live.exists,
    reachable: live.reachable,
    lastInboundAt,
    silentHours,
    verdict,
  };
}

function alertText(tenantName: string, health: WhatsappHealth): { subject: string; text: string } {
  const horas = health.silentHours !== null ? Math.floor(health.silentHours) : null;
  // A conta pode ter as duas conexões: o aviso precisa dizer qual delas caiu.
  const via = health.provider === "meta" ? " (API oficial da Meta)" : "";

  if (health.verdict === "sumiu") {
    return {
      subject: `${tenantName}: o WhatsApp${via} precisa ser conectado de novo`,
      text:
        `O número de WhatsApp da conta ${tenantName}${via} saiu do ar e precisa ser conectado de novo.\n\n` +
        `Para voltar a atender: acesse Integrações e reconecte o provedor configurado.\n\n` +
        `Enquanto isso, as mensagens que os clientes enviarem NÃO chegam no painel.`,
    };
  }

  if (health.verdict === "desconectado") {
    return {
      subject: `${tenantName}: o WhatsApp${via} foi desconectado`,
      text:
        `O número de WhatsApp da conta ${tenantName}${via} foi desconectado e parou de receber mensagens.\n\n` +
        `Isso costuma acontecer quando o aparelho fica muito tempo sem internet ou quando o ` +
        `WhatsApp é desconectado pelo celular (Aparelhos conectados).\n\n` +
        `Para voltar a atender: acesse Integrações e conecte o número de novo.`,
    };
  }

  return {
    subject: `${tenantName}: o WhatsApp pode ter parado de receber mensagens`,
    text:
      `O número da conta ${tenantName} aparece como conectado, mas não recebe uma mensagem ` +
      `há ${horas} horas.\n\n` +
      `Pode ser um dia parado — mas também pode ser a conexão caída mostrando "conectado" ` +
      `indevidamente, que é uma falha conhecida do WhatsApp.\n\n` +
      `Vale conferir: mande uma mensagem de outro celular para o número da clínica e veja se ` +
      `ela aparece em Conversas. Se não aparecer, reconecte o número em Integrações.`,
  };
}

/**
 * Varre todas as contas, sincroniza status e avisa quem está quebrado.
 *
 * Roda no worker (ver workers/follow-up-worker). Uma conta que falha não
 * interrompe as outras — o try/catch por item é o ponto todo de uma varredura
 * de monitoramento.
 */
export async function scanWhatsappHealth(now = new Date()): Promise<{
  scanned: number;
  broken: number;
  alerted: number;
}> {
  // Uma linha por conexão: a conta com as duas é checada duas vezes, cada uma
  // com o seu provedor.
  const instances = await prisma.whatsappInstance.findMany({
    where: { externalId: { not: null } },
    select: {
      tenantId: true,
      provider: true,
      tenant: {
        select: {
          name: true,
          status: true,
          metaWhatsappEnabled: true,
          evolutionWhatsappEnabled: true,
          whatsappHealthAlertAt: true,
          users: { select: { email: true }, take: 1 },
        },
      },
    },
  });

  let broken = 0;
  let alerted = 0;

  for (const row of instances) {
    // Conta suspensa não recebe alerta: o WhatsApp dela está fora por decisão
    // nossa, e avisar seria ruído.
    if (row.tenant?.status !== "active") continue;
    // Meta sem liberação do admin não atende (a linha só guarda credenciais).
    if (channelProvider(row) === "meta" && !row.tenant.metaWhatsappEnabled) continue;
    // QR desligado pelo admin: não é queda, e religar o webhook ou sincronizar o
    // status desfaria a decisão (a sessão segue de pé no provedor).
    if (channelProvider(row) === "evolution" && row.tenant.evolutionWhatsappEnabled === false) continue;

    try {
      const health = await checkTenantWhatsapp(row.tenantId, now, channelProvider(row));
      // Queda e volta ficam registradas para a disponibilidade do relatório mensal.
      await trackWhatsappIncident(health, now);
      if (health.verdict === "ok" || health.verdict === "indeterminado") continue;
      broken += 1;

      // Cooldown: sem isto, uma conta quebrada geraria um e-mail a cada ciclo
      // do worker até alguém reconectar — o caminho mais curto para o alerta
      // virar spam e ser ignorado.
      const lastAlert = row.tenant.whatsappHealthAlertAt;
      if (lastAlert && now.getTime() - lastAlert.getTime() < ALERT_COOLDOWN_HOURS * 3_600_000) {
        continue;
      }

      const email = row.tenant.users[0]?.email;
      const tenantName = row.tenant.name;
      console.warn(
        `[whatsapp health] ${tenantName} (${row.tenantId}, ${health.provider}): ${health.verdict}` +
          (health.silentHours !== null ? ` — ${Math.floor(health.silentHours)}h sem mensagem` : ""),
      );

      if (!email) continue;
      const { subject, text } = alertText(tenantName, health);
      const sent = await sendMail({
        to: email,
        subject,
        text,
        html: `<p>${text.replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p>`,
      });

      // Só marca o cooldown se o e-mail saiu: falha do provedor de e-mail não
      // pode consumir a janela e deixar a conta 12h sem novo aviso.
      if (sent.ok) {
        alerted += 1;
        await prisma.tenant
          .update({ where: { id: row.tenantId }, data: { whatsappHealthAlertAt: now } })
          .catch(() => {});
      }
    } catch (err) {
      console.error(`[whatsapp health] falha ao checar ${row.tenantId}`, err);
    }
  }

  return { scanned: instances.length, broken, alerted };
}
