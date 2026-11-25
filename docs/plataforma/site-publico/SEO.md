# SEO e GEO

O que já está no código, e o que só você pode fazer (fora dele) para o fechai
aparecer em primeiro no Google.

> **Leia isto primeiro:** código bem otimizado é condição necessária, não
> suficiente. Um site novo não ranqueia por estar tecnicamente correto — ele
> ranqueia quando o Google o conhece, confia nele e vê gente clicando. Os passos
> da seção "Fora do código" são os que realmente movem o ponteiro.

## Fonte única

Tudo que descreve o site publicamente sai de [`src/lib/seo.ts`](../../../src/lib/seo.ts):
domínio, descrição, palavras-chave, contato e perfis sociais. Não repita
domínio nem descrição em componente — importe daqui.

O domínio vem de `NEXT_PUBLIC_SITE_URL`. Ele é lido **em tempo de build**
(variável `NEXT_PUBLIC_*`), por isso está declarado como `ARG`/`ENV` no
`Dockerfile` e como `args` no `docker-compose.yml`. Se você trocar de domínio e
mudar só o `.env` do runtime, o HTML continua publicado com o domínio antigo.

## O que já está implementado

| Arquivo | O que entrega |
|---|---|
| `src/lib/seo.ts` | Domínio canônico, descrição, keywords, dados da organização |
| `src/app/layout.tsx` | `metadataBase`, title template, canonical, Open Graph, Twitter Card, robots, `viewport`/`themeColor` |
| `src/app/sitemap.ts` | `/sitemap.xml` só com rotas públicas |
| `src/app/robots.ts` | `/robots.txt` — bloqueia área logada, libera crawlers de IA |
| `src/app/llms.txt/route.ts` | `/llms.txt` — resumo do produto para motores de resposta (GEO) |
| `src/app/opengraph-image.tsx` | Card 1200×630 gerado no build |
| `src/app/icon.tsx` | Ícone 512×512 (favicon + logo do JSON-LD) |
| `src/app/manifest.ts` | Web app manifest |
| `src/components/seo/JsonLd.tsx` | JSON-LD: Organization, WebSite, SoftwareApplication, FAQPage, HowTo, Breadcrumb |
| `src/app/(marketing)/_components/content.ts` | FAQ e passos — **mesma fonte** do texto visível e do JSON-LD |
| `src/app/(marketing)/_components/OQueE.tsx` | Seção definicional "o que é o fechai" |

Páginas privadas (`(dashboard)`, `(admin)`, `/planos`, onboarding) declaram
`robots: { index: false }`.

### Por que FAQ e passos vivem num módulo à parte

O Google exige que o conteúdo marcado em JSON-LD seja **o mesmo** que o usuário
vê. Duas cópias divergentes fazem o rich result ser removido — e podem gerar
ação manual por spam de dados estruturados. Com uma fonte só, não há divergência
possível. Ao editar o FAQ, edite `content.ts` e mais nada.

## Fora do código (o que falta para ranquear)

Sem estes passos, nada acima ranqueia. Em ordem de impacto:

1. **Google Search Console** — https://search.google.com/search-console
   Adicione a propriedade, pegue o código da tag HTML, ponha em
   `GOOGLE_SITE_VERIFICATION` no `.env` e rebuild. Depois envie o sitemap
   (`/sitemap.xml`) e use "Inspeção de URL → Solicitar indexação" na home.
   **Este é o passo que efetivamente inicia a indexação.** Sem ele, você espera
   semanas; com ele, costuma ser dias.

2. **Bing Webmaster Tools** — https://www.bing.com/webmasters
   Importa direto do Search Console. Vale porque o índice do Bing alimenta
   respostas do ChatGPT e do Copilot.

3. **Domínio próprio.** Hoje o site está em `fechai.januscms.com.br`, um
   subdomínio. Autoridade se acumula no domínio raiz — `januscms.com.br`, que é
   de outro produto. Um `fechai.com.br` próprio é o maior ganho estrutural
   disponível, e o mais difícil de compensar depois. Se migrar, faça
   redirect 301 de todas as URLs antigas e atualize `NEXT_PUBLIC_SITE_URL`.

4. **Google Business Profile**, se o negócio tiver endereço ou atender uma
   região. Ativa painel de marca e resultados locais.

5. **Perfis com o nome da marca** (LinkedIn, Instagram, GitHub, Crunchbase).
   Adicione as URLs em `SOCIAL_PROFILES` (`src/lib/seo.ts`) — viram `sameAs` no
   JSON-LD, que é como o Google confirma que "fechai" é uma entidade real e não
   uma palavra qualquer. É o que separa ranquear pela marca de disputar com
   resultados aleatórios.

6. **Conteúdo recorrente.** Uma landing só ranqueia para a marca e pouca cauda
   longa. Para termos como "chatbot com IA para WhatsApp", é preciso página ou
   post que responda a essa dúvida especificamente.

### Sobre ranquear em #1 para "fechai"

"fechai" é busca de marca, e é a mais fácil de ganhar — mas há uma disputa real:
em português, "fecha aí"/"fechaí" é expressão comum, então o Google precisa
aprender que existe uma *entidade* com esse nome. É exatamente para isso que
servem o JSON-LD de Organization, o `sameAs` dos perfis e a seção "o que é o
fechai" em texto. Search Console + perfis oficiais + alguma menção externa
resolvem isso em semanas, não em dias. Ninguém — nenhuma agência e nenhuma
implementação — garante posição no Google; o que dá para garantir é que nada
técnico está atrapalhando, e esse é o estado atual do repo.

## GEO (aparecer em ChatGPT, Perplexity, AI Overviews)

Motores de resposta citam o que conseguem ler e verificar. O que foi feito:

- `/llms.txt` com resumo completo, planos e FAQ, gerado das mesmas fontes do site.
- Crawlers de IA explicitamente liberados no `robots.txt` (GPTBot, PerplexityBot,
  ClaudeBot, OAI-SearchBot, Google-Extended e outros).
- JSON-LD rico — LLM prefere dado já desambiguado a adivinhar do HTML.
- Parágrafos-resposta autossuficientes (seção "o que é", intro do "como
  funciona", respostas do FAQ): frases que fazem sentido citadas fora de
  contexto, que é como um LLM as usa.
- Preços e limites escritos por extenso, vindos de `PLANS` — se mudar o plano,
  o `/llms.txt` acompanha sozinho.

## Ao mudar de domínio

1. `NEXT_PUBLIC_SITE_URL` no `.env` (e no ambiente de build/CI).
2. Rebuild — não basta reiniciar o container.
3. Redirect 301 do domínio antigo para o novo, URL a URL.
4. Nova propriedade no Search Console + "Alteração de endereço".
5. Confira `/robots.txt`, `/sitemap.xml` e o `<link rel="canonical">` da home.

## Checklist de verificação

- [ ] `curl https://SEU_DOMINIO/robots.txt` aponta para o sitemap certo
- [ ] `/sitemap.xml` não lista nenhuma rota que exige login
- [ ] Rich Results Test: https://search.google.com/test/rich-results
- [ ] Schema validator: https://validator.schema.org/
- [ ] Card do OG: cole o link no WhatsApp e veja se a imagem aparece
- [ ] PageSpeed Insights (Core Web Vitals são fator de ranqueamento):
      https://pagespeed.web.dev/
- [ ] Nenhum `localhost` no HTML de produção (`view-source` + Ctrl+F)
