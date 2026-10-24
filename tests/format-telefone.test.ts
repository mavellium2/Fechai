import { describe, expect, it } from "vitest";
import { isSyntheticPhone, phoneLabel, waLink } from "@/lib/format";

const MCP = "mcp:agent-1:0b6f6c1e-3a4d-4a52-9c9e-2f2c3a1b7d10";

describe("telefone sintético", () => {
  it("reconhece sandbox (antigo e por agente) e simulação do MCP", () => {
    expect(isSyntheticPhone("sandbox")).toBe(true);
    expect(isSyntheticPhone("sandbox:agent-1")).toBe(true);
    expect(isSyntheticPhone(MCP)).toBe(true);
  });

  it("número real não é sintético", () => {
    expect(isSyntheticPhone("5514999999999")).toBe(false);
    expect(isSyntheticPhone("web:abc")).toBe(false);
  });

  it("waLink não oferece WhatsApp para telefone sintético, mas segue igual para número real", () => {
    expect(waLink(MCP)).toBeNull();
    expect(waLink("sandbox")).toBeNull();
    expect(waLink("sandbox:agent-1")).toBeNull();
    expect(waLink("5514999999999")).toBe("https://wa.me/5514999999999");
    expect(waLink("123")).toBeNull();
  });

  it("phoneLabel não mostra a string crua do telefone sintético", () => {
    expect(phoneLabel(MCP)).toBe("teste no sandbox");
    expect(phoneLabel("sandbox")).toBe("teste no sandbox");
    expect(phoneLabel("sandbox:agent-1")).toBe("teste no sandbox");
    expect(phoneLabel("5514999999999")).toBe("(14) 99999-9999");
  });
});
