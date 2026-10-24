import { afterEach, describe, expect, it, vi } from "vitest";
import { announceLoading, announceResult, type ToastSink } from "@/components/ui/toast/announce";
import { classifyFailure, failureMessage, loadingMessage, readResult, sanitizeReason, successMessage } from "@/components/ui/toast/messages";
import { errorToResult, isFrameworkSignal, requestSave } from "@/components/ui/toast/save-service";
import type { ToastInput } from "@/components/ui/toast/types";

function sink() {
  const shown: ToastInput[] = [];
  const dismissed: string[] = [];
  const api: ToastSink = { show: (input) => (shown.push(input), input.id ?? ""), dismiss: (id) => void dismissed.push(id) };
  return { api, shown, dismissed };
}

describe("mensagens de salvamento", () => {
  it("concorda gênero, número e ação", () => {
    expect(successMessage({ entity: "cliente" }).title).toBe("Cliente salvo com sucesso!");
    expect(successMessage({ entity: "agenda", gender: "f", action: "update" }).title).toBe("Agenda atualizada com sucesso!");
    expect(successMessage({ entity: "regras", gender: "f", plural: true, action: "create" }).title).toBe("Regras criadas com sucesso!");
    expect(successMessage({ entity: "contato", action: "delete" }).title).toBe("Contato excluído com sucesso!");
    expect(loadingMessage({ entity: "cliente", action: "create" }).title).toBe("Criando cliente…");
  });

  it("a mensagem da action vence a genérica", () => {
    expect(successMessage({ entity: "perfil" }, "Perfil atualizado.").title).toBe("Perfil atualizado.");
    expect(successMessage({ entity: "perfil" }, "  ").title).toBe("Perfil salvo com sucesso!");
  });
});

describe("classificação e texto dos erros", () => {
  it("prioriza código, depois status, depois campos, depois o texto", () => {
    expect(classifyFailure({ code: "auth", status: 500 })).toBe("auth");
    expect(classifyFailure({ status: 401 })).toBe("auth");
    expect(classifyFailure({ status: 403 })).toBe("forbidden");
    expect(classifyFailure({ status: 422 })).toBe("validation");
    expect(classifyFailure({ status: 0 })).toBe("network");
    expect(classifyFailure({ errors: { email: "Inválido" } })).toBe("validation");
    expect(classifyFailure({ message: "Sua sessão expirou" })).toBe("auth");
    expect(classifyFailure({ message: "TypeError: Failed to fetch" })).toBe("network");
    expect(classifyFailure({ message: "Senha atual incorreta" })).toBe("server");
  });

  it("lista os campos com rótulo legível", () => {
    const m = failureMessage(
      { entity: "cliente", fieldLabels: { email: "e-mail" } },
      { errors: { name: ["Obrigatório"], email: "Obrigatório", phone: undefined } },
    );
    expect(m.kind).toBe("warning");
    expect(m.description).toBe("Preencha os campos obrigatórios: name, e-mail.");
    expect(m.retryable).toBe(false);
  });

  it("mostra o motivo real quando é texto para gente", () => {
    const m = failureMessage({ entity: "cliente" }, { message: "Já existe um cliente com este e-mail." });
    expect(m.kind).toBe("error");
    expect(m.title).toBe("Não foi possível salvar o cliente.");
    expect(m.description).toBe("Já existe um cliente com este e-mail.");
    expect(m.retryable).toBe(true);
  });

  it.each([
    "Invalid `prisma.user.update()` invocation: Unique constraint failed",
    "P2002 falhou",
    "connect ECONNREFUSED 127.0.0.1:5432",
    "TypeError: Cannot read properties of undefined",
    "    at Object.handler (/app/node_modules/x.js:1:1)",
    "<!DOCTYPE html><html>500</html>",
    "linha 1\nlinha 2",
    "x".repeat(300),
  ])("nunca expõe detalhe técnico: %s", (raw) => {
    expect(sanitizeReason(raw)).toBeNull();
    const m = failureMessage({ entity: "cliente" }, { message: raw });
    expect(m.description).toBe("Tente novamente em instantes.");
  });

  it("sessão e rede têm texto próprio, sem depender do motivo", () => {
    expect(failureMessage({ entity: "cliente" }, { code: "auth" }).title).toBe("Sua sessão expirou.");
    const net = failureMessage({ entity: "cliente" }, { code: "network" });
    expect(net.description).toContain("Verifique sua internet");
    expect(net.retryable).toBe(true);
    expect(failureMessage({ entity: "cliente" }, { code: "forbidden" }).title).toBe("Você não tem permissão para salvar o cliente.");
  });
});

