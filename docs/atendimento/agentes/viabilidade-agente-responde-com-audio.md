# Viabilidade — agente responde com áudio + voz personalizável

Levantamento do que já existe no fechai, o que falta e o caminho de implementação
para: **o agente responder por áudio, com a voz configurável pelo dono da conta
(inclusive clonando a própria voz ou a de outra pessoa)**.

Status: análise. Nada implementado ainda.

---

## 1. O que JÁ existe (metade do caminho está pronta)

O sentido **áudio → texto** já roda em produção:

| Peça | Arquivo | O que faz |
|---|---|---|
| Transcrição | [transcribe.ts](../../../src/modules/ai/transcribe.ts) | Gemini `inlineData` → fallback Whisper na Groq. Devolve `null` em vez de quebrar o turno. |
| Download da mídia | [evolution.ts:81](../../../src/modules/whatsapp/evolution.ts#L81) | `getMediaAsBase64` via `/chat/getBase64FromMediaMessage`. |
| Detecção de voz | [evolution.ts:132](../../../src/modules/whatsapp/evolution.ts#L132) | `hasAudio` de `audioMessage`/`pttMessage`. |
| Flag por agente | `Agent.listenAudio` ([schema.prisma:165](../../../prisma/schema.prisma#L165)) | Liga/desliga ouvir voz. |
| Toggle na UI | [BehaviorSettings.tsx](../../../src/app/(dashboard)/agentes/BehaviorSettings.tsx) | Padrão de Switch por comportamento, com server action `setAgentBehavior`. |
| CDN | [bunny.ts](../../../src/lib/bunny.ts) | `uploadToBunny(path, buffer, contentType)` → URL pública. Já usado para PDFs da base e widget. |

Ou seja: **o padrão de UI, o storage e a abstração de provedor já estão de pé.**
Falta o sentido inverso.

## 2. O que NÃO existe

1. **Nenhum TTS.** Zero referência a síntese de voz no repo.
2. **`WhatsAppProvider` não sabe mandar áudio.** O contrato tem só
   `sendMessage(externalId, toPhone, text)` — [provider.ts:35](../../../src/modules/whatsapp/provider.ts#L35).
   A Evolution API expõe `/message/sendWhatsAppAudio/{instance}`, não usado.
3. **`Message` não tem campo de mídia.** [schema.prisma:301](../../../prisma/schema.prisma#L301) só
   guarda `content` (texto). Sem `audioUrl`, a UI de /conversas não tem o que tocar.
4. **`ChatBubble` só renderiza texto** ([ChatBubble.tsx](../../../src/components/chat/ChatBubble.tsx)).
5. **Nenhum conceito de "voz" no modelo de dados** — nem por tenant, nem por agente.

---

## 3. Viabilidade: SIM, e é bem factível

Os três pedaços do pedido, por dificuldade:

### 3.1 Agente responder com áudio — **fácil** (~1-2 dias)
Já se sabe o texto final da resposta (`finalReply` no
[orchestrator.ts:226](../../../src/modules/agent-engine/orchestrator.ts#L226)). Basta sintetizar
e enviar como PTT.

### 3.2 Escolher entre vozes prontas — **fácil** (~meio dia)
Um catálogo de vozes, no mesmo molde de [catalog.ts](../../../src/modules/ai/catalog.ts)
(`AI_MODELS`), + um `select` no wizard do agente.

### 3.3 Clonar a voz do dono ou de outra pessoa — **médio** (~2-3 dias)
Depende do provedor. Só alguns fazem clonagem, e ela traz **obrigação legal de
consentimento** (ver §7).

---

## 4. Provedores de TTS — comparação

| Provedor | Vozes prontas | Clonagem | Qualidade PT-BR | Custo aprox. | Já tem chave? |
|---|---|---|---|---|---|
| **ElevenLabs** | ~1000+ (biblioteca) | **Sim** — Instant (30s de amostra) e Professional | Melhor do mercado em PT-BR | ~US$ 0,15–0,30 / 1k chars (varia por plano) | Não |
| **OpenAI TTS** (`gpt-4o-mini-tts`) | 11 fixas (alloy, nova, shimmer…) | **Não** | Boa, sotaque levemente neutro | US$ 0,60 / 1M chars (~US$ 0,0006/1k) | **Sim** (`OPENAI_API_KEY`) |
| **Gemini TTS** (`gemini-2.5-flash-preview-tts`) | 30 pré-definidas | **Não** | Boa | Barato / free tier | **Sim** (`GEMINI_API_KEY`) |
| **Groq (PlayAI TTS)** | ~19 | Não | Razoável, PT-BR limitado | Muito barato, muito rápido | **Sim** (`GROQ_API_KEY`) |
| Azure Speech | Muitas, PT-BR nativas | Custom Neural Voice (aprovação exigida) | Excelente PT-BR | ~US$ 15 / 1M chars | Não |

**Recomendação:** mesma filosofia da `transcribeAudio` — **chain com fallback**.
- Vozes prontas → **OpenAI TTS** ou **Gemini TTS** (chave já existe, custo desprezível).
- Voz clonada → **ElevenLabs** (único caminho realista para "a voz dele ou de outras
  pessoas"), ativado só quando o tenant configurar `ELEVENLABS_API_KEY` ou quando a
  plataforma bancar via chave própria + cobrança por plano.

Custo prático: uma resposta média de ~300 caracteres custa **~US$ 0,0002 na OpenAI**
e **~US$ 0,05 na ElevenLabs**. A diferença de 250× é o argumento para clonagem ser
recurso de plano superior.

---

## 5. Formato de áudio — o detalhe que costuma quebrar

WhatsApp PTT ("mensagem de voz", com waveform e velocidade 1.5×/2×) exige
**OGG/Opus mono**. Os provedores devolvem MP3/WAV/PCM.

Duas saídas:
1. **Deixar a Evolution converter.** O endpoint `/message/sendWhatsAppAudio` aceita
   base64 ou URL de MP3 e converte internamente (a Evolution v2 embarca ffmpeg).
   **Caminho recomendado** — zero dependência nova no Next.
2. Converter no app com `ffmpeg` — exige binário no Dockerfile. Evitar.

Se a conversão falhar, o áudio sai como *arquivo* de áudio em vez de mensagem de
voz: funciona, mas com UX pior. Vale testar cedo.

---

## 6. Desenho da implementação

### 6.1 Schema (Prisma)

```prisma
model Agent {
  // ... campos atuais
  /// Responde por áudio em vez de (ou além de) texto.
  /// "off" | "always" | "mirror" (só responde em áudio se o cliente mandou áudio)
  replyWithAudio String  @default("off")
  /// Voz usada na síntese. Id do catálogo ("openai:nova") ou de uma TenantVoice.
  voiceId        String?
}

/// Voz clonada de uma pessoa, enviada pelo dono da conta. Uma conta pode ter
/// várias (a própria voz, a de um vendedor, a de um porta-voz).
model TenantVoice {
  id           String   @id @default(cuid())
  tenantId     String
  tenant       Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  label        String   // "Minha voz", "Voz da Ana"
  provider     String   // "elevenlabs"
  externalId   String   // voice_id no provedor
  sampleUrl    String?  // amostra guardada na Bunny, para prévia na UI
  /// Consentimento de uso da voz — obrigatório antes de clonar (ver §7).
  consentedAt  DateTime
  consentedBy  String   // userId de quem declarou o consentimento
  createdAt    DateTime @default(now())

  @@index([tenantId])
}

model Message {
  // ... campos atuais
  /// URL do áudio na CDN quando a resposta foi entregue por voz. Null = texto.
  /// O `content` continua sendo o texto (é ele que vai pro LLM no próximo turno).
  audioUrl String?
}
```

`content` **continua sendo a fonte de verdade textual** — o histórico que vai ao
LLM não muda. `audioUrl` é só a entrega. Isso preserva RAG, relatórios e
follow-up sem tocar em nada.

### 6.2 Novo módulo `src/modules/ai/speech.ts`

Espelha `transcribe.ts`:

```ts
export type Voice = { id: string; provider: "openai" | "gemini" | "elevenlabs";
                      externalId: string; label: string; preview?: string };

/** Sintetiza `text` na voz `voice`. Devolve null se nada funcionar —
 *  quem chama cai de volta para texto (a resposta NUNCA se perde). */
export async function synthesizeSpeech(
  text: string, voice: Voice,
): Promise<{ base64: string; mime: string } | null>
```

Regra de ouro herdada da `transcribeAudio`: **falha em TTS nunca derruba o turno**.
Retorna `null` → o webhook manda texto. O cliente sempre é respondido.

### 6.3 Catálogo de vozes `src/modules/ai/voices.ts`

Mesmo molde de `AI_MODELS`: id, provider, label, descrição ("feminina, calorosa"),
`envKey`, e `preview` (URL de amostra na Bunny). Isso resolve "não deixar algo fixo"
sem depender de clonagem.

### 6.4 Provider de WhatsApp

Estender o contrato ([provider.ts](../../../src/modules/whatsapp/provider.ts)):

```ts
/** Envia uma mensagem de voz (PTT). Devolve o key.id, como sendMessage. */
sendAudio(externalId: string, toPhone: string, base64: string): Promise<string | null>;
```

Na Evolution: `POST /message/sendWhatsAppAudio/{instance}` com
`{ number, audio: base64, encoding: true }`.

### 6.5 Ponto de integração no fluxo

No webhook ([route.ts](../../../src/app/api/webhooks/whatsapp/route.ts)), logo antes do
`provider.sendMessage`:

```
runAgentTurn → reply (texto)
   ↓
shouldSpeak(agent, incoming.hasAudio)?     // off | always | mirror
   ↓ sim
synthesizeSpeech(reply, voice)
   ↓ ok?                        ↓ null (falhou)
sendAudio(...)                sendMessage(...)   ← fallback silencioso
   ↓
uploadToBunny(audio) → Message.audioUrl        // para tocar em /conversas
```

O `orchestrator` **não muda** — ele continua devolvendo texto. A voz é uma
decisão de *entrega*, que pertence ao canal. Isso mantém o widget do site e o
sandbox funcionando sem tocar em nada.

### 6.6 UI

1. **`BehaviorSettings.tsx`** — nova opção "Responder por áudio", mas como o valor
   é ternário (`off/always/mirror`), não cabe no `Switch` atual. Sugestão: bloco
   próprio abaixo, com radio group + `select` de voz + botão "Ouvir amostra".
2. **Nova aba/seção "Voz"** em `/agentes/[id]` — catálogo com preview, e
   "Usar uma voz personalizada" (upload de 30s + checkbox de consentimento).
3. **`ChatBubble`** — aceitar `audioUrl` e renderizar um `<audio controls>`
   com o texto abaixo como legenda (nunca esconder o texto: acessibilidade e
   auditoria).
4. **Indicador de custo/uso** — se a clonagem for paga, o consumo de caracteres
   precisa entrar em `modules/billing/usage.ts`, junto da cota de conversas.

---

## 7. Riscos e obrigações (o item que mais pesa)

**"ou de outras pessoas" é o ponto delicado.** Clonar a voz de terceiros sem
autorização é ilegal e é o principal vetor de golpe por voz hoje.

Mitigações obrigatórias antes de liberar clonagem:
- **Consentimento explícito e registrado** — `TenantVoice.consentedAt/consentedBy`
  no schema acima. Checkbox com texto claro ("declaro ter autorização da pessoa
  cuja voz estou enviando"), não pré-marcado.
- **Termos da ElevenLabs** exigem que quem faz upload tenha direito sobre a
  amostra — a responsabilidade recai sobre o fechai se não houver o registro.
- **LGPD**: timbre de voz é dado biométrico. Amostras na Bunny precisam de
  política de retenção e de rota de exclusão.
- Considerar restringir clonagem a planos pagos com verificação, e manter as
  vozes de catálogo (sem clonagem) livres para todos.

Riscos técnicos menores:
- **Latência**: TTS adiciona 1–3s à resposta. Em conversa de WhatsApp é aceitável,
  mas vale medir.
- **Custo**: sem teto por conta, uma conversa longa em ElevenLabs vira prejuízo.
  Um limite de caracteres/mês por plano é necessário desde o dia 1.
- **Respostas longas**: áudio de 2 minutos é péssima UX. Limitar a ~600 chars e
  mandar o resto (ou tudo) em texto quando passar disso.

---

## 8. Sugestão de faseamento

| Fase | Escopo | Esforço |
|---|---|---|
| **1** | `speech.ts` + `voices.ts` com OpenAI/Gemini, `sendAudio` na Evolution, `Agent.replyWithAudio` + `voiceId`, `Message.audioUrl`, toggle e select na UI, player no `ChatBubble` | ~2 dias |
| **2** | Modo `mirror` (áudio só quando o cliente manda áudio), prévia de voz, limite de caracteres por resposta | ~1 dia |
| **3** | `TenantVoice` + ElevenLabs, upload de amostra, fluxo de consentimento, exclusão (LGPD) | ~3 dias |
| **4** | Cota de caracteres em `billing/usage.ts`, indicador de uso, gating por plano | ~1 dia |

A Fase 1 já entrega "o agente responde com áudio e a voz é escolhida, não fixa" —
que é o essencial do pedido — usando **chaves de API que já existem** e sem
nenhuma das obrigações legais da clonagem.

---

## 9. Decisões que precisam de você

1. **Clonagem entra?** Se sim, é ElevenLabs (custo ~250× o da OpenAI) e exige o
   fluxo de consentimento. Se a resposta for "só vozes prontas", a Fase 3 sai e o
   projeto vira ~3 dias no total.
2. **Chave da ElevenLabs é da plataforma ou de cada tenant?** Da plataforma =
   melhor UX, mas o custo é seu e precisa de cota. De cada tenant = sem risco
   financeiro, mas fricção alta no onboarding.
3. **Áudio sempre, ou só quando o cliente manda áudio?** O modo `mirror` costuma
   ser o mais natural, mas alguns nichos (imobiliária, coach) ganham com áudio
   sempre.
