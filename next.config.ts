import type { NextConfig } from "next";

/**
 * Headers de segurança aplicados a todas as respostas.
 *
 * `X-Frame-Options: DENY` é o que impede clickjacking: sem ele, um site hostil
 * embute o painel num iframe invisível e colhe cliques em cima de ações reais
 * (excluir agente, trocar plano). O widget é a exceção deliberada — ele existe
 * para rodar dentro do site do cliente — e por isso é tratado à parte, abaixo.
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
];

/**
 * CSP em modo RELATÓRIO, não bloqueio.
 *
 * A política abaixo é um palpite informado sobre o que o app carrega (PostHog,
 * Stripe, fontes do Google) — e um palpite em modo bloqueio derruba a página de
 * pagamento de quem está tentando pagar. Em Report-Only o navegador reporta a
 * violação e carrega assim mesmo.
 *
 * Para promover a enforcement: rode alguns dias, colete as violações no console,
 * ajuste as origens que faltarem e só então troque o nome do header para
 * `Content-Security-Policy`. Enquanto tiver `unsafe-inline`/`unsafe-eval`, a
 * proteção contra XSS é parcial — o Next precisa deles sem uma configuração de
 * nonce, que é o passo seguinte depois que a lista de origens estabilizar.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.posthog.com https://js.stripe.com https://connect.facebook.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://*.posthog.com https://api.stripe.com https://www.facebook.com https://graph.facebook.com",
  "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://www.facebook.com https://web.facebook.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Default é 1MB — pouco pra PDFs da base de conhecimento (addDocument em
      // agentes/actions.ts). Mantenha em sincronia com MAX_KB_FILE_BYTES lá.
      // O tamanho real é checado por ação; este teto é só o limite externo.
      bodySizeLimit: "50mb",
    },
  },
  // O Chromium do PDF do relatório mensal roda fora do bundle.
  serverExternalPackages: ["playwright-core"],
  poweredByHeader: false, // não anunciar "X-Powered-By: Next.js"
  async headers() {
    return [
      {
        /**
         * Tudo, MENOS o widget.
         *
         * A exclusão é feita aqui, com `missing`/negativa no próprio source, e
         * não numa segunda entrada mais específica: as regras de `headers()` do
         * Next são cumulativas, não excludentes — uma entrada posterior para
         * `/api/widget/*` não desfaz o `X-Frame-Options: DENY` desta, ela só
         * acrescenta os seus. Verificado com curl: o widget recebia DENY e
         * deixaria de carregar dentro do site do cliente.
         */
        source: "/:path((?!api/widget|relatorios/campanhas/pdf).*)",
        headers: [
          ...securityHeaders,
          { key: "Content-Security-Policy-Report-Only", value: csp },
        ],
      },
      {
        /**
         * Prévia do PDF de campanhas: a única rota que o próprio painel embute
         * (`<object>` na aba Campanhas). Mesmos cabeçalhos de segurança, mas o
         * quadro só pode ser do mesmo site (`SAMEORIGIN`/`frame-ancestors 'self'`),
         * nunca de outro domínio. Fica fora da regra geral acima pelo mesmo motivo
         * do widget: as regras de `headers()` se somam, não se anulam.
         */
        source: "/relatorios/campanhas/pdf",
        headers: [
          ...securityHeaders.filter((h) => h.key !== "X-Frame-Options"),
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy-Report-Only", value: csp.replace("frame-ancestors 'none'", "frame-ancestors 'self'") },
        ],
      },
      {
        // O widget é chamado de outros domínios por natureza (é esse o produto),
        // então nada de X-Frame-Options/frame-ancestors aqui. Quem controla o
        // acesso é o CORS da própria rota.
        source: "/api/widget/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
