/** Falha esperada de uma ferramenta: vira `isError` no resultado, não erro de protocolo. */
export class McpToolError extends Error {}

/**
 * A ferramenta passou do limite próprio dela (ex.: turnos de simulação). A rota
 * responde 429 com `Retry-After`, igual ao limite geral por token — não é um
 * `isError` de 200, porque o cliente precisa saber que deve esperar.
 */
export class McpRateLimitedError extends Error {
  constructor(
    message: string,
    readonly retryAfterSeconds: number,
  ) {
    super(message);
  }
}
