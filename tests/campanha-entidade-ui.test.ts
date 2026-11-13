import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * As telas de campanha contra o `CONVENTIONS.md` da raiz. São leituras do
 * código-fonte (como `autorizacao.test.ts`): o que se trava é a disciplina, e
 * ela vale para a próxima linha que alguém escrever nessas telas.
 */
describe("telas de campanha — convenções de UI", () => {
  const SCREENS = path.resolve(__dirname, "..", "src", "app", "(dashboard)", "campanhas");

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
    return out;
  }

  /** O código sem comentários: o que se confere é o que a tela executa e mostra. */
  const stripComments = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

  const files = walk(SCREENS).map((file) => ({
    name: path.relative(SCREENS, file).replace(/\\/g, "/"),
    code: stripComments(readFileSync(file, "utf8")),
  }));

  it("encontrou as telas", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("nenhum identificador técnico de fuso aparece na tela (nem America/…, nem UTC ou GMT)", () => {
    for (const { name, code } of files) {
      expect(code, name).not.toMatch(/\b(?:America|Europe|Asia|Africa|Pacific|Atlantic)\/[A-Za-z_]+/);
      expect(code, name).not.toMatch(/\b(?:UTC|GMT)\b/);
    }
  });

  it("o formulário diz o horário em português simples", () => {
    const form = files.find((f) => f.name === "CampaignForm.tsx")!;
    expect(form.code).toContain("Datas no horário de Brasília. Sem data de início, a campanha fica como rascunho.");
  });
});
