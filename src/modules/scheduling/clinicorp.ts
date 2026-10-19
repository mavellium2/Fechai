import { prisma } from "@/lib/prisma";
import type { ClinicorpIntegration } from "@prisma/client";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getCalendarFeatures } from "./features";
import { dayKeyInZone, formatInZone, parseLocalDateTime, partsInZone, zonedTimeToUtc } from "./time";

/**
 * Integração opcional com o Clinicorp (sistema de gestão de clínicas).
 *
 * Mesmo desenho da do Google (`./google.ts`): a agenda do fechai é a fonte da
 * verdade e o Clinicorp é espelho. A diferença é a autenticação — lá é OAuth,
 * aqui é HTTP Basic com um par fixo (Usuário API + Token API) que a própria
 * clínica gera em *Gerenciar Assinatura › Acesso Externo e Integrações*. Por
 * isso as credenciais são coladas na tela, sem tela de consentimento.
 *
 * Duas coisas acontecem aqui:
 *
 * 1. **Espelho** — o horário marcado no fechai vira um agendamento na agenda da
 *    clínica, ligado ao cadastro do paciente (busca por telefone e cria se não
 *    existir), para a recepção ver o paciente chegando.
 * 2. **Disponibilidade** — antes de oferecer horário, o agente consulta a
 *    agenda real do Clinicorp. Sem isso ele marcaria em cima de um paciente que
 *    a recepção agendou pelo sistema da clínica, que o fechai não conhece.
 *
 * Nenhuma função aqui lança: uma indisponibilidade do Clinicorp não pode
 * derrubar o atendimento nem desfazer um horário já combinado com o lead.
 */

const API_BASE = "https://api.clinicorp.com/rest/v1";

/** A API é de terceiro e entra no meio de uma conversa em tempo real. */
const TIMEOUT_MS = 10_000;

export type ClinicorpCredentials = Pick<
  ClinicorpIntegration,
  "apiUser" | "apiToken" | "subscriberId"
>;

function authHeader(cred: ClinicorpCredentials): string {
  const basic = Buffer.from(`${cred.apiUser}:${cred.apiToken}`).toString("base64");
  return `Basic ${basic}`;
}

type CallResult<T> = { ok: true; data: T; status?: number; emptyBody?: boolean } | { ok: false; error: string; status?: number };

/**
 * Uma chamada à API. Devolve o erro em vez de lançar porque quem chama decide
 * o que fazer: o espelho engole, a tela de conexão mostra para a pessoa.
 */
async function call<T>(
  cred: ClinicorpCredentials,
  path: string,
  init: {
    method?: "GET" | "POST"; query?: Record<string, string | number | undefined>; body?: unknown;
    timeoutMs?: number;
  } = {},
): Promise<CallResult<T>> {
  const url = new URL(`${API_BASE}${path}`);
  url.searchParams.set("subscriber_id", cred.subscriberId);
  for (const [k, v] of Object.entries(init.query ?? {})) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }

  try {
    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        Authorization: authHeader(cred),
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(init.timeoutMs ?? TIMEOUT_MS),
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // 401/403 é credencial: vale uma mensagem que a pessoa entenda na tela.
      const reason = clinicorpReason(text);
      const error =
        res.status === 401 || res.status === 403
          ? "Usuário ou token da API recusado pelo Clinicorp. Gere um novo token no Clinicorp e reconecte aqui."
          : `O Clinicorp respondeu com erro ${res.status}${reason ? `: "${reason}"` : " sem explicar o motivo"}.`;
      return { ok: false, error, status: res.status };
    }

    // Alguns endpoints respondem 200 com corpo vazio.
    const text = await res.text();
    if (!text.trim()) return { ok: true, data: null as T, status: res.status, emptyBody: true };
    const data = JSON.parse(text) as T;
    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
    if (row && typeof row === "object" &&
        (row.error || row.Error || row.success === false ||
         /^(ERROR|FAILED|FAILURE)$/i.test(String(row.Status ?? row.status ?? "")))) {
      const reason = clinicorpReason(data);
      return {
        ok: false,
        error: reason
          ? `O Clinicorp recusou: "${reason}".`
          : "O Clinicorp recusou a operação sem explicar o motivo. Confira as credenciais e os dados do agendamento.",
      };
    }
    return { ok: true, data, status: res.status, emptyBody: false };
  } catch (err) {
    const error =
      err instanceof Error && err.name === "TimeoutError"
        ? "O Clinicorp não respondeu a tempo."
        : "Não foi possível falar com o Clinicorp.";
    return { ok: false, error };
  }
}

/**
 * O motivo que o próprio Clinicorp escreveu, quando escreveu. Aceita o corpo cru
 * (texto de uma resposta de erro) ou já lido. Página HTML de erro não é motivo:
 * jogar markup no aviso só esconderia o problema.
 */
function clinicorpReason(body: unknown): string | null {
  let parsed = body;
  if (typeof body === "string") {
    const text = body.trim();
    if (!text || text.startsWith("<")) return null;
    try {
      parsed = JSON.parse(text);
    } catch {
      return text.slice(0, 200);
    }
  }
  const row = Array.isArray(parsed) ? parsed[0] : parsed;
  if (typeof row === "string") return row.trim().slice(0, 200) || null;
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  for (const key of ["message", "Message", "error", "Error", "msg", "detail", "Description"]) {
    const value = r[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 200);
    if (value && typeof value === "object") {
      const nested = (value as Record<string, unknown>).message;
      if (typeof nested === "string" && nested.trim()) return nested.trim().slice(0, 200);
    }
  }
  return null;
}

/**
 * Anota o resultado da última chamada — a tela mostra isso ao cliente. O erro
 * chega com contexto (qual agendamento, qual operação): "falhou" sozinho não diz
 * à clínica o que conferir.
 */
async function recordOutcome(tenantId: string, error: string | null): Promise<void> {
  await prisma.clinicorpIntegration
    .update({
      where: { tenantId },
      data: error
        ? { lastErrorAt: new Date(), lastError: error.slice(0, 500) }
        : { lastSyncAt: new Date(), lastErrorAt: null, lastError: null },
    })
    .catch(() => {});
}

export type ClinicorpIntegrationState = "configured" | "not_connected" | "disabled" | "credentials_error" | "unavailable";

/**
 * A integração do tenant com as credenciais **já decifradas**.
 *
 * A decifragem mora aqui, e não em cada chamador, para não existir um caminho em
 * que alguém pegue a linha do banco e mande o token cifrado no header Basic — o
 * erro voltaria como um 401 do Clinicorp, difícil de ligar à causa.
 *
 * Credencial ilegível (chave trocada, linha corrompida) devolve `null`: para o
 * resto do módulo é o mesmo que "não conectado", e a pessoa reconecta na tela.
 */
