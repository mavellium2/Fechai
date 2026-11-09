/**
 * Meta simulada para testar os Disparos no computador, sem conta na Meta.
 *
 * Liga só com `BROADCASTS_SIMULATE_META=1` **e** `NODE_ENV` diferente de
 * `production` — no servidor de produção nunca ativa, mesmo com a variável.
 * Nada sai para a internet: o "envio" devolve um id falso. Mensagens, contatos
 * e campanhas são gravados no banco local como no fluxo real.
 *
 * Modelos criados ficam num arquivo temporário (o app e o worker são processos
 * diferentes e precisam ver a mesma lista): "em análise" por 20 s, depois
 * aprovados — ou recusados quando o nome contém "recusar", para testar a
 * correção.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MetaTemplateRejected, type MetaCloudProvider } from "@/modules/whatsapp/meta";
import { supportedTemplate, type MetaTemplateRecord } from "./template";
import {
  managedTemplate,
  type MetaManagedTemplateRecord,
  type TemplatePayload,
} from "./template-draft";

export function isBroadcastSimulation(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.BROADCASTS_SIMULATE_META === "1"
  );
}

type StoredTemplate = MetaManagedTemplateRecord & {
  components: { type: string; format?: string; text?: string }[];
  createdAt: number;
};

const REVIEW_MS = 20_000;
const STORE = join(tmpdir(), "fechai-meta-simulada.json");

const SEED: StoredTemplate[] = [
  {
    id: "sim-boas-vindas",
    name: "boas_vindas_avaliacao",
    language: "pt_BR",
    category: "MARKETING",
    createdAt: 0,
    components: [
      {
        type: "BODY",
        text: "Oi {{1}}! Aqui é da clínica. Temos horários livres para avaliação nesta semana. Quer que eu reserve um para você?",
      },
      { type: "FOOTER", text: "Responda SAIR para não receber mais" },
    ],
  },
  {
    id: "sim-promocao",
    name: "promocao_mes",
    language: "pt_BR",
    category: "MARKETING",
    createdAt: 0,
    components: [
      { type: "HEADER", format: "TEXT", text: "Novidade do mês" },
      {
        type: "BODY",
        text: "Olá {{1}}, este mês estamos com {{2}} em todos os tratamentos. Posso te mandar os detalhes?",
      },
    ],
  },
  {
    id: "sim-lembrete",
    name: "retorno_pendente",
    language: "pt_BR",
    category: "UTILITY",
    createdAt: 0,
    components: [
      {
        type: "BODY",
        text: "Faz tempo que não te vemos por aqui! Que tal agendar seu retorno? É só responder esta mensagem.",
      },
    ],
  },
];

function load(): StoredTemplate[] {
  try {
    return JSON.parse(readFileSync(STORE, "utf8")) as StoredTemplate[];
  } catch {
    return SEED;
  }
}

/** Status de agora: a "análise" termina sozinha depois de alguns segundos. */
function withStatus(t: StoredTemplate): StoredTemplate {
  if (Date.now() - t.createdAt < REVIEW_MS) return { ...t, status: "PENDING" };
  if (t.name?.includes("recusar"))
    return { ...t, status: "REJECTED", rejected_reason: "PROMOTIONAL" };
  return { ...t, status: "APPROVED" };
}

const fake = {
  async listBroadcastTemplates() {
    return load()
      .map(withStatus)
      .map((t) => supportedTemplate(t as MetaTemplateRecord))
      .filter((t) => t !== null);
  },
  async listManagedTemplates() {
    return load()
      .map(withStatus)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(managedTemplate)
      .filter((t) => t !== null);
  },
  async createMessageTemplate(payload: TemplatePayload) {
    const all = load();
    if (all.some((t) => t.name === payload.name))
      throw new MetaTemplateRejected("Já existe um modelo com esse nome. Escolha outro.");
    const id = `sim-${Date.now()}`;
    all.push({
      id,
      name: payload.name,
      language: payload.language,
      category: payload.category,
      createdAt: Date.now(),
      components: payload.components,
    });
    writeFileSync(STORE, JSON.stringify(all));
    return { id, status: "PENDING", category: payload.category };
  },
  async sendBroadcastTemplate(toPhone: string) {
    // Um pouco de espera para a fila parecer a de verdade.
    await new Promise((resolve) => setTimeout(resolve, 150));
    return `wamid.simulado.${toPhone}.${Date.now()}`;
  },
  isConfigured() {
    return true;
  },
};

export function simulatedBroadcastConnection() {
  return {
    provider: fake as unknown as MetaCloudProvider,
    phoneNumberId: "simulado",
    displayPhone: "+55 11 90000-0000 (simulado)",
  };
}
