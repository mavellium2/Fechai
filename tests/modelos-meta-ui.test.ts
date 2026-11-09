import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/** Tela `/disparos/modelos`: lista primeiro, editor guiado em `/novo`. */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/disparos/modelos",
}));
vi.mock("@/app/(dashboard)/disparos/modelos/actions", () => ({
  createMessageTemplate: vi.fn(),
  listMessageTemplates: vi.fn(),
}));

import { TemplateLibrary } from "@/app/(dashboard)/disparos/modelos/TemplateLibrary";
import { TemplateEditor } from "@/app/(dashboard)/disparos/modelos/TemplateEditor";

const list = (props: Parameters<typeof TemplateLibrary>[0]) =>
  renderToStaticMarkup(createElement(TemplateLibrary, props));

const base = { language: "pt_BR", header: "", footer: "", rejectedReason: null };

describe("Modelos de mensagem · lista", () => {
  it("sem modelos, diz o próximo passo", () => {
    const html = list({ initial: [], initialError: null });
    expect(html).toContain("Nenhum modelo ainda");
    expect(html).toContain("/disparos/modelos/novo");
  });

  it("mostra status, motivo e a ação certa para cada situação", () => {
    const html = list({
      initialError: null,
      initial: [
        { ...base, id: "a", name: "lembrete_consulta", status: "APPROVED", category: "UTILITY", body: "Olá {{1}}, tudo bem?" },
        { ...base, id: "b", name: "promo", status: "REJECTED", category: "MARKETING", body: "Promo", rejectedReason: "PROMOTIONAL" },
        { ...base, id: "c", name: "aviso", status: "PENDING", category: "UTILITY", body: "Aviso" },
      ],
    });
    expect(html).toContain("Aprovado");
    expect(html).toContain("Recusado");
    expect(html).toContain("Em análise");
    expect(html).toContain("promocional");
    expect(html).toContain("/disparos/novo?modelo=a");
    expect(html).toContain("/disparos/modelos/novo?de=b");
    expect(html).toContain("Filtros");
  });

  it("falha ao consultar a Meta oferece tentar de novo", () => {
    const html = list({ initial: null, initialError: "Não foi possível consultar os modelos na Meta agora." });
    expect(html).toContain("Não foi possível consultar os modelos");
    expect(html).toContain("Tentar de novo");
  });
});

describe("Modelos de mensagem · editor", () => {
  it("começa pelo propósito, com aviso como padrão", () => {
    const html = renderToStaticMarkup(createElement(TemplateEditor, { initial: null }));
    expect(html).toContain("Para que serve esta mensagem?");
    expect(html).toContain('value="UTILITY"');
    expect(html).toContain("Nome do contato");
    expect(html).toContain("Para enviar: escreva a mensagem");
  });

  it("corrigir abre preenchido, com nome novo", () => {
    const html = renderToStaticMarkup(
      createElement(TemplateEditor, {
        initial: { name: "promo_v2", category: "MARKETING", header: "", body: "Oi {{1}}, novidade!", footer: "" },
      }),
    );
    expect(html).toContain("promo_v2");
    expect(html).toContain("Oi ");
    expect(html).toContain('value="MARKETING"');
  });
});