async function getIntegration(
  tenantId: string,
  { ignoreFeatureFlag = false, onUnavailable, onInactive }: {
    ignoreFeatureFlag?: boolean; onUnavailable?: () => void;
    onInactive?: (state: ClinicorpIntegrationState) => void;
  } = {},
): Promise<ClinicorpIntegration | null> {
  let rowUnavailable = false;
  let featuresUnavailable = false;
  const [row, features] = await Promise.all([
    prisma.clinicorpIntegration.findUnique({ where: { tenantId } }).catch(() => { rowUnavailable = true; onUnavailable?.(); return null; }),
    getCalendarFeatures(tenantId, () => { featuresUnavailable = true; onUnavailable?.(); }),
  ]);
  if (rowUnavailable || (featuresUnavailable && !ignoreFeatureFlag)) { onInactive?.("unavailable"); return null; }
  if (!row) { onInactive?.("not_connected"); return null; }

  // Desabilitar em /integracoes precisa PARAR a sincronização, não só esconder
  // o card: a checagem mora aqui, no caminho por onde toda chamada passa.
  //
  // A exceção é limpar o que já foi enviado (`ignoreFeatureFlag`): cancelar um
  // horário aqui tem que sumir com ele lá mesmo depois de desabilitar, senão
  // fica um paciente fantasma na agenda da clínica.
  if (!features.clinicorpEnabled && !ignoreFeatureFlag) { onInactive?.("disabled"); return null; }

  const apiUser = decryptSecret(row.apiUser);
  const apiToken = decryptSecret(row.apiToken);
  if (!apiUser || !apiToken) {
    onInactive?.("credentials_error");
    console.error(`[clinicorp] credenciais ilegíveis para o tenant ${tenantId}`);
    if (row.checkAvailability) onUnavailable?.();
    return null;
  }

  return { ...row, apiUser, apiToken };
}

// ---------------------------------------------------------------------------
// Conferência de credenciais e dados de apoio (usados pela tela de conexão)
// ---------------------------------------------------------------------------

export type ClinicorpBusiness = { id: string; name: string };
export type ClinicorpProfessional = { id: string; name: string };
export type ClinicorpCategory = { id: string; name: string };

/** Metadados para a UI, sem levar credenciais à camada de apresentação. */
export async function getClinicorpStatus(tenantId: string) {
  const integration = await getIntegration(tenantId, { ignoreFeatureFlag: true });
  if (!integration) return null;
  const { subscriberId, businessId, dentistId, categoryDescription, syncEnabled,
    checkAvailability, lastError, lastErrorAt, lastSyncAt } = integration;
  return { subscriberId, businessId, dentistId, categoryDescription, syncEnabled,
    checkAvailability, lastError, lastErrorAt, lastSyncAt };
}

/**
 * As credenciais funcionam? Usa `/business/list` como ping: é o endpoint mais
 * barato que já exige o `subscriber_id`, então valida os três campos de uma vez
 * e ainda devolve as clínicas para a pessoa escolher qual recebe os horários.
 */
export async function verifyClinicorpCredentials(
  cred: ClinicorpCredentials,
): Promise<{ ok: true; businesses: ClinicorpBusiness[] } | { ok: false; error: string }> {
  const res = await call<unknown>(cred, "/business/list", {
    query: { subscriber_id: cred.subscriberId },
  });
  if (!res.ok) return { ok: false, error: res.error };

  if (!Array.isArray(res.data)) return { ok: false, error: "O Clinicorp não devolveu a lista de clínicas. Verifique o acesso da API." };
  const rows = res.data.filter((row) => row && typeof row === "object");
  const businesses = rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: String(r.id ?? ""),
      // `Name` é o nome fantasia; `BusinessName`, a razão social. Um ou outro.
      name: String(r.Name || r.BusinessName || "Clínica"),
    };
  });
  const valid = businesses.filter((b) => b.id);
  if (!valid.length) return { ok: false, error: "Nenhuma clínica disponível para este assinante. Verifique as credenciais e as permissões da API." };
  return { ok: true, businesses: valid };
}

/**
 * As clínicas do assinante já conectado — para o seletor de unidade.
 *
 * Existe além de `verifyClinicorpCredentials` porque a tela não tem (nem deve
 * ter) as credenciais em mãos: elas estão cifradas no banco e só este módulo as
 * decifra. Lista vazia quando não há conexão ou a chamada falhou; a tela cai no
 * campo escondido com o valor já salvo.
 */
export async function listClinicorpBusinesses(tenantId: string): Promise<ClinicorpBusiness[]> {
  const integration = await getIntegration(tenantId);
  if (!integration) return [];
  const res = await verifyClinicorpCredentials(integration);
  return res.ok ? res.businesses : [];
}

/** Profissionais da conta — a tela usa para escolher o dentista padrão. */
export async function listClinicorpProfessionals(
  tenantId: string,
): Promise<CallResult<ClinicorpProfessional[]>> {
  const integration = await getIntegration(tenantId);
  if (!integration) return { ok: false, error: "Clinicorp não está conectado." };

  const res = await call<unknown>(integration, "/professional/list_all_professionals", {
    query: { subscriber_id: integration.subscriberId },
  });
  if (!res.ok) return res;
  if (!Array.isArray(res.data)) return { ok: false, error: "O Clinicorp não devolveu a lista de profissionais." };

  const rows = res.data;
  const data = rows
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const r = row as Record<string, unknown>;
      return { id: String(r.id ?? ""), name: String(r.name ?? "") };
    })
    .filter((p) => p.id && p.name);
  return { ok: true, data };
}

async function fetchCategories(cred: ClinicorpCredentials): Promise<CallResult<ClinicorpCategory[]>> {
  const res = await call<unknown>(cred, "/appointment/list_categories");
  if (!res.ok) return res;
  if (!Array.isArray(res.data)) return { ok: false, error: "O Clinicorp não devolveu a lista de categorias." };
  const data = res.data.filter((row) => row && typeof row === "object")
    .map((row) => ({ id: String(row.id ?? ""), name: String(row.Description ?? "") }))
    .filter((row) => row.id && row.name);
  return { ok: true, data };
}

export async function listClinicorpCategories(tenantId: string): Promise<CallResult<ClinicorpCategory[]>> {
  const integration = await getIntegration(tenantId);
  if (!integration) return { ok: false, error: "Clinicorp não está conectado." };
  return fetchCategories(integration);
}

/** Testa acesso sem criar paciente/agendamento e sem apagar erros de envio. */
export async function testClinicorpConnection(tenantId: string): Promise<CallResult<string>> {
  const integration = await getIntegration(tenantId);
  if (!integration) return { ok: false, error: "Clinicorp não está conectado. Revise as credenciais." };
  const result = await verifyClinicorpCredentials(integration);
  if (!result.ok) {
    await recordOutcome(tenantId, `Teste de conexão falhou. ${result.error}`);
    return result;
  }
  if (!result.businesses.some((b) => b.id === integration.businessId)) {
    return { ok: false, error: "A API respondeu, mas falta escolher uma clínica disponível e salvar as preferências." };
  }
  return { ok: true, data: "Acesso à clínica confirmado agora. Este teste consulta a API; o envio é confirmado em cada agendamento." };
}

export type ClinicorpSyncResult =
  | { status: "synced"; appointmentId: string }
  | { status: "skipped" }
  | { status: "failed"; error: string; reason?: "conflict"; automatic?: boolean };

// ---------------------------------------------------------------------------
// Paciente
// ---------------------------------------------------------------------------

/**
 * Telefone brasileiro no formato do Clinicorp: DDD + número, sem o 55 do
 * WhatsApp. O tamanho distingue o código do país de um DDD 55 legítimo.
 * A normalização é só para a integração; o contato mantém seu número original.
 */
function clinicorpPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return /^55\d{10,11}$/.test(digits) ? digits.slice(2) : digits;
}

/**
 * Acha o paciente pelo telefone; cria se não existir. Só deve ser usado
 * quando o contato do WhatsApp é a própria pessoa atendida.
 *
 * O vínculo com o cadastro é o que faz o agendamento valer alguma coisa para a
 * clínica — sem `Patient_PersonId` o horário entra solto, sem prontuário nem
 * histórico. Quando a busca falha (API fora, telefone estranho), devolve null e
 * o agendamento segue sem vínculo com o prontuário.
 */
