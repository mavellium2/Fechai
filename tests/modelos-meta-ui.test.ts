import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/** Tela `/disparos/modelos`: formulário, lista e os estados vazio e de erro. */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/(dashboard)/disparos/modelos/actions", () => ({
  createMessageTemplate: vi.fn(),
  listMessageTemplates: vi.fn(),
}));

import { TemplateManager } from "@/app/(dashboard)/disparos/modelos/TemplateManager";

const render = (props: Parameters<typeof TemplateManager>[0]) =>
  renderToStaticMarkup(createElement(TemplateManager, props));

describe("Modelos de mensagem", () => {
  it("mostra o formulário com Utilidade como categoria inicial", () => {
    const html = render({ initialTemplates: [], initialError: null });
    expect(html).toContain("Novo modelo");
    expect(html).toContain("Enviar para aprovação");
    expect(html).toContain("Utilidade");
    expect(html).toContain('name="body"');
  });

  it("sem modelos, diz o próximo passo", () => {
    expect(render({ initialTemplates: [], initialError: null })).toContain("Nenhum modelo ainda");
  });

  it("lista status e motivo de recusa em palavras da clínica", () => {
    const html = render({
      initialError: null,
      initialTemplates: [
        { id: "a", name: "lembrete_consulta", language: "pt_BR", status: "PENDING", category: "UTILITY", body: "Olá {{1}}", rejectedReason: null },
        { id: "b", name: "promo", language: "pt_BR", status: "REJECTED", category: "MARKETING", body: "Promo", rejectedReason: "PROMOTIONAL" },
      ],
    });
    expect(html).toContain("lembrete_consulta");
    expect(html).toContain("Em análise");
    expect(html).toContain("Recusado");
    expect(html).toContain("promocional");
  });

  it("falha ao consultar a Meta oferece tentar de novo", () => {
    const html = render({ initialTemplates: null, initialError: "Não foi possível consultar os modelos na Meta agora." });
    expect(html).toContain("Não foi possível consultar os modelos");
    expect(html).toContain("Tentar de novo");
  });
});
