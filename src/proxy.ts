import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  REFERRAL_COOKIE,
  REFERRAL_COOKIE_DAYS,
  REFERRAL_PARAM,
  REFERRAL_PLAN_PARAM,
} from "@/modules/affiliates/config";

// Checagem otimista (via cookie de sessão, sem tocar o banco): quem já está
// autenticado não deve ver as telas de /login ou /cadastro de novo.
// Isso é a linha de frente — a checagem definitiva continua em
// requireGuest() (src/lib/session.ts), que roda no Server Component.
const GUEST_ONLY_ROUTES = new Set(["/login", "/cadastro"]);

/**
 * Rede de segurança das rotas autenticadas.
 *
 * NÃO é a autorização do produto: quem decide acesso continua sendo o
 * `layout.tsx` de cada pasta (`requireProductAccess`) e o guard de sessão de
 * cada action/rota — só eles conhecem tenant, papel e plano. Isto aqui existe
 * para que uma pasta nova, criada sem `layout.tsx`, não nasça aberta: hoje
 * isso depende de alguém lembrar, e é o esquecimento que só aparece depois
 * de virar incidente.
 *
 * É a camada mais fraca das três, e de propósito. O `next` em uso tem CVE de
 * bypass de proxy/middleware em App Router (docs/SECURITY_AUDIT.md, VULN-02),
 * então tratá-la como defesa única seria construir sobre o que já se sabe
 * frágil. Ela reduz a janela de erro; a decisão real acontece no servidor.
 *
 * Só verifica se EXISTE sessão. Papel e tenant ficam de fora para não criar
 * uma segunda fonte de verdade, que divergiria da primeira com o tempo.
 */
const PROTECTED_PREFIXES = [
  "/inicio",
  "/agentes",
  "/conversas",
  "/contatos",
  "/agenda",
  "/relatorios",
  "/campanhas",
  "/integracoes",
  "/whatsapp",
  "/configuracoes",
  "/afiliado",
  "/onboarding",
  "/admin",
];

function isProtected(pathname: string) {
  return PROTECTED_PREFIXES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

/**
 * Grava o código do afiliado num cookie quando a URL traz `?ref=`.
 *
 * Fica aqui, e não numa página, porque o afiliado divulga o link para
 * QUALQUER rota pública (home, /planos, /afiliados) — capturar no proxy cobre
 * todas de uma vez. A atribuição de verdade acontece no cadastro
 * (attachReferralToTenant); o cookie é só o carregador até lá.
 *
 * O clique não é registrado aqui de propósito: o proxy roda também em
 * prefetch e em recarregamentos, o que inflaria a métrica. Quem registra é a
 * rota /api/afiliados/clique, chamada uma vez pela página que recebeu o ref.
 */
function captureReferral(req: Parameters<Parameters<typeof auth>[0]>[0], res: NextResponse) {
  const code = req.nextUrl.searchParams.get(REFERRAL_PARAM);
  if (!code) return res;

  // Primeiro clique vence: se já existe um cookie, ele é mantido — o crédito
  // é first-touch, e sobrescrever aqui deixaria o último link roubar a venda.
  if (req.cookies.get(REFERRAL_COOKIE)) return res;

  res.cookies.set({
    name: REFERRAL_COOKIE,
    value: code.slice(0, 32),
    maxAge: REFERRAL_COOKIE_DAYS * 24 * 60 * 60,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });

  const plan = req.nextUrl.searchParams.get(REFERRAL_PLAN_PARAM);
  if (plan) {
    res.cookies.set({
      name: `${REFERRAL_COOKIE}_plano`,
      value: plan.slice(0, 16),
      maxAge: REFERRAL_COOKIE_DAYS * 24 * 60 * 60,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
  }

  return res;
}

export default auth((req) => {
  const { nextUrl, auth: session } = req;

  if (session?.user && GUEST_ONLY_ROUTES.has(nextUrl.pathname)) {
    const dest = session.user.role === "SUPERADMIN" ? "/admin/contas" : "/inicio";
    return captureReferral(req, NextResponse.redirect(new URL(dest, nextUrl)));
  }

  // Rota do produto sem sessão nenhuma: manda para o login levando o destino,
  // para a pessoa voltar onde estava depois de entrar.
  if (!session?.user && isProtected(nextUrl.pathname)) {
    const login = new URL("/login", nextUrl);
    login.searchParams.set("callbackUrl", nextUrl.pathname);
    return captureReferral(req, NextResponse.redirect(login));
  }

  return captureReferral(req, NextResponse.next());
});

export const config = {
  /**
   * Rotas públicas onde um link de afiliado pode cair (home, planos, landing),
   * as telas de convidado, e todas as rotas do produto.
   *
   * `/api` fica de fora: cada rota de API tem a própria regra — o webhook do
   * WhatsApp autentica por segredo compartilhado, o do Stripe por assinatura,
   * o widget é público com rate limit. Um redirect para /login em cima de um
   * webhook quebraria a integração em vez de proteger alguma coisa.
   */
  matcher: [
    "/",
    "/login",
    "/cadastro",
    "/planos",
    "/afiliados",
    "/inicio/:path*",
    "/agentes/:path*",
    "/conversas/:path*",
    "/contatos/:path*",
    "/agenda/:path*",
    "/relatorios/:path*",
    "/campanhas/:path*",
    "/integracoes/:path*",
    "/whatsapp/:path*",
    "/configuracoes/:path*",
    "/afiliado/:path*",
    "/onboarding/:path*",
    "/admin/:path*",
  ],
};