async function resolvePatientId(
  integration: ClinicorpIntegration,
  lead: { name: string | null; phone: string | null },
): Promise<string | null> {
  const phone = lead.phone ? clinicorpPhone(lead.phone) : "";
  if (!phone) return null;

  const found = await call<unknown>(integration, "/patient/get", {
    query: { subscriber_id: integration.subscriberId, Phone: phone },
  });

  // Falha de busca não prova que o paciente não existe. Não crie outro cadastro
  // quando a API não conseguiu conferir o telefone.
  if (!found.ok) return null;

  if (found.ok && found.data) {
    // O endpoint devolve o objeto direto, mas já respondeu array em algumas
    // contas — normaliza os dois casos.
    const row = (Array.isArray(found.data) ? found.data[0] : found.data) as
      | Record<string, unknown>
      | undefined;
    const id = row?.PatientId;
    // Paciente excluído lá não serve como vínculo: cria um novo.
    if (id && row?.Status !== "DELETED") return String(id);
  }

  const created = await call<unknown>(integration, "/patient/create", {
    method: "POST",
    body: {
      subscriber_id: integration.subscriberId,
      Name: lead.name?.trim() || `Contato ${phone.slice(-4)}`,
      MobilePhone: phone,
      // Sem isto o Clinicorp recusa quando já existe alguém com o mesmo nome —
      // e "João Silva" repetido é rotina numa base de pacientes. O telefone é
      // o que de fato distingue, e ele já foi consultado acima.
      IgnoreSameName: "X",
      Notes: "Cadastro criado pelo atendimento automático (fechai).",
    },
  });

  if (!created.ok) return null;
  const row = (Array.isArray(created.data) ? created.data[0] : created.data) as
    | Record<string, unknown>
    | undefined;
  const id = row?.PatientId ?? row?.id ?? row?.Id;
  if (id) return String(id);

  // O retorno documentado de /patient/create contém os dados do paciente, mas
  // não promete PatientId. Consulte o cadastro pelo mesmo telefone para obter
  // o identificador de /patient/get; nunca repita o POST para tentar achar o ID.
  const verified = await call<unknown>(integration, "/patient/get", {
    query: { subscriber_id: integration.subscriberId, Phone: phone },
  });
  if (!verified.ok) return null;
  const verifiedRow = (Array.isArray(verified.data) ? verified.data[0] : verified.data) as
    | Record<string, unknown>
    | undefined;
  const verifiedId = verifiedRow?.PatientId;
  return verifiedId && verifiedRow?.Status !== "DELETED" ? String(verifiedId) : null;
}

/** Uma reserva local sem id externo não confirma a agenda de uma conta que usa o espelho. */
export async function clinicorpConfirmationPending(tenantId: string): Promise<boolean> {
  let unavailable = false;
  const features = await getCalendarFeatures(tenantId, () => { unavailable = true; });
  if (unavailable) return true;
  if (!features.clinicorpEnabled) return false;
  const integration = await getIntegration(tenantId);
  return !integration || integration.syncEnabled;
}

const TEST_PATIENT_NAME = "TESTE fechai (chat de teste do agente)";

/** O sandbox também precisa de um paciente, mas nunca de um telefone inventado. */
async function resolveTestPatientId(integration: ClinicorpIntegration): Promise<CallResult<string>> {
  const lookup = () => call<unknown>(integration, "/patient/get", { query: { Name: TEST_PATIENT_NAME } });
  const patientId = (data: unknown): string | null => {
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    if (rows.length !== 1) return null;
    const row = rows[0] as Record<string, unknown> | null;
    if (!row || row.Name !== TEST_PATIENT_NAME || row.Status === "DELETED") return null;
    const id = row.PatientId;
    return id && /^\d+$/.test(String(id)) && Number.isSafeInteger(Number(id)) && Number(id) > 0 ? String(id) : null;
  };
  const found = await lookup();
  if (!found.ok) {
    // O contrato usa 400 para NotFound. Só a ausência explícita permite criar;
    // falha de rede/permissão não autoriza um segundo cadastro.
    const absent = (found.status === 400 || found.status === 404) &&
      /not.?found|n[aã]o encontrad[oa]|nenhum paciente/i.test(found.error);
    if (!absent) return { ok: false, error: `Não foi possível conferir o paciente de teste. ${found.error}` };
  } else {
    const id = patientId(found.data);
    if (id) return { ok: true, data: id };
    const rows = Array.isArray(found.data) ? found.data : found.data ? [found.data] : [];
    if (rows.length) return { ok: false, error: "A busca do paciente de teste não identificou um cadastro único e válido. Confira esse cadastro no Clinicorp." };
  }

  const created = await call<unknown>(integration, "/patient/create", {
    method: "POST",
    body: {
      subscriber_id: integration.subscriberId,
      Name: TEST_PATIENT_NAME,
      Notes: "Cadastro exclusivo para testes de agendamento do fechai. Não é um paciente real e não recebe mensagens ou lembretes.",
      // Sem IgnoreSameName: o Clinicorp deve recusar um cadastro duplicado.
      // Sem MobilePhone: os dígitos do id do sandbox não são um telefone.
    },
  });
  if (!created.ok) return { ok: false, error: `O Clinicorp não confirmou o cadastro de teste. ${created.error}` };

  // /patient/create não promete retornar o id. A releitura usa o nome fixo,
  // nunca o nome da pessoa que o usuário simulou na conversa.
  const verified = await lookup();
  const id = verified.ok ? patientId(verified.data) : null;
  return id ? { ok: true, data: id }
    : { ok: false, error: "O cadastro de teste não foi confirmado no Clinicorp. Confira o paciente TESTE fechai antes de tentar novamente." };
}

// ---------------------------------------------------------------------------
// Espelho: criar e cancelar
// ---------------------------------------------------------------------------

export type ClinicorpEventInput = {
  title: string;
  /** Nome do paciente, que pode ser diferente de quem enviou a mensagem. */
  patientName?: string;
  notes?: string | null;
  serviceType?: string | null;
  /** Procedimento de interesse (`Appointment.procedure`), também em `Procedures`. */
  procedure?: string | null;
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
  /** `isTest`: contato do chat de teste, com telefone sintético ("sandbox:<agente>"). */
  lead?: { name: string | null; phone: string | null; isTest?: boolean } | null;
  /** Referência estável da fila: permite reconhecer um envio aceito sem resposta. */
  referenceId?: string;
  /** Recuperação de uma consulta anterior à fila automática. */
  recoverExisting?: boolean;
  target?: ClinicorpSyncTarget;
};

export type ClinicorpSyncTarget = {
  subscriberId: string;
  businessId: string;
  dentistId: string | null;
  categoryDescription: string | null;
};

export type ClinicorpLookupResult =
  | { status: "found"; appointmentId: string }
  | { status: "absent" }
  | { status: "unavailable"; error: string };

function withSyncTarget(integration: ClinicorpIntegration, target?: ClinicorpSyncTarget): ClinicorpIntegration | null {
  if (!target) return integration;
  // Trocar a conexão para outro assinante não autoriza enviar os dados da fila para ele.
  return integration.subscriberId === target.subscriberId ? { ...integration, ...target } : null;
}

