import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Testes de regressão de AUTORIZAÇÃO.
 *
 * Estes testes leem o código-fonte em vez de executar as ações. É deliberado:
 * o que se quer travar aqui é a *disciplina* que a auditoria encontrou —
 * "toda Server Action passa por um guard de sessão", "escrita entre tenants usa
 * updateMany com tenantId" — e essa é uma propriedade do código, não de uma
 * execução. Um teste de integração provaria o comportamento de UMA ação; este
 * cobre todas, inclusive a que alguém escrever amanhã.
 *
 * Roda sem banco, sem Redis e sem servidor, então cabe no CI a cada push.
 *
 * Se um destes falhar, a pergunta não é "como faço o teste passar" e sim
 * "esta ação nova está mesmo escopada ao tenant certo?".
 */

const ROOT = path.resolve(__dirname, "..");
const APP = path.join(ROOT, "src", "app");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry === "actions.ts") out.push(full);
  }
  return out;
}

const actionFiles = walk(APP);
const rel = (f: string) => path.relative(ROOT, f).replace(/\\/g, "/");

/** Guards que estabelecem quem é o usuário e a que tenant ele pertence. */
const GUARDS = [
  "requireTenant",
  "requireOwner",
  "requireSuperadmin",
  "requireSession",
  "requireProductAccess",
  // Encapsula requireProductAccess + tenant ativo + liberação Meta.
  // Comportamento executado em disparos-access.test.ts.
  "requireBroadcastAccess",
];

/**
 * Ações que legitimamente não têm guard de sessão: são os fluxos de quem ainda
 * NÃO está autenticado. Cada uma tem a própria defesa, anotada aqui — a lista é
 * curta de propósito, e crescer nela deve doer.
 */
const SEM_SESSAO_JUSTIFICADO: Record<string, string> = {
  "src/app/(auth)/(guest)/login/actions.ts":
    "login: freio próprio em login-throttle + registro de tentativas",
  "src/app/(auth)/(guest)/esqueci-senha/actions.ts":
    "recuperação: rate limit por IP e por e-mail, resposta idêntica em ambos os casos",
  "src/app/(auth)/redefinir-senha/actions.ts":
    "redefinição: autoriza pelo token de uso único (hash no banco, com prazo)",
};

describe("Server Actions: guard de sessão", () => {
  it("encontrou os arquivos de actions", () => {
    expect(actionFiles.length).toBeGreaterThan(5);
  });

  for (const file of actionFiles) {
    const nome = rel(file);
    const justificativa = SEM_SESSAO_JUSTIFICADO[nome];

    it(`${nome} ${justificativa ? "(sem sessão, justificado)" : "exige guard de sessão"}`, () => {
      const src = readFileSync(file, "utf8");
      const temGuard = GUARDS.some((g) => src.includes(g));

      if (justificativa) {
        // Fluxo público: o que se cobra é que tenha ALGUMA defesa própria.
        const temDefesa =
          src.includes("rateLimit") ||
          src.includes("loginThrottle") ||
          src.includes("peekLoginBlock") ||
          src.includes("resolveUsableResetToken");
        expect(temDefesa, `${nome} é público mas perdeu a defesa: ${justificativa}`).toBe(true);
        return;
      }

      expect(
        temGuard,
        `${nome} não chama nenhum guard (${GUARDS.join(", ")}). ` +
          "Toda ação autenticada precisa estabelecer o tenant antes de tocar dados.",
      ).toBe(true);
    });
  }
});

