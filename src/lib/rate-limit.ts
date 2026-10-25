import { createHash } from "node:crypto";
import { redis } from "@/lib/redis";

/**
 * Limitador de taxa genérico, em Redis — para endpoints que não são o login
 * (que tem freio próprio, progressivo, em `lib/login-throttle`).
 *
 * Janela fixa, não deslizante: para conter abuso de formulário público é
 * suficiente e custa uma operação só. O Redis é o que permite o limite valer
 * de verdade com mais de uma instância da aplicação no ar — um contador em
 * memória seria contornado só por cair em outro processo.
 */
export type RateLimitResult = {
  allowed: boolean;
  /** Segundos até a janela virar. 0 quando ainda há saldo. */
  retryAfterSeconds: number;
};

const ALLOWED: RateLimitResult = { allowed: true, retryAfterSeconds: 0 };

function counterKey(scope: string, subject: string): string {
  const digest = createHash("sha256").update(subject).digest("base64url").slice(0, 24);
  return `rl:${scope}:${digest}`;
}

/**
 * `scope` separa os contadores (ex.: "reset:ip" e "reset:email") e `subject` é
 * quem está sendo contado. O subject é hasheado: e-mail em claro numa chave do
 * Redis vira lista de clientes para quem tiver acesso ao cache.
 */
export async function rateLimit(
  scope: string,
  subject: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const key = counterKey(scope, subject);

  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSeconds);
    if (count <= limit) return ALLOWED;

    const ttl = await redis.ttl(key);
    return { allowed: false, retryAfterSeconds: ttl > 0 ? ttl : windowSeconds };
  } catch (error) {
    // Mesma escolha do freio de login: cache fora do ar não pode virar
    // indisponibilidade do produto.
    console.error(`[rate-limit] Redis indisponível em "${scope}" — liberando:`, error);
    return ALLOWED;
  }
}

/**
 * Reserva `amount` unidades de uma vez (quem gasta de N em N, como as
 * simulações do MCP, que custam uma chamada de LLM por mensagem). Usa o MESMO
 * contador de `rateLimit`, mas, se o pedido não cabe, devolve as `amount`
 * unidades antes de responder: o saldo parcial que sobrou continua disponível
 * para um pedido menor, em vez de ser queimado por um pedido que foi recusado.
 * Tudo ou nada: nunca reserva só uma parte do pedido. Com Redis fora do ar,
 * libera (mesma escolha de `rateLimit`).
 */
export async function rateLimitReserve(
  scope: string,
  subject: string,
  limit: number,
  windowSeconds: number,
  amount: number,
): Promise<RateLimitResult> {
  const key = counterKey(scope, subject);

  try {
    const count = await redis.incrby(key, amount);
    if (count === amount) await redis.expire(key, windowSeconds);
    if (count <= limit) return ALLOWED;

    await redis.decrby(key, amount);
    const ttl = await redis.ttl(key);
    return { allowed: false, retryAfterSeconds: ttl > 0 ? ttl : windowSeconds };
  } catch (error) {
    console.error(`[rate-limit] Redis indisponível em "${scope}" — liberando:`, error);
    return ALLOWED;
  }
}

/** "1 minuto", "15 minutos" — texto pronto para a mensagem de erro. */
export function formatWait(seconds: number): string {
  if (seconds <= 60) return "1 minuto";
  return `${Math.ceil(seconds / 60)} minutos`;
}

/**
 * Teto de tamanho para Server Actions que NÃO recebem arquivo.
 *
 * `serverActions.bodySizeLimit` é global: subi-lo para 50MB por causa do upload
 * de PDF da base de conhecimento passou a valer também para a ação que só
 * recebe um booleano. Quem está autenticado pode mandar 50MB para qualquer
 * uma delas e pressionar a memória de uma VPS que também roda Postgres, Redis e
 * o worker.
 *
 * Devolve mensagem em vez de lançar: as ações deste app retornam
 * `{ ok, error }` e o formulário mostra o texto: uma exceção aqui viraria tela
 * de erro genérica para o que é, do ponto de vista do usuário, um formulário
 * grande demais. `null` significa "pode seguir".
 *
 * O upload de documento (`addDocument`) NÃO usa isto — tem o próprio limite,
 * bem maior (`MAX_KB_FILE_BYTES`).
 */
export const MAX_FORM_BYTES = 512 * 1024;

export function payloadTooLarge(
  formData: FormData,
  maxBytes = MAX_FORM_BYTES,
): string | null {
  let total = 0;
  for (const [, value] of formData.entries()) {
    // File aparece aqui só se alguém anexar um a um formulário que não espera
    // arquivo — que é justamente um dos abusos a barrar.
    total += value instanceof File ? value.size : Buffer.byteLength(String(value), "utf8");
    if (total > maxBytes) {
      return "Os dados enviados são grandes demais para esta operação.";
    }
  }
  return null;
}