async function lookupAppointment(integration: ClinicorpIntegration, input: ClinicorpEventInput): Promise<ClinicorpLookupResult> {
  const day = localDate(input.startsAt, input.timeZone);
  const response = await call<unknown>(integration, "/appointment/list", {
    query: { from: day, to: day, businessId: integration.businessId ?? undefined },
  });
  if (!response.ok || !Array.isArray(response.data)) {
    return { status: "unavailable", error: response.ok ? "O Clinicorp não devolveu uma agenda válida para conferir o envio." : response.error };
  }
  const marker = input.referenceId ? `[fechai:${input.referenceId}]` : null;
  const expectedName = input.lead?.isTest ? TEST_PATIENT_NAME : input.patientName?.trim() || input.lead?.name?.trim() || input.title;
  const expectedPhone = input.lead?.phone ? clinicorpPhone(input.lead.phone) : "";
  const matches: string[] = [];
  for (const raw of response.data) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { status: "unavailable", error: "A agenda do Clinicorp contém registros incompletos; não é seguro repetir o envio." };
    const row = raw as Record<string, unknown>;
    if ((row.ItemType && row.ItemType !== "APPOINTMENT") || row.Canceled === "X" || row.Deleted === "X") continue;
    const date = agendaDay(row, input.timeZone);
    const start = date && typeof row.fromTime === "string" ? parseLocalDateTime(date, row.fromTime, input.timeZone) : null;
    const end = date && typeof row.toTime === "string" ? parseLocalDateTime(date, row.toTime, input.timeZone) : null;
    if (!start || !end) return { status: "unavailable", error: "A agenda do Clinicorp contém horários incompletos; não é seguro repetir o envio." };
    const sameSlot = start.getTime() === input.startsAt.getTime() && end.getTime() === input.endsAt.getTime();
    const sameProfessional = !integration.dentistId || String(row.Dentist_PersonId ?? "") === integration.dentistId;
    const sameBusiness = row.Clinic_BusinessId == null || String(row.Clinic_BusinessId) === integration.businessId;
    const marked = marker && [row.Notes, row.Procedures].some((text) => typeof text === "string" && text.includes(marker));
    // Algumas contas não devolvem Procedures/Notes. Identidade + horário +
    // profissional exatos também reconhecem uma consulta aceita sem resposta.
    const sameIdentity = row.PatientName === expectedName &&
      (input.lead?.isTest === true || (expectedPhone && typeof row.MobilePhone === "string" && clinicorpPhone(row.MobilePhone) === expectedPhone));
    if (!marked && !(sameSlot && sameProfessional && sameBusiness && sameIdentity)) continue;
    if (!sameSlot || !sameProfessional || !sameBusiness) return { status: "unavailable", error: "A referência do fechai foi encontrada em outro horário ou profissional. O envio precisa ser conferido." };
    const id = row.id;
    if (!id || !/^\d+$/.test(String(id)) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0) {
      return { status: "unavailable", error: "O Clinicorp não devolveu um identificador válido para a consulta encontrada." };
    }
    matches.push(String(id));
  }
  if (matches.length > 1) return { status: "unavailable", error: "Mais de uma consulta corresponde a este envio. Nenhuma nova consulta será criada." };
  return matches.length ? { status: "found", appointmentId: matches[0] } : { status: "absent" };
}

/** Só consulta. Também permite limpar um envio antigo após desligar a integração. */
export async function lookupClinicorpAppointment(tenantId: string, input: ClinicorpEventInput): Promise<ClinicorpLookupResult> {
  try {
    const row = await getIntegration(tenantId, { ignoreFeatureFlag: true });
    const integration = row && withSyncTarget(row, input.target);
    if (!integration) return { status: "unavailable", error: "A conexão original do Clinicorp não está disponível para conferir o envio." };
    return await lookupAppointment(integration, input);
  } catch {
    return { status: "unavailable", error: "Não foi possível conferir o envio no Clinicorp." };
  }
}