describe("Isolamento multi-tenant", () => {
  /**
   * A regra que a auditoria confirmou: quando a ação recebe um id vindo do
   * cliente, a escrita não pode ser `update({ where: { id } })` — isso aceita o
   * id de outro tenant. Ou se usa `updateMany` com tenantId no where, ou se
   * carrega o registro antes com o tenantId (ownership) e só então se escreve
   * pelo id já validado.
   */
  it("nenhuma escrita usa diretamente um id cru vindo de formData/parâmetro", () => {
    const violacoes: string[] = [];

    for (const file of actionFiles) {
      const src = readFileSync(file, "utf8");
      const linhas = src.split("\n");

      linhas.forEach((linha, i) => {
        // update/delete escopado por um id que é literalmente o parâmetro da
        // função (não `algo.id`, que indica registro já carregado e validado).
        const m = linha.match(
          /prisma\.\w+\.(update|delete)\(\{\s*where:\s*\{\s*id:\s*(\w+)\s*\}/,
        );
        if (!m) return;
        const varId = m[2];

        // `x.id` (com ponto) é registro já buscado — o padrão correto.
        if (varId.includes(".")) return;

        // Confere se esse identificador foi resolvido com tenantId antes.
        const anterior = linhas.slice(Math.max(0, i - 25), i).join("\n");
        const validado =
          anterior.includes("tenantId") ||
          anterior.includes("session.user.id") ||
          anterior.includes("resolved.userId");

        if (!validado) {
          violacoes.push(`${rel(file)}:${i + 1} → ${linha.trim()}`);
        }
      });
    }

    expect(
      violacoes,
      "Escrita por id sem validar posse antes:\n" + violacoes.join("\n"),
    ).toEqual([]);
  });

  it("a busca da base de conhecimento continua exigindo tenantId", () => {
    // Esta era a VULN-07: a única query de dados de tenant sem tenantId.
    const src = readFileSync(
      path.join(ROOT, "src/modules/knowledge-base/repository.ts"),
      "utf8",
    );
    const fn = src.slice(src.indexOf("export async function searchSimilarChunks"));
    const corpo = fn.slice(0, fn.indexOf("\n}"));

    expect(corpo, "searchSimilarChunks precisa receber tenantId").toContain("tenantId: string");
    expect(corpo, 'o SQL precisa filtrar por "tenantId"').toContain('"tenantId" = ');
  });
});

describe("Rotas de API: autenticação", () => {
  const API = path.join(APP, "api");

  function walkRoutes(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walkRoutes(full, out);
      else if (entry === "route.ts") out.push(full);
    }
    return out;
  }

  /**
   * Rotas propositalmente públicas, cada uma com a defesa que a substitui.
   * O teste cobra que a defesa continue lá.
   */
  const PUBLICAS: Record<string, string[]> = {
    "src/app/api/webhooks/whatsapp/route.ts": ["timingSafeEqual", "WHATSAPP_WEBHOOK_SECRET"],
    "src/app/api/webhooks/whatsapp/meta/[tenantId]/route.ts": [
      "verifyMetaWebhookSignature",
      "x-hub-signature-256",
      "timingSafeEqual",
    ],
    // Callback compartilhado da Meta: handshake por segredo e POST por HMAC;
    // comportamento e isolamento executados em meta-shared-webhook.test.ts.
    "src/app/api/webhooks/whatsapp/meta/route.ts": [
      "verifyMetaWebhookSignature",
      "x-hub-signature-256",
      "timingSafeEqual",
      "META_APP_SECRET",
      "META_WEBHOOK_VERIFY_TOKEN",
    ],
    "src/app/api/webhooks/stripe/route.ts": ["constructEvent"],
    "src/app/api/widget/[tenantId]/message/route.ts": ["isRateLimited", "isIpRateLimited"],
    "src/app/api/register/route.ts": ["rateLimit"],
    "src/app/api/afiliados/clique/route.ts": ["trackClick"],
    // MCP do agente: token Bearer (hash no banco, revogável, com escopo) checado em
    // `handleMcpPost` antes de ler o corpo; comportamento em agent-mcp.test.ts.
    "src/app/api/mcp/route.ts": ["handleMcpPost"],
    "src/app/api/health/route.ts": [],
    "src/app/api/auth/[...nextauth]/route.ts": [],
    // As rotas do Google OAuth NÃO entram aqui: usam requireTenant() como
    // qualquer rota autenticada, e é a sessão — não o `state` da URL — que
    // decide em qual tenant o token é gravado. O teste genérico as cobre.
  };

  for (const file of walkRoutes(API)) {
    const nome = rel(file);
    it(`${nome} autentica ou tem defesa declarada`, () => {
      const src = readFileSync(file, "utf8");
      const exigido = PUBLICAS[nome];

      if (exigido !== undefined) {
        for (const marca of exigido) {
          expect(
            src.includes(marca),
            `${nome} é rota pública e perdeu a defesa "${marca}".`,
          ).toBe(true);
        }
        return;
      }

      const autentica =
        src.includes("await auth()") ||
        GUARDS.some((g) => src.includes(g));
      expect(
        autentica,
        `${nome} não autentica. Se for pública de propósito, adicione em PUBLICAS ` +
          "com a defesa que a protege — a lista é revisada, o esquecimento não.",
      ).toBe(true);
    });
  }
});

describe("Webhook do WhatsApp: falha fechada", () => {
  const src = readFileSync(
    path.join(ROOT, "src/app/api/webhooks/whatsapp/route.ts"),
    "utf8",
  );

  it("recusa quando o segredo não está configurado", () => {
    // A regressão perigosa seria trocar isto por "sem segredo, deixa passar".
    expect(src).toMatch(/if\s*\(!expected\)\s*\{[\s\S]*?return false/);
  });

  it("compara o segredo em tempo constante", () => {
    expect(src).toContain("timingSafeEqual");
  });

  it("valida ANTES de tocar o banco", () => {
    const posGuard = src.indexOf("isAuthorized(req)");
    const posPrisma = src.indexOf("prisma.");
    expect(posGuard).toBeGreaterThan(-1);
    // A rota pode delegar todo o processamento (inclusive banco) para um
    // módulo chamado somente depois do guard. Nesse caso não existe `prisma.`
    // no arquivo da rota e a propriedade está satisfeita por construção.
    if (posPrisma >= 0) {
      expect(posGuard, "a autenticação precisa vir antes de qualquer query").toBeLessThan(posPrisma);
    }
  });
});

describe("Personificação: cookie assinado", () => {
  const src = readFileSync(path.join(ROOT, "src/lib/impersonation.ts"), "utf8");

  it("não aceita segredo ausente (sem fallback para string vazia)", () => {
    // VULN-05: `process.env.AUTH_SECRET ?? ""` assinava com chave vazia —
    // conhecida por qualquer um — e a verificação continuava passando.
    //
    // Os comentários são removidos antes de checar: o próprio arquivo cita o
    // padrão antigo ao explicar por que ele saiu, e o teste acusava essa
    // menção como se fosse o código.
    const codigo = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

    expect(codigo).not.toMatch(/AUTH_SECRET\s*\?\?\s*["']["']/);
    expect(codigo).toMatch(/throw new Error/);
  });

  it("exige prazo dentro do payload assinado", () => {
    expect(src).toContain("payload.exp");
  });
});
