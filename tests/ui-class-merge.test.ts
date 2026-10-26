import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("tokens tipográficos do design system", () => {
  it("preserva o tamanho micro junto das cores do texto", () => {
    expect(cn("font-mono text-micro", "text-white")).toBe("font-mono text-micro text-white");
    expect(cn("text-micro", "text-neutral panel:text-white/60")).toBe("text-micro text-neutral panel:text-white/60");
  });

  it("continua permitindo substituir tamanho e cor separadamente", () => {
    expect(cn("text-micro text-neutral", "text-sm text-iris")).toBe("text-sm text-iris");
    expect(cn("text-sm text-white", "text-micro")).toBe("text-white text-micro");
  });

  it("preserva tamanho, cor e variantes de estado nos links do painel", () => {
    expect(cn("text-micro uppercase", "hover:text-white panel:text-white/60")).toBe("text-micro uppercase hover:text-white panel:text-white/60");
  });
});
