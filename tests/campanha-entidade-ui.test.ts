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

  it("a ação primária é iris (variant padrão): nenhum botão das telas usa o destaque de conversão (cta)", () => {
    for (const { name, code } of files) expect(code, name).not.toMatch(/variant=["']cta["']|variant:\s*["']cta["']/);
  });

  it("'Nova campanha' é o botão padrão do produto, no cabeçalho e no estado vazio", () => {
    const button = files.find((f) => f.name === "NewCampaignButton.tsx")!;
    expect(button.code).not.toMatch(/variant=/);
    const overview = files.find((f) => f.name === "CampaignsOverview.tsx")!;
    expect(overview.code.match(/<NewCampaignButton\s*\/>/g)?.length).toBe(2);
  });

  it("pausar, retomar, arquivar e desarquivar são reversíveis e não pedem confirmação", () => {
    for (const { name, code } of files) {
      expect(code, name).not.toContain("ConfirmButton");
      expect(code, name).not.toContain("confirm-dialog");
    }
  });

  it("cada ação de status mostra o próprio carregando e trava as outras enquanto roda", () => {
    const actions = files.find((f) => f.name === "CampaignActions.tsx")!;
    expect(actions.code).toMatch(/loading=\{busy === kind\}/);
    expect(actions.code).toMatch(/disabled=\{save\.saving\}/);
    expect(actions.code).toMatch(/loadingLabel=\{loadingLabel\}/);
  });

  it("espaçamento só em múltiplos de 4/8: sem meio passo (gap-1.5, p-2.5…)", () => {
    const halfStep = /\b(?:-?m[trblxy]?|p[trblxy]?|gap(?:-[xy])?|space-[xy]|top|bottom|left|right|inset(?:-[xy])?)-\d+\.5\b/;
    for (const { name, code } of files) expect(code, name).not.toMatch(halfStep);
  });

  it("nenhum valor solto em classe (cor, raio, tamanho de fonte ou opacidade entre colchetes)", () => {
    for (const { name, code } of files) {
      expect(code, name).not.toMatch(/-\[[^\]\s]+\]/); // rounded-[10px], text-[9px], w-[37px]…
      expect(code, name).not.toMatch(/\/\[[^\]\s]+\]/); // bg-ink/[0.02], border-white/[0.07]…
    }
  });

  it("nenhuma cor fora dos tokens (paleta do Tailwind ou hexadecimal)", () => {
    const palette =
      /\b(?:text|bg|border|ring|fill|stroke)-(?:red|green|blue|gray|grey|slate|zinc|stone|indigo|emerald|amber|yellow|orange|purple|pink|rose|sky|teal|cyan|lime|violet|fuchsia|black)(?:-\d+)?\b/;
    for (const { name, code } of files) {
      expect(code, name).not.toMatch(palette);
      expect(code, name).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });

  it("nenhum raio solto (rounded-md, rounded-lg…): só rounded-control, rounded-surface e rounded-full", () => {
    for (const { name, code } of files) expect(code, name).not.toMatch(/\brounded-(?:sm|md|lg|xl|2xl|3xl)\b/);
  });

  it("texto claro sobre o painel escuro nunca abaixo do piso de contraste (white/55)", () => {
    for (const { name, code } of files) {
      for (const match of code.matchAll(/\btext-white\/(\d+)/g)) {
        expect(Number(match[1]), `${name}: ${match[0]}`).toBeGreaterThanOrEqual(55);
      }
    }
  });

  it("nenhuma cor de painel escuro escrita solta (text-white ou border-white sem variante): o escuro entra por panel:", () => {
    // O painel claro é o padrão; o escuro entra pela variante `panel:` (a casca marca a superfície).
    for (const { name, code } of files) {
      expect(code, name).not.toMatch(/(?<![:\w-])(?:text|border)-white(?:\/\d+)?\b/);
    }
  });

  it("todo anel de foco tirado do navegador é refeito (outline-none sempre com focus-visible:ring)", () => {
    for (const { name, code } of files) {
      if (code.includes("outline-none")) expect(code, name).toMatch(/focus-visible:(?:before:)?ring-2/);
    }
  });
});
