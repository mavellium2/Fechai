import { prisma } from "@/lib/prisma";
import { recordAudit } from "./log";
import { eventDef, isRevertibleEvent } from "./events";
import { containsRedacted, isTruncated } from "./redact";

/**
 * Desfazer um evento da trilha.
 *
 * Duas formas, decididas pelo `kind` do evento:
 *
 * - **update** → regrava em `targetType`/`targetId` os campos guardados em
 *   `before`.
 * - **delete** → recria o registro a partir de `before`, com o **mesmo id**,
 *   para que o que apontava para ele volte a apontar.
 *
 * ## Por que existe uma whitelist
 *
 * Reverter escreve no banco valores lidos de uma linha de log. Se a lista de
 * campos viesse do próprio log, bastaria uma linha adulterada (ou um snapshot
 * gravado por engano com campos demais) para escrever qualquer coluna —
 * `role: "SUPERADMIN"` num User, `tenantId` de outra conta num Lead. A
 * whitelist inverte isso: o log propõe, o código decide o que aceita. Campo
 * fora da lista é ignorado em silêncio no revert e relatado no resultado.
 */

type RevertibleModel = {
  /** Delegate do Prisma. String para não acoplar a tipos gerados. */
  delegate: keyof typeof prisma;
  /** Campos que um revert pode escrever. Nada de id, tenantId, timestamps. */
  fields: readonly string[];
  /** Undo de exclusão recria a linha. Falso = só alteração é revertível. */
  restorable: boolean;
  /** Como a tela chama isto. */
  label: string;
  /**
   * Gênero do rótulo, para a mensagem concordar ("a conta restaurada", "o
   * agente restaurado"). Sem isto sai "Conta restaurado", que faz a mensagem
   * de sucesso parecer texto de máquina.
   */
  gender?: "f" | "m";
};

/**
 * O que pode ser revertido, por modelo.
 *
 * Fora daqui, nada. `Tenant` aparece só com os campos que o admin realmente
 * altera pelo painel — e sem `restorable`, porque restaurar uma conta excluída
 * a partir de um JSON produz uma conta vazia que parece inteira (ver README).
 */
const REVERTIBLE_MODELS: Record<string, RevertibleModel> = {
  Tenant: {
    delegate: "tenant",
    fields: ["status", "planKey", "messageLimitOverride", "priceCentsOverride", "trialEndsAt"],
    restorable: false,
    label: "conta",
    gender: "f",
  },
  Agent: {
    delegate: "agent",
    fields: [
      "name",
      "systemPrompt",
      "objective",
      "personaDraft",
      "enabled",
      "listenAudio",
      "stopOnEmoji",
      "speakReplies",
      "voicePrompt",
      "isPrimary",
      "archived",
    ],
    restorable: true,
    label: "agente",
  },
  TenantAction: {
    delegate: "tenantAction",
    fields: ["enabled", "config"],
    restorable: true,
    label: "ação do agente",
    gender: "f",
  },
  KnowledgeDocument: {
    delegate: "knowledgeDocument",
    // `content` entra porque é o que a edição altera; se tiver sido cortado
    // pelo redator (documento grande), o revert recusa em vez de gravar o
    // pedaço — ver `pickFields`.
    fields: ["title", "content", "status", "fileUrl", "fileName"],
    restorable: true,
    label: "documento",
  },
  Lead: {
    delegate: "lead",
    fields: ["name", "phone", "status"],
    restorable: true,
    label: "contato",
  },
  User: {
    // Sem `role`, sem `tenantId`, sem `passwordHash`: os três transformariam
    // um undo em escalação de privilégio ou em troca de dono da conta.
    delegate: "user",
    fields: [
      "name",
      "phone",
      "phoneSecondary",
      "document",
      "birthDate",
      "gender",
      "usesProduct",
    ],
    restorable: false,
    label: "usuário",
  },
  CalendarFeatures: {
    delegate: "calendarFeatures",
    fields: ["googleEnabled", "clinicorpEnabled", "icloudEnabled"],
    restorable: false,
    label: "integração de agenda",
    gender: "f",
  },
};

export type RevertResult =
  | { ok: true; info: string }
  | { ok: false; error: string };

/**
 * Desfaz o evento `logId`. Já assume SUPERADMIN — a checagem de papel fica na
 * server action, e esta função é chamada só de lá.
 */