/** "09:30" no fuso do negócio — a API espera hora local, não UTC. */
function localTime(date: Date, timeZone: string): string {
  const p = partsInZone(date, timeZone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** "2026-09-05" no fuso do negócio. */
function localDate(date: Date, timeZone: string): string {
  const p = partsInZone(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/**
 * Espelha o compromisso no Clinicorp. Distingue envio confirmado, falha e
 * integração desligada para o chamador não prometer um envio que não ocorreu.
 *
 * Nunca lança — ver o comentário no topo do arquivo.
 */
export async function pushAppointmentToClinicorp(
  tenantId: string,
  input: ClinicorpEventInput,
): Promise<ClinicorpSyncResult> {
  // O chat de teste marca de verdade, usando um cadastro exclusivo de teste.
  // O telefone sintético nunca sai para o Clinicorp.
  const isTest = input.lead?.isTest === true;

  // O aviso do card precisa dizer QUAL agendamento falhou: "falhou" sozinho
  // não deixa a clínica achar o horário nem saber o que conferir. Quem chama
  // recebe só o motivo, porque já tem o próprio contexto na mão.
  const who = isTest
    ? "do chat de teste"
    : `de ${input.patientName?.trim() || input.lead?.name?.trim() || input.lead?.phone || "contato sem nome"}`;
  const context = `Agendamento ${who} para ${formatInZone(input.startsAt, input.timeZone)}, salvo só no fechai`;
  const failed = async (error: string, reason?: "conflict"): Promise<ClinicorpSyncResult> => {
    await recordOutcome(tenantId, `${context}. ${error}`);
    return { status: "failed", error, ...(reason ? { reason } : {}) };
  };
  try {
    let inactiveState: ClinicorpIntegrationState | undefined;
    const connected = await getIntegration(tenantId, { onInactive: (state) => { inactiveState = state; } });
    const integration = connected && withSyncTarget(connected, input.target);
    if (!integration) {
      if (connected) return await failed("A conexão do Clinicorp mudou de assinante. O envio continua associado à clínica original.");
      if (inactiveState === "credentials_error") return await failed("As credenciais do Clinicorp não puderam ser lidas. Reconecte a integração antes de confirmar a consulta.");
      if (inactiveState === "unavailable") return await failed("Não foi possível carregar a configuração do Clinicorp. O envio não foi confirmado.");
      if (inactiveState === "not_connected" && (await getCalendarFeatures(tenantId)).clinicorpEnabled) {
        return await failed("O Clinicorp está habilitado, mas não está conectado. Conecte a clínica antes de confirmar a consulta.");
      }
      return { status: "skipped" };
    }
    if (!integration.syncEnabled) return { status: "skipped" };
    if (!integration.businessId) {
      return await failed("Nenhuma clínica escolhida para receber os agendamentos: escolha a clínica abaixo e salve as preferências.");
    }
    if (input.referenceId) {
      const existing = await lookupAppointment(integration, input);
      if (existing.status === "found") {
        await recordOutcome(tenantId, null);
        clearClinicorpAgendaCache(tenantId);
        return { status: "synced", appointmentId: existing.appointmentId };
      }
      if (existing.status === "unavailable") return await failed(existing.error);
    }
    if (!isTest && (!input.lead?.phone || !clinicorpPhone(input.lead.phone))) {
      return await failed(input.lead
        ? "O contato não tem telefone, e o Clinicorp precisa dele para achar ou cadastrar o paciente. Adicione o telefone em Contatos."
        : "O horário não tem contato vinculado, e o Clinicorp precisa de um paciente com telefone. Vincule um contato ao marcar.");
    }

    // O nome continua no banco por compatibilidade. Resolva o ID real antes de
    // enviar: descrições duplicadas não podem escolher uma categoria ao acaso.
    let categoryId: string | undefined;
    if (integration.categoryDescription) {
      const categories = await fetchCategories(integration);
      if (!categories.ok) return await failed(`Não foi possível carregar as categorias. ${categories.error}`);
      const matches = categories.data.filter((c) => c.name === integration.categoryDescription);
      if (matches.length !== 1) {
        return await failed(matches.length
          ? `Existem ${matches.length} categorias chamadas "${integration.categoryDescription}" no Clinicorp. Renomeie uma delas lá ou escolha outra categoria abaixo.`
          : `A categoria "${integration.categoryDescription}" não existe mais no Clinicorp. Escolha outra categoria abaixo.`);
      }
      categoryId = matches[0].id;
    }

    for (const id of [integration.businessId, integration.dentistId, categoryId]) {
      if (id && (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0)) {
        return await failed("O identificador da clínica, profissional ou categoria é inválido ou excede a precisão suportada.");
      }
    }

    const patientName = input.patientName?.trim() || input.lead?.name?.trim() || input.title;
    // O telefone do contato pode ser da pessoa que marcou para outra. Nesse
    // caso não vincule o prontuário encontrado pelo telefone ao paciente novo.
    // Essa cautela é só do Patient_PersonId: nome diferente (inclusive perfil
    // curto x nome completo) não apaga o telefone para contato da consulta.
    const samePerson = !input.patientName || patientName.localeCompare(input.lead?.name?.trim() ?? "", "pt-BR", { sensitivity: "base" }) === 0;
    const testPatient = isTest ? await resolveTestPatientId(integration) : null;
    if (testPatient && !testPatient.ok) return await failed(testPatient.error);
    const patientId = testPatient?.ok ? testPatient.data
      : input.lead && samePerson ? await resolvePatientId(integration, input.lead) : null;
    if (patientId && (!/^\d+$/.test(patientId) || !Number.isSafeInteger(Number(patientId)) || Number(patientId) <= 0)) {
      return await failed("O identificador do paciente é inválido ou excede a precisão suportada.");
    }

    // O contrato de create_appointment_by_api documenta Procedures, não Notes.
    // Inclua também o motivo clínico da conversa, além do tipo que define a duração.
    const procedures = [
      ...(isTest ? ["Agendamento de teste feito no chat de teste do fechai. Pode excluir."] : []),
      input.serviceType?.trim(),
      // A nota do agente costuma já dizer o procedimento; não repita.
      input.procedure?.trim() && !input.notes?.toLowerCase().includes(input.procedure.trim().toLowerCase())
        ? `Procedimento: ${input.procedure.trim()}` : null,
      input.notes?.trim(),
      input.referenceId ? `[fechai:${input.referenceId}]` : null,
    ].filter(Boolean).join("\n");
    const mobilePhone = !isTest && input.lead?.phone
      ? clinicorpPhone(input.lead.phone) : undefined;

    const res = await call<unknown>(integration, "/appointment/create_appointment_by_api", {
      method: "POST",
      body: {
        subscriber_id: integration.subscriberId,
        Clinic_BusinessId: Number(integration.businessId),
        ...(integration.dentistId ? { Dentist_PersonId: Number(integration.dentistId) } : {}),
        ...(patientId ? { Patient_PersonId: Number(patientId) } : {}),
        PatientName: isTest ? TEST_PATIENT_NAME : patientName,
        ...(mobilePhone ? { MobilePhone: mobilePhone } : {}),
        // A data vai como o dia local em ISO. Mandar o instante UTC cru faria o
        // agendamento cair no dia anterior para horários da manhã no Brasil.
        date: `${localDate(input.startsAt, input.timeZone)}T00:00:00.000Z`,
        fromTime: localTime(input.startsAt, input.timeZone),
        toTime: localTime(input.endsAt, input.timeZone),
        ...(categoryId ? { CategoryId: Number(categoryId) } : {}),
        ...(procedures ? { Procedures: procedures } : {}),
      },
    });

    if (!res.ok) {
      console.error("[clinicorp] criar agendamento falhou", res.error);
      const normalized = res.error.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const conflict = /horario[^.\n]*ocupado/i.test(normalized);
      if (input.referenceId) {
        const verified = await lookupAppointment(integration, input);
        if (verified.status === "found") {
          await recordOutcome(tenantId, null);
          clearClinicorpAgendaCache(tenantId);
          return { status: "synced", appointmentId: verified.appointmentId };
        }
      }
      return await failed(res.error, conflict ? "conflict" : undefined);
    }

    const row = (Array.isArray(res.data) ? res.data[0] : res.data) as
      | Record<string, unknown>
      | undefined;
    const id = row?.id ?? row?.Id;
    const validId = Boolean(id) && /^\d+$/.test(String(id)) && Number.isSafeInteger(Number(id)) && Number(id) > 0;
    if (!validId || (row?.Status && row.Status !== "CREATED")) {
      if (input.referenceId) {
        const verified = await lookupAppointment(integration, input);
        if (verified.status === "found") {
          await recordOutcome(tenantId, null);
          clearClinicorpAgendaCache(tenantId);
          return { status: "synced", appointmentId: verified.appointmentId };
        }
      }
      const status = row?.Status ? ` (status "${String(row.Status)}")` : "";
      const reason = clinicorpReason(res.data);
      const detail = reason ? ` Motivo informado: "${reason}".`
        : res.emptyBody ? ` Resposta HTTP ${res.status} sem conteúdo.`
          : !validId ? " A resposta não contém um identificador de agendamento válido."
            : " O status retornado não confirma a criação.";
      // Nunca registre o corpo, os headers ou os valores dos campos: podem
      // conter credenciais e dados do paciente. A estrutura permite diagnosticar
      // um retorno vazio ou diferente do contrato sem expor essas informações.
      console.error("[clinicorp] criar agendamento sem confirmação", {
        tenantId, httpStatus: res.status, emptyBody: res.emptyBody,
        responseType: res.data === null ? "null" : Array.isArray(res.data) ? "array" : typeof res.data,
        ...(Array.isArray(res.data) ? { rowCount: res.data.length } : {}),
        responseFields: row && typeof row === "object" ? Object.keys(row).slice(0, 25) : [],
        hasId: id !== undefined && id !== null, idType: typeof id, idValid: validId,
        statusProvided: Boolean(row?.Status), statusConfirmed: row?.Status === "CREATED",
        isTest, patientProvided: Boolean(patientId), phoneProvided: Boolean(mobilePhone),
      });
      return await failed(`O Clinicorp respondeu sem confirmar a criação${status}.${detail} Confira a agenda da clínica antes de marcar de novo, para não duplicar.`);
    }
    await recordOutcome(tenantId, null);
    clearClinicorpAgendaCache(tenantId);
    return { status: "synced", appointmentId: String(id) };
  } catch (err) {
    console.error("[clinicorp] criar agendamento falhou", err);
    const detail = err instanceof Error && err.message ? ` (${err.message.slice(0, 120)})` : "";
    return failed(`Erro inesperado ao enviar ao Clinicorp${detail}. Confira a agenda da clínica antes de marcar de novo.`);
  }
}

/** Cancela o agendamento espelhado. Silencioso pelo mesmo motivo do push. */
export async function cancelAppointmentInClinicorp(
  tenantId: string,
  clinicorpAppointmentId: string,
  target?: ClinicorpSyncTarget,
): Promise<boolean> {
  try {
    const connected = await getIntegration(tenantId, { ignoreFeatureFlag: true });
    const integration = connected && withSyncTarget(connected, target);
    if (!integration) return false;

    const res = await call<unknown>(integration, "/appointment/cancel_appointment", {
      method: "POST",
      body: { subscriber_id: integration.subscriberId, id: clinicorpAppointmentId },
    });
    if (!res.ok) {
      console.error("[clinicorp] cancelar agendamento falhou", res.error);
      await recordOutcome(tenantId, `Cancelamento do agendamento ${clinicorpAppointmentId} no Clinicorp não foi confirmado; ele pode continuar na agenda da clínica. ${res.error}`);
      return false;
    }
    clearClinicorpAgendaCache(tenantId);
    return true;
  } catch (err) {
    console.error("[clinicorp] cancelar agendamento falhou", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Disponibilidade
// ---------------------------------------------------------------------------

export type ClinicorpBusyBlock = { startsAt: Date; endsAt: Date };

export type ClinicorpReportData = {
  available: boolean;
  integrationState?: ClinicorpIntegrationState;
  error: string | null;
  appointments: { id: string; statusType: string | null; canceled: boolean }[];
  statusTypes: { type: string; description: string }[];
};

/** Leitura para comparecimento, sem alterar a agenda local ou enviar mensagens. */
export async function readClinicorpReport(tenantId: string, from: string, to: string): Promise<ClinicorpReportData> {
  let integrationState: ClinicorpIntegrationState = "unavailable";
  const statusTypes: ClinicorpReportData["statusTypes"] = [];
  const unavailable = (error: string): ClinicorpReportData => ({ available: false, integrationState, error, appointments: [], statusTypes });
  // Não levar o corpo da resposta de terceiros (pacientes/segredos) ao relatório.
  const requestError = (subject: string, result: Extract<CallResult<unknown>, { ok: false }>) =>
    result.status === 401 || result.status === 403
      ? `O Clinicorp recusou o acesso à ${subject} (HTTP ${result.status}). Confira as permissões da API em Integrações → Calendários.`
      : `Não foi possível consultar a ${subject} no Clinicorp${result.status ? ` (HTTP ${result.status})` : ""}. Tente importar os dados novamente.`;
  try {
    const integration = await getIntegration(tenantId, { onInactive: (state) => { integrationState = state; } });
    if (!integration) {
      const messages: Record<ClinicorpIntegrationState, string> = {
        not_connected: "Esta conta não possui uma conexão Clinicorp cadastrada. Configure em Integrações → Calendários.",
        disabled: "O Clinicorp está desabilitado em Integrações → Calendários. As credenciais cadastradas foram preservadas.",
        credentials_error: "Não foi possível ler as credenciais cadastradas do Clinicorp. Revise a conexão em Integrações → Calendários.",
        unavailable: "Não foi possível carregar a configuração do Clinicorp. Tente importar os dados novamente.",
        configured: "Não foi possível carregar a configuração do Clinicorp.",
      };
      return unavailable(messages[integrationState]);
    }
    integrationState = "configured";
    if (!integration.businessId) return unavailable("Escolha uma clínica e salve as preferências em Integrações → Calendários antes de consultar o comparecimento.");
    const [appointments, statuses] = await Promise.all([
      call<unknown>(integration, "/appointment/list", { query: { from, to,
        businessId: integration.businessId ?? undefined, includeCanceled: "X", includeDeleted: "X" } }),
      call<unknown>(integration, "/appointment/status_list"),
    ]);
    if (!statuses.ok) return unavailable(requestError("lista de status", statuses));
    if (!Array.isArray(statuses.data)) return unavailable("O Clinicorp não devolveu uma lista de status válida. Tente importar os dados novamente.");
    const safeId = (value: unknown): string | null => typeof value === "string" && /^\d+$/.test(value) ? value
      : typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : null;
    const mapping = new Map<string, string>();
    let invalidStatuses = false;
    for (const raw of statuses.data) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) { invalidStatuses = true; continue; }
      const row = raw as Record<string, unknown>;
      const id = safeId(row.id);
      if (id && typeof row.Type === "string" && row.Type.trim()) {
        mapping.set(id, row.Type);
        statusTypes.push({ type: row.Type, description: String(row.Description ?? row.Type) });
      } else { invalidStatuses = true; }
    }
    // A lista de status é independente da agenda: uma falha não apaga a outra.
    if (invalidStatuses) return unavailable("A lista de status do Clinicorp está incompleta; não foi possível conferir o comparecimento.");
    if (!appointments.ok) return unavailable(requestError("agenda do período", appointments));
    if (!Array.isArray(appointments.data)) return unavailable("O Clinicorp não devolveu uma agenda válida. Tente importar os dados novamente.");
    const rows: ClinicorpReportData["appointments"] = [];
    for (const raw of appointments.data) {
      if (!raw || typeof raw !== "object") return unavailable("Agenda do Clinicorp incompleta.");
      const row = raw as Record<string, unknown>;
      if (row.ItemType && row.ItemType !== "APPOINTMENT") continue;
      const id = safeId(row.id);
      if (!id) return unavailable("Clinicorp retornou um ID fora da precisão segura; não foi possível vincular o comparecimento.");
      rows.push({ id, statusType: mapping.get(safeId(row.StatusId) ?? "") ?? null,
        canceled: row.Canceled === "X" || row.Deleted === "X" });
    }
    return { available: true, integrationState, error: null, appointments: rows, statusTypes };
  } catch {
    return unavailable("Não foi possível concluir a consulta do Clinicorp. Comparecimentos vinculados permanecem pendentes para conferência.");
  }
}

// ---------------------------------------------------------------------------
// Agenda da clínica na tela /agenda (só leitura)
// ---------------------------------------------------------------------------

/** A página espera esta leitura para desenhar: um Clinicorp lento não pode segurá-la por 10s. */
const AGENDA_TIMEOUT_MS = 6_000;

export type ClinicorpAgendaItem = {
  id: string;
  startsAt: Date;
  /** Null quando o Clinicorp não mandou um fim válido: a tela mostra só o início. */
  endsAt: Date | null;
  patientName: string;
  phone: string | null;
  professional: string | null;
  notes: string | null;
  /** Metadados explícitos, quando presentes na resposta de /appointment/list. */
  categoryId?: string | null;
  category?: string | null;
  /** Cancelada continua visível, mas não ocupa vaga nem recebe lembrete. */
  canceled?: boolean;
};

/** Rótulo da tela para consulta sem nome — nunca vai numa mensagem ao paciente. */
export const CLINICORP_UNNAMED_PATIENT = "Paciente sem nome";

export type ClinicorpAgenda =
  | { status: "off" }
  /** `fetchedAt`: quando a leitura saiu do Clinicorp — do cache, pode ser de minutos atrás. */
  | { status: "ok"; items: ClinicorpAgendaItem[]; skipped: number; fetchedAt: number }
  | { status: "error"; error: string };

/**
 * O dia local de um agendamento da lista de um período.
 *
 * Na consulta de um dia só (`fetchBusyBlocks`) o dia é o da própria consulta;
 * num mês, cada linha precisa dizer o seu. `AtomicDate` (YYYYMMDD) não tem
 * ambiguidade e vem primeiro. `date` é o que sobra, em dois formatos: o dia
 * local à meia-noite UTC — exatamente como `pushAppointmentToClinicorp` envia —
 * ou um instante de verdade, convertido para o fuso da agenda. Ler o primeiro
 * como instante jogaria no Brasil a consulta para o dia anterior.
 */
function agendaDay(row: Record<string, unknown>, timeZone: string): string | null {
  const atomic = row.AtomicDate;
  if ((typeof atomic === "number" || typeof atomic === "string") && /^\d{8}$/.test(String(atomic))) {
    const s = String(atomic);
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  const date = typeof row.date === "string" ? row.date.trim() : "";
  if (/^\d{4}-\d{2}-\d{2}(T00:00(:00(\.0+)?)?(Z|\+00:00))?$/.test(date)) return date.slice(0, 10);
  const at = new Date(date);
  return date && !Number.isNaN(at.getTime()) ? dayKeyInZone(at, timeZone) : null;
}

/**
 * As consultas de pacientes que estão no Clinicorp num período (dias locais,
 * inclusive), para a `/agenda` mostrar também o que a recepção marcou lá.
 *
 * **Só leitura, nada é importado**: a linha não vira `Appointment`, então não
 * conta em relatório, não tem ações na tela e não há regra de quem vence numa
 * divergência — o Clinicorp continua dono do que foi marcado nele. Quem
 * deduplica o que o próprio fechai espelhou é a tela, por
 * `clinicorpAppointmentId`. Os lembretes dessas consultas têm caminho próprio:
 * `workers/follow-up-worker/clinicorp-reminders.ts`.
 *
 * Mostra a clínica inteira, mesmo com `dentistId`: a pessoa quer ver a agenda
 * que tem lá, não só a fatia que bloqueia horário do agente. Compromissos e
 * bloqueios (`includeAssigns`) ficam de fora — não são consultas.
 *
 * Nunca lança e não grava `lastError`: ler a agenda para desenhar a tela não é
 * envio, e um erro aqui não pode apagar nem mascarar o aviso de um envio.
 *
 * **Cache no servidor, servido enquanto é revalidado** (`AGENDA_CACHE_MS`):
 * trocar de dia ou de mês é uma navegação que refaz a página, e esperar o
 * Clinicorp a cada clique travava a tela. A conexão (flag, credencial, clínica)
 * é conferida sempre — desligar para na hora —, só a resposta de lá é
 * reaproveitada. Quem garante que ela não fica velha é o pulso ao vivo
 * (`readAgendaPulse`, com `fresh`): relê o mês aberto a cada 15s, e na hora
 * quando a página chega com `fetchedAt` antigo.
 */
export async function listClinicorpAgenda(
  tenantId: string,
  from: string,
  to: string,
  timeZone: string,
  { fresh = false }: { fresh?: boolean } = {},
): Promise<ClinicorpAgenda> {
  try {
    // `as`: o valor muda dentro do callback, e sem isso o TS estreita para "configured".
    let state = "configured" as ClinicorpIntegrationState;
    const integration = await getIntegration(tenantId, { onInactive: (s) => { state = s; } });
    if (!integration) {
      return state === "unavailable"
        ? { status: "error", error: "Não foi possível carregar a configuração do Clinicorp." }
        : { status: "off" };
    }
    // Sem clínica escolhida a lista traria todas as unidades do assinante; o
    // card de sincronização já pede para escolher.
    if (!integration.businessId) return { status: "off" };

    const store = agendaCache().agenda;
    const key = [tenantId, integration.subscriberId, integration.businessId, from, to, timeZone].join("|");
    const hit = store.get(key);
    if (!fresh && hit && Date.now() - hit.at < hit.ttl) return await hit.value;

    // A promessa entra no cache antes de resolver: duas abas abrindo o mesmo
    // mês esperam a mesma chamada em vez de fazer duas.
    const entry = { at: Date.now(), ttl: AGENDA_CACHE_MS, value: fetchAgenda(integration, from, to, timeZone) };
    store.delete(key);
    store.set(key, entry);
    while (store.size > AGENDA_CACHE_MAX) store.delete(store.keys().next().value!);
    const result = await entry.value;
    // Falha fica pouco: só o bastante para uma série de cliques não esperar o
    // timeout de novo a cada um. O pulso seguinte já tenta outra vez.
    if (result.status !== "ok") entry.ttl = AGENDA_ERROR_CACHE_MS;
    return result;
  } catch (err) {
    console.error("[clinicorp] ler agenda do período falhou", err);
    return { status: "error", error: "Não foi possível ler a agenda do Clinicorp." };
  }
}

/**
 * Quanto uma leitura do mês é servida sem ir ao Clinicorp. Longo de propósito:
 * a página nunca espera por ela se houver algo em cache, e o pulso da tela
 * relê o mês aberto (ver `listClinicorpAgenda`). Curto, cada volta a um mês
 * visto há pouco esperava o Clinicorp de novo.
 */
const AGENDA_CACHE_MS = 30 * 60_000;
const AGENDA_ERROR_CACHE_MS = 10_000;
/** Nome de profissional quase nunca muda: não vale uma chamada a cada releitura. */
const PROFESSIONALS_CACHE_MS = 10 * 60_000;
/** Teto de meses guardados no processo (contas × meses abertos). */
const AGENDA_CACHE_MAX = 300;

type AgendaCache = {
  agenda: Map<string, { at: number; ttl: number; value: Promise<ClinicorpAgenda> }>;
  professionals: Map<string, { at: number; names: Map<string, string> }>;
};

/**
 * No `globalThis`, como o Prisma: a página e a rota do pulso são compiladas em
 * pacotes diferentes, e cada um teria o próprio Map — o pulso reabasteceria um
 * cache que a página nunca lê.
 */
function agendaCache(): AgendaCache {
  const g = globalThis as unknown as { __clinicorpAgendaCache?: AgendaCache };
  g.__clinicorpAgendaCache ??= { agenda: new Map(), professionals: new Map() };
  return g.__clinicorpAgendaCache;
}

/** Esquece o que foi lido de uma conta (ou de todas) — nova credencial, desconexão, testes. */
export function clearClinicorpAgendaCache(tenantId?: string): void {
  const cache = agendaCache();
  for (const store of [cache.agenda, cache.professionals]) {
    for (const key of [...store.keys()]) {
      if (!tenantId || key.startsWith(`${tenantId}|`)) store.delete(key);
    }
  }
}

/** Id → nome dos profissionais. Falha devolve vazio e não entra no cache. */
async function professionalNames(integration: ClinicorpIntegration): Promise<Map<string, string>> {
  const store = agendaCache().professionals;
  const key = `${integration.tenantId}|${integration.subscriberId}`;
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < PROFESSIONALS_CACHE_MS) return hit.names;

  const res = await call<unknown>(integration, "/professional/list_all_professionals", { timeoutMs: AGENDA_TIMEOUT_MS });
  const names = new Map<string, string>();
  if (!res.ok || !Array.isArray(res.data)) return names;
  for (const p of res.data) {
    if (!p || typeof p !== "object") continue;
    const { id, name } = p as Record<string, unknown>;
    if (id != null && typeof name === "string" && name.trim()) names.set(String(id), name.trim());
  }
  store.set(key, { at: Date.now(), names });
  return names;
}

/** A chamada de fato. Nunca rejeita: a promessa fica no cache. */
async function fetchAgenda(
  integration: ClinicorpIntegration,
  from: string,
  to: string,
  timeZone: string,
): Promise<ClinicorpAgenda> {
  try {
    const [agenda, names] = await Promise.all([
      call<unknown>(integration, "/appointment/list", {
        query: { from, to, businessId: integration.businessId ?? undefined, includeCanceled: "X" },
        timeoutMs: AGENDA_TIMEOUT_MS,
      }),
      // Só dá nome ao profissional; se falhar, as consultas aparecem sem ele.
      professionalNames(integration),
    ]);
    if (!agenda.ok) return { status: "error", error: agenda.error };
    if (!Array.isArray(agenda.data)) return { status: "error", error: "O Clinicorp não devolveu uma agenda válida." };

    const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
    const items: ClinicorpAgendaItem[] = [];
    // Linha que não dá para posicionar na grade é contada, não escondida em
    // silêncio: a tela avisa que faltou alguma.
    let skipped = 0;
    for (const raw of agenda.data) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) { skipped++; continue; }
      const r = raw as Record<string, unknown>;
      if (r.ItemType && r.ItemType !== "APPOINTMENT") continue;
      if (r.Deleted === "X") continue;

      const id = typeof r.id === "string" && /^\d+$/.test(r.id) ? r.id
        : typeof r.id === "number" && Number.isInteger(r.id) && r.id > 0 ? String(r.id) : null;
      const day = agendaDay(r, timeZone);
      const startsAt = day && typeof r.fromTime === "string" ? parseLocalDateTime(day, r.fromTime, timeZone) : null;
      if (!id || !day || !startsAt) { skipped++; continue; }
      const endsAt = typeof r.toTime === "string" ? parseLocalDateTime(day, r.toTime, timeZone) : null;

      items.push({
        id,
        startsAt,
        endsAt: endsAt && endsAt > startsAt ? endsAt : null,
        patientName: text(r.PatientName) ?? CLINICORP_UNNAMED_PATIENT,
        phone: text(r.MobilePhone),
        professional: r.Dentist_PersonId != null ? names.get(String(r.Dentist_PersonId)) ?? null : null,
        notes: text(r.Notes)?.slice(0, 300) ?? null,
        categoryId: typeof r.CategoryId === "string" && /^\d+$/.test(r.CategoryId) ? r.CategoryId
          : typeof r.CategoryId === "number" && Number.isSafeInteger(r.CategoryId) && r.CategoryId > 0
            ? String(r.CategoryId) : null,
        category: text(r.CategoryDescription),
        canceled: r.Canceled === "X",
      });
    }
    items.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    return { status: "ok", items, skipped, fetchedAt: Date.now() };
  } catch (err) {
    console.error("[clinicorp] ler agenda do período falhou", err);
    return { status: "error", error: "Não foi possível ler a agenda do Clinicorp." };
  }
}

/**
 * O que já está ocupado na agenda da clínica num dia.
 *
 * `includeAssigns` traz também eventos e compromissos do profissional (almoço,
 * bloqueio, reunião) — para o agente esses horários são tão indisponíveis
 * quanto uma consulta. Cancelados e excluídos ficam de fora por padrão, que é o
 * comportamento correto: aquele horário voltou a estar livre.
 */
async function fetchBusyBlocks(
  integration: ClinicorpIntegration,
  day: string,
  timeZone: string,
  ignoreAppointmentId?: string,
): Promise<ClinicorpBusyBlock[] | null> {
  const res = await call<unknown>(integration, "/appointment/list", {
    query: {
      subscriber_id: integration.subscriberId,
      from: day,
      to: day,
      businessId: integration.businessId ?? undefined,
      includeAssigns: "X",
    },
  });
  if (!res.ok) return null;

  // Uma resposta vazia/malformada não comprova que a agenda está livre.
  if (!Array.isArray(res.data)) return null;
  const rows = res.data;
  const blocks: ClinicorpBusyBlock[] = [];

  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const r = row as Record<string, unknown>;
    // Ao reagendar, o espelho da própria consulta não ocupa o novo intervalo.
    if (ignoreAppointmentId && String(r.id) === ignoreAppointmentId) continue;

    // Filtra por profissional só quando a conta fixou um: com dentista
    // definido, a agenda de um colega não bloqueia o horário. Sem dentista, o
    // agendamento é da clínica e tudo conta.
    if (integration.dentistId && r.Dentist_PersonId) {
      if (String(r.Dentist_PersonId) !== integration.dentistId) continue;
    }
    if (r.Canceled === "X" || r.Deleted === "X") continue;

    // Dia inteiro (feriado, férias): bloqueia o dia todo.
    if (r.AllDay === "X" || r.AllDay === true) {
      const start = parseLocalDateTime(day, "00:00", timeZone);
      if (!start) return null;
      const p = partsInZone(start, timeZone);
      const end = zonedTimeToUtc(p.year, p.month, p.day + 1, 0, 0, timeZone);
      blocks.push({ startsAt: start, endsAt: end });
      continue;
    }

    const from = typeof r.fromTime === "string" ? r.fromTime : null;
    const to = typeof r.toTime === "string" ? r.toTime : null;
    if (!from || !to) return null;

    const startsAt = parseLocalDateTime(day, from, timeZone);
    const endsAt = parseLocalDateTime(day, to, timeZone);
    if (!startsAt || !endsAt || endsAt <= startsAt) return null;
    blocks.push({ startsAt, endsAt });
  }

  return blocks;
}

/**
 * Tudo que está ocupado no Clinicorp num dia local — base da lista de horários
 * livres que o agente oferece. Uma chamada por dia em vez de uma por horário.
 *
 * Desligado devolve []; falha devolve null. Nunca transforma disponibilidade
 * desconhecida em agenda vazia. O chamador decide como avisar o contato.
 */
export async function listClinicorpBusyBlocks(
  tenantId: string,
  day: string,
  timeZone: string,
): Promise<ClinicorpBusyBlock[] | null> {
  try {
    let unavailable = false;
    const integration = await getIntegration(tenantId, { onUnavailable: () => { unavailable = true; } });
    if (unavailable) return null;
    if (!integration || !integration.checkAvailability) return [];
    const blocks = await fetchBusyBlocks(integration, day, timeZone);
    if (!blocks) await recordOutcome(tenantId, `Não foi possível conferir a disponibilidade no Clinicorp em ${day}. Novos horários não serão oferecidos até a consulta funcionar.`);
    return blocks;
  } catch (err) {
    console.error("[clinicorp] listar agenda do dia falhou", err);
    return null;
  }
}

/**
 * O horário está ocupado na agenda do Clinicorp?
 *
 * Devolve false quando desligada, null quando não foi possível conferir.
 * Consultas já combinadas são preservadas; novas reservas exigem a leitura
 * quando a conta escolheu checar disponibilidade no Clinicorp.
 */
export async function hasClinicorpConflict(
  tenantId: string,
  startsAt: Date,
  endsAt: Date,
  timeZone: string,
  ignoreAppointmentId?: string,
): Promise<boolean | null> {
  try {
    let unavailable = false;
    const integration = await getIntegration(tenantId, { onUnavailable: () => { unavailable = true; } });
    if (unavailable) return null;
    if (!integration || !integration.checkAvailability) return false;

    const blocks = await fetchBusyBlocks(integration, localDate(startsAt, timeZone), timeZone, ignoreAppointmentId);
    if (!blocks) {
      await recordOutcome(tenantId, `Não foi possível conferir a disponibilidade no Clinicorp em ${localDate(startsAt, timeZone)}. Nenhum novo horário foi confirmado.`);
      return null;
    }

    // Mesma regra de sobreposição do `hasConflict` do repository: encostar não
    // é conflito (14:00–15:00 e 15:00–16:00 convivem).
    return blocks.some((b) => startsAt < b.endsAt && endsAt > b.startsAt);
  } catch (err) {
    console.error("[clinicorp] consultar agenda falhou", err);
    return null;
  }
}

/**
 * Grava a conexão com as credenciais cifradas.
 *
 * Único caminho de escrita das credenciais — a cifragem não fica espalhada pela
 * camada de UI, onde seria fácil um formulário novo gravar em texto claro.
 *
 * Reconectar troca as credenciais e preserva as escolhas (clínica, profissional,
 * categoria): quem está corrigindo um token vencido não quer reconfigurar tudo.
 */
export async function saveClinicorpCredentials(
  tenantId: string,
  cred: ClinicorpCredentials,
  defaults: { businessId?: string | null } = {},
): Promise<void> {
  const encrypted = {
    apiUser: encryptSecret(cred.apiUser),
    apiToken: encryptSecret(cred.apiToken),
    subscriberId: cred.subscriberId,
  };

  await prisma.clinicorpIntegration.upsert({
    where: { tenantId },
    create: { tenantId, ...encrypted, businessId: defaults.businessId ?? null },
    update: { ...encrypted, lastError: null, lastErrorAt: null },
  });
  clearClinicorpAgendaCache(tenantId);
}

/** Apaga a conexão. As credenciais são do cliente: sai tudo. */
export async function disconnectClinicorp(tenantId: string): Promise<void> {
  await prisma.clinicorpIntegration.deleteMany({ where: { tenantId } });
  clearClinicorpAgendaCache(tenantId);
}
