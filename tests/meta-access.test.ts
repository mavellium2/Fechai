import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");

describe("Liberação administrativa da API oficial da Meta", () => {
  it("nasce desabilitada para todo tenant", () => {
    const schema = read("prisma/schema.prisma");
    expect(schema).toMatch(/metaWhatsappEnabled\s+Boolean\s+@default\(false\)/);
  });

  it("não renderiza o cartão da Meta sem a liberação", () => {
    const page = read("src/app/(dashboard)/integracoes/page.tsx");
    // Falha fechada: linha Meta residual não aparece nem conta como conectada.
    expect(page).toContain("const metaRow = metaEnabled ?");
    expect(page).toContain("{metaEnabled ? (");
    expect(page).toContain("API oficial da Meta");
  });

  it("protege cadastro e reconexão no servidor", () => {
    const actions = read("src/app/(dashboard)/integracoes/actions.ts");
    const checks = actions.match(/tenantCanUseMetaWhatsapp\(tenantId\)/g) ?? [];
    expect(checks.length).toBeGreaterThanOrEqual(2);
    expect(actions).toContain("META_WHATSAPP_NOT_ENABLED");
  });

  it("não aceita webhook de tenant sem liberação", () => {
    const route = read("src/app/api/webhooks/whatsapp/meta/[tenantId]/route.ts");
    expect(route).toContain('tenant: { metaWhatsappEnabled: true }');
  });

  it("ao desabilitar desconecta só a linha Meta, sem tocar na Evolution nem apagar segredos", () => {
    const actions = read("src/app/(admin)/actions.ts");
    const start = actions.indexOf("export async function setTenantMetaWhatsappEnabled");
    const end = actions.indexOf("\nexport ", start + 1);
    const body = actions.slice(start, end);

    expect(body).toContain('provider: "meta"');
    expect(body).toContain('status: "disconnected"');
    // A Evolution é outra linha: não vira "volta para Evolution" nem perde o id.
    expect(body).not.toContain('provider: "evolution"');
    expect(body).not.toContain("externalId: null");
    expect(body).not.toContain("metaAccessTokenEncrypted: null");
    expect(body).not.toContain("metaAppSecretEncrypted: null");
  });
});

describe("Evolution e Meta conectadas ao mesmo tempo", () => {
  it("guarda uma linha por provedor e por conta", () => {
    const schema = read("prisma/schema.prisma");
    const model = schema.slice(
      schema.indexOf("model WhatsappInstance {"),
      schema.indexOf("model Lead {"),
    );
    expect(model).toMatch(/@@unique\(\[tenantId, provider\]\)/);
    // `tenantId @unique` voltaria a impedir a segunda conexão.
    expect(model).not.toMatch(/tenantId\s+String\s+@unique/);
    expect(schema).toMatch(/whatsappInstances\s+WhatsappInstance\[\]/);
  });

  it("a conversa lembra por qual número o contato fala", () => {
    const schema = read("prisma/schema.prisma");
    const conversation = schema.slice(
      schema.indexOf("model Conversation {"),
      schema.indexOf("model Message {"),
    );
    expect(conversation).toMatch(/whatsappProvider\s+String\?/);
  });

  it("conectar a Meta não exige desconectar a Evolution (nem o contrário)", () => {
    const actions = read("src/app/(dashboard)/integracoes/actions.ts");
    expect(actions).not.toContain("Desconecte o número da Evolution");
    expect(actions).not.toContain("Selecione Evolution");
    expect(actions).not.toContain("setWhatsappProvider");
  });

  it("não sobra seletor de provedor: cada conexão tem o próprio cartão", () => {
    const page = read("src/app/(dashboard)/integracoes/page.tsx");
    expect(page).not.toContain("WhatsappProviderSelector");
    expect(page).toContain("<MetaWhatsappConnect");
    expect(page).toContain('layout="channel"');
  });
});