describe("leitura do retorno da action", () => {
  it("distingue inicial, sucesso e falha", () => {
    expect(readResult(null).status).toBe("idle");
    expect(readResult({}).status).toBe("idle");
    expect(readResult({ ok: true })).toEqual({ status: "success", message: null });
    expect(readResult({ ok: true, info: "Salvo." })).toEqual({ status: "success", message: "Salvo." });
    expect(readResult({ ok: "Enviado." })).toEqual({ status: "success", message: "Enviado." });
    expect(readResult({ info: "Enviamos o e-mail." }).status).toBe("success");
    expect(readResult({ ok: false }).status).toBe("error");
    expect(readResult({ ok: true, error: "falhou" }).status).toBe("error");
  });
});

describe("announce: o toast de cada etapa", () => {
  it("carregando → sucesso no mesmo id", () => {
    const { api, shown } = sink();
    announceLoading(api, "t1", { entity: "cliente" });
    expect(announceResult(api, "t1", { entity: "cliente" }, { ok: true })).toBe("success");
    expect(shown.map((t) => [t.id, t.kind])).toEqual([["t1", "loading"], ["t1", "success"]]);
  });

  it("retorno inicial só apaga o aviso", () => {
    const { api, shown, dismissed } = sink();
    expect(announceResult(api, "t1", { entity: "cliente" }, null)).toBe("idle");
    expect(shown).toEqual([]);
    expect(dismissed).toEqual(["t1"]);
  });

  it("erro de servidor oferece tentar novamente só se houver como", () => {
    const retry = vi.fn();
    const withRetry = sink();
    announceResult(withRetry.api, "t", { entity: "cliente" }, { ok: false, error: "Falhou de novo." }, retry);
    expect(withRetry.shown[0].kind).toBe("error");
    expect(withRetry.shown[0].duration).toBeUndefined(); // erro herda o padrão do tipo (6 s)
    withRetry.shown[0].action?.onClick?.();
    expect(retry).toHaveBeenCalledOnce();

    const without = sink();
    announceResult(without.api, "t", { entity: "cliente" }, { ok: false, error: "Falhou." });
    expect(without.shown[0].action).toBeUndefined();
  });

  it("sessão expirada leva ao login; validação e permissão não oferecem retry", () => {
    const retry = vi.fn();
    const auth = sink();
    announceResult(auth.api, "t", { entity: "cliente" }, { ok: false, code: "auth" }, retry);
    expect(auth.shown[0].action).toEqual({ label: "Entrar", href: "/login" });

    const validation = sink();
    announceResult(validation.api, "t", { entity: "cliente" }, { ok: false, errors: { name: "Obrigatório" } }, retry);
    expect(validation.shown[0].kind).toBe("warning");
    expect(validation.shown[0].action).toBeUndefined();
  });
});

describe("serviço de salvamento", () => {
  afterEach(() => vi.unstubAllGlobals());

  const respond = (status: number, body: unknown) =>
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));

  it("2xx vira sucesso", async () => {
    respond(200, { message: "Cliente salvo." });
    expect(await requestSave("/api/x")).toEqual({ ok: true, info: "Cliente salvo." });
  });

  it("401, 403 e 422 viram a categoria certa, com erros por campo", async () => {
    respond(401, { error: "Não autenticado" });
    expect((await requestSave("/api/x")).code).toBe("auth");
    respond(403, {});
    expect((await requestSave("/api/x")).code).toBe("forbidden");
    respond(422, { errors: { email: ["Inválido"], x: 3 } });
    expect(await requestSave("/api/x")).toMatchObject({ ok: false, code: "validation", errors: { email: ["Inválido"] } });
  });

  it("detalhe técnico do corpo não vira motivo", async () => {
    respond(500, { error: "connect ECONNREFUSED 10.0.0.1:5432" });
    const result = await requestSave("/api/x");
    expect(result.code).toBe("server");
    expect(result.error).toBeUndefined();
  });

  it("rede fora vira network e nunca lança; cancelamento é relançado", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    expect(await requestSave("/api/x")).toEqual({ ok: false, code: "network" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("abort", "AbortError"); }));
    await expect(requestSave("/api/x")).rejects.toThrow();
  });

  it("exceção vira retorno padrão; sinais do Next não são falha", () => {
    expect(errorToResult(new Error("Já existe."))).toMatchObject({ ok: false, code: "server", error: "Já existe." });
    expect(errorToResult(new Error("Failed to fetch")).code).toBe("network");
    expect(errorToResult(new Error("Invalid `prisma.x`")).error).toBeUndefined();
    expect(isFrameworkSignal(Object.assign(new Error("r"), { digest: "NEXT_REDIRECT;replace;/login" }))).toBe(true);
    expect(isFrameworkSignal(new Error("x"))).toBe(false);
  });
});
