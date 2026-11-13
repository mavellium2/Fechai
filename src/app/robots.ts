import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";

/**
 * robots.txt.
 *
 * Bloqueia área logada e API (conteúdo sem valor de busca, e /api/ pode expor
 * rota de webhook em log de rastreamento). Os crawlers de IA (GPTBot,
 * PerplexityBot, ClaudeBot…) são liberados de propósito: o objetivo de GEO é
 * ser citado como resposta, e para isso o conteúdo precisa ser lido.
 */
export default function robots(): MetadataRoute.Robots {
  const disallow = ["/api/", "/admin/", "/inicio", "/agentes", "/conversas", "/contatos", "/agenda", "/relatorios", "/campanhas", "/integracoes", "/configuracoes", "/onboarding"];

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow,
      },
      // Motores de resposta: liberados no conteúdo público.
      {
        userAgent: ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "PerplexityBot", "ClaudeBot", "Claude-Web", "Google-Extended", "Applebot-Extended", "cohere-ai", "Bytespider"],
        allow: "/",
        disallow,
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: absoluteUrl("/"),
  };
}