export async function revertAuditLog(
  logId: string,
  actor: { id: string; email: string | null },
): Promise<RevertResult> {
  const log = await prisma.auditLog.findUnique({ where: { id: logId } });
  if (!log) return { ok: false, error: "Evento não encontrado." };

  // Cada checagem repete no servidor o que a tela já mostra. A tela esconde o
  // botão; isto é o que impede a action de ser chamada direto.
  if (!log.revertible || !isRevertibleEvent(log.event)) {
    return { ok: false, error: "Este evento não pode ser desfeito." };
  }
  if (log.revertedAt) {
    return {
      ok: false,
      error: "Este evento já foi desfeito — o estado atual não é mais o que ele registrou.",
    };
  }
  if (!log.targetType || !log.targetId) {
    return { ok: false, error: "O evento não aponta para um registro." };
  }

  const model = REVERTIBLE_MODELS[log.targetType];
  if (!model) {
    return { ok: false, error: `Não sei desfazer alterações em ${log.targetType}.` };
  }

  // Reserva o log ANTES de escrever no alvo. A checagem de `revertedAt` acima
  // não basta sozinha: dois cliques simultâneos (ou dois admins na mesma tela)
  // leem os dois `null` e aplicariam a reversão duas vezes. O `updateMany` com
  // `revertedAt: null` na condição é atômico — quem chegar depois altera zero
  // linhas e para aqui, antes de tocar no registro.
  const claim = await prisma.auditLog.updateMany({
    where: { id: log.id, revertedAt: null },
    data: {
      revertedAt: new Date(),
      revertedById: actor.id,
      revertedByEmail: actor.email,
    },
  });
  if (claim.count === 0) {
    return {
      ok: false,
      error: "Este evento já foi desfeito — o estado atual não é mais o que ele registrou.",
    };
  }

  const def = eventDef(log.event);
  const outcome =
    def?.kind === "delete"
      ? await restoreDeleted(log, model)
      : await revertUpdate(log, model);

  if (!outcome.ok) {
    // A reserva não virou reversão: devolve o log ao estado de "pendente",
    // senão um erro recuperável (registro que sumiu, campo redigido) deixaria
    // a linha marcada como desfeita para sempre, sem nada ter mudado.
    await prisma.auditLog
      .update({
        where: { id: log.id },
        data: { revertedAt: null, revertedById: null, revertedByEmail: null },
      })
      .catch((err) => console.error("[audit] falha ao liberar a reserva do log", log.id, err));
    return outcome;
  }

  // A reversão vira uma linha nova, e a original é MARCADA — nunca editada
  // nem apagada. Uma trilha que se reescreve não serve de trilha.
  await recordAudit({
    event: "admin.revert",
    target: {
      type: log.targetType,
      id: log.targetId,
      label: log.targetLabel,
    },
    before: log.after,
    after: log.before,
    meta: {
      revertedLogId: log.id,
      revertedEvent: log.event,
      campos: outcome.fields,
      ignorados: outcome.skipped.length ? outcome.skipped : undefined,
    },
    tenantId: log.tenantId,
  });

  // Procurado pelo id do log revertido, gravado no `meta` — e não pelo alvo
  // mais recente. Dois admins desfazendo eventos diferentes do MESMO registro
  // ao mesmo tempo escolheriam a linha um do outro, e cada log apontaria para
  // a reversão errada. É um ponteiro de conveniência: se a busca não achar,
  // segue null e a trilha continua correta pelo `meta` da linha nova.
  const revertLog = await prisma.auditLog
    .findFirst({
      where: {
        event: "admin.revert",
        meta: { path: ["revertedLogId"], equals: log.id },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    })
    .catch(() => null);

  // Quem/quando já foi gravado na reserva; aqui fica só o ponteiro para a
  // linha que registra a reversão.
  await prisma.auditLog.update({
    where: { id: log.id },
    data: { revertLogId: revertLog?.id ?? null },
  });

  return { ok: true, info: outcome.info };
}

type Outcome =
  | { ok: true; info: string; fields: string[]; skipped: string[] }
  | { ok: false; error: string };

/** Alteração: regrava os campos de `before` na linha que ainda existe. */
async function revertUpdate(
  log: { targetId: string | null; targetType: string | null; before: unknown; targetLabel: string | null },
  model: RevertibleModel,
): Promise<Outcome> {
  const before = asRecord(log.before);
  if (!before) return { ok: false, error: "O evento não guardou o estado anterior." };

  const { data, skipped, unsafe } = pickFields(before, model.fields);
  if (unsafe.length) {
    return {
      ok: false,
      error: `Não é possível restaurar ${unsafe.join(", ")}: o valor foi ocultado ou cortado no registro.`,
    };
  }
  if (Object.keys(data).length === 0) {
    return { ok: false, error: "Nenhum campo deste evento pode ser restaurado." };
  }

  const delegate = delegateOf(model);
  const exists = await delegate.findUnique({ where: { id: log.targetId! }, select: { id: true } });
  if (!exists) {
    return {
      ok: false,
      error: `Este ${model.label} não existe mais — não há o que alterar de volta.`,
    };
  }

  await delegate.update({ where: { id: log.targetId! }, data });

  return {
    ok: true,
    fields: Object.keys(data),
    skipped,
    info: `${capitalize(model.label)} ${restored(model)} ao estado anterior (${Object.keys(data).join(", ")}).`,
  };
}

/**
 * Exclusão: recria a linha com o mesmo id.
 *
 * O que NÃO volta, e a tela avisa antes: os filhos apagados em cascade
 * (chunks de um documento, ações de um agente) e os efeitos externos já
 * consumados. Restaurar o registro é devolver a linha, não reconstruir o
 * mundo em volta dela.
 */
async function restoreDeleted(
  log: { targetId: string | null; before: unknown; tenantId: string | null },
  model: RevertibleModel,
): Promise<Outcome> {
  if (!model.restorable) {
    return { ok: false, error: `Exclusão de ${model.label} não pode ser desfeita.` };
  }

  const snapshot = asRecord(log.before);
  if (!snapshot) return { ok: false, error: "O evento não guardou o registro excluído." };

  const delegate = delegateOf(model);
  const existing = await delegate.findUnique({
    where: { id: log.targetId! },
    select: { id: true },
  });
  if (existing) {
    return { ok: false, error: `Este ${model.label} já existe — nada a restaurar.` };
  }

  // A linha volta com id e vínculos originais, mas só com os campos da
  // whitelist mais as chaves estruturais — o resto (contadores, timestamps)
  // o Prisma preenche com os defaults do schema.
  const { data, skipped, unsafe } = pickFields(snapshot, model.fields);
  if (unsafe.length) {
    return {
      ok: false,
      error: `Não é possível restaurar: ${unsafe.join(", ")} foi ocultado ou cortado no registro.`,
    };
  }

  for (const key of STRUCTURAL_FIELDS) {
    if (snapshot[key] !== undefined && snapshot[key] !== null) data[key] = snapshot[key];
  }
  data.id = log.targetId;

  try {
    await delegate.create({ data });
  } catch (error) {
    console.error("[audit] falha ao restaurar registro excluído", log.targetId, error);
    return {
      ok: false,
      error:
        "Não foi possível recriar o registro. Ele pode depender de algo que também foi excluído.",
    };
  }

  return {
    ok: true,
    fields: Object.keys(data),
    skipped,
    info: `${capitalize(model.label)} ${restored(model)}. Itens ligados a ele que foram apagados junto não voltam.`,
  };
}

/**
 * Chaves de vínculo copiadas na restauração. Não estão na whitelist de campos
 * editáveis de propósito: um *update* nunca pode escrevê-las (trocaria o dono
 * do registro), mas a linha recriada precisa nascer com elas.
 */
const STRUCTURAL_FIELDS = ["tenantId", "agentId", "documentId", "leadId", "userId"] as const;

/** Separa o que a whitelist aceita, o que ela ignora e o que é irrecuperável. */
function pickFields(
  source: Record<string, unknown>,
  allowed: readonly string[],
): { data: Record<string, unknown>; skipped: string[]; unsafe: string[] } {
  const data: Record<string, unknown> = {};
  const skipped: string[] = [];
  const unsafe: string[] = [];

  for (const [key, value] of Object.entries(source)) {
    if (!allowed.includes(key)) {
      if (!(STRUCTURAL_FIELDS as readonly string[]).includes(key) && key !== "id") {
        skipped.push(key);
      }
      continue;
    }
    // Valor redigido ou cortado não é o valor real: escrevê-lo trocaria o
    // conteúdo por "[oculto]" ou por um pedaço do texto — pior que não
    // reverter, porque parece ter dado certo.
    if (containsRedacted(value) || isTruncated(value)) {
      unsafe.push(key);
      continue;
    }
    data[key] = coerce(key, value);
  }

  return { data, skipped, unsafe };
}

/**
 * O JSON do banco devolve data como string. Sem reconverter, o Prisma recusa
 * a escrita (`trialEndsAt` esperando DateTime e recebendo string).
 */
function coerce(key: string, value: unknown): unknown {
  if (typeof value === "string" && DATE_FIELDS.has(key)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date;
  }
  return value;
}

const DATE_FIELDS = new Set(["trialEndsAt", "birthDate", "voiceCreatedAt", "scheduledAt"]);

type Delegate = {
  findUnique(args: { where: { id: string }; select?: object }): Promise<{ id: string } | null>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  create(args: { data: Record<string, unknown> }): Promise<unknown>;
};

function delegateOf(model: RevertibleModel): Delegate {
  return prisma[model.delegate] as unknown as Delegate;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Concorda com o gênero do rótulo: "conta restaurada", "agente restaurado". */
function restored(model: RevertibleModel): string {
  return model.gender === "f" ? "restaurada" : "restaurado";
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Para a tela saber, sem duplicar a lista, o que o servidor aceita reverter. */
export function isRevertibleTarget(targetType: string | null): boolean {
  return Boolean(targetType && REVERTIBLE_MODELS[targetType]);
}
