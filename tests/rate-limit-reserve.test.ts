import { beforeEach, describe, expect, it, vi } from "vitest";

/** Redis em memória: só o que o limitador usa. */
const store = vi.hoisted(() => {
  const counters = new Map<string, number>();
  return {
    counters,
    incr: vi.fn(async (key: string) => {
      counters.set(key, (counters.get(key) ?? 0) + 1);
      return counters.get(key)!;
    }),
    incrby: vi.fn(async (key: string, n: number) => {
      counters.set(key, (counters.get(key) ?? 0) + n);
      return counters.get(key)!;
    }),
    decrby: vi.fn(async (key: string, n: number) => {
      counters.set(key, (counters.get(key) ?? 0) - n);
      return counters.get(key)!;
    }),
    expire: vi.fn(async () => 1),
    ttl: vi.fn(async () => 42),
  };
});
vi.mock("@/lib/redis", () => ({ redis: store }));

import { rateLimit, rateLimitReserve } from "@/lib/rate-limit";

beforeEach(() => {
  store.counters.clear();
  vi.clearAllMocks();
});

describe("rateLimitReserve", () => {
  it("pedido que cabe reserva tudo de uma vez e põe a janela uma vez", async () => {
    const result = await rateLimitReserve("t", "tok", 30, 600, 10);
    expect(result).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(store.incrby).toHaveBeenCalledTimes(1);
    expect(store.expire).toHaveBeenCalledTimes(1);
    expect(store.decrby).not.toHaveBeenCalled();
  });

  it("pedido recusado devolve o que somou: não consome o saldo", async () => {
    await rateLimitReserve("t", "tok", 10, 600, 5); // sobram 5
    const refused = await rateLimitReserve("t", "tok", 10, 600, 10);
    expect(refused).toEqual({ allowed: false, retryAfterSeconds: 42 });
    expect(store.decrby).toHaveBeenCalledWith(expect.any(String), 10);
    expect([...store.counters.values()]).toEqual([5]);
  });

  it("saldo parcial é aproveitado depois de um pedido recusado", async () => {
    await rateLimitReserve("t", "tok", 10, 600, 5);
    expect((await rateLimitReserve("t", "tok", 10, 600, 10)).allowed).toBe(false);
    expect((await rateLimitReserve("t", "tok", 10, 600, 5)).allowed).toBe(true);
    expect((await rateLimitReserve("t", "tok", 10, 600, 1)).allowed).toBe(false);
    expect([...store.counters.values()]).toEqual([10]);
  });

  it("divide o contador com rateLimit (mesma chave)", async () => {
    await rateLimit("t", "tok", 3, 600);
    await rateLimitReserve("t", "tok", 3, 600, 2);
    expect([...store.counters.values()]).toEqual([3]);
    expect((await rateLimit("t", "tok", 3, 600)).allowed).toBe(false);
  });

  it("Redis fora do ar libera, como rateLimit", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    store.incrby.mockRejectedValueOnce(new Error("down"));
    expect((await rateLimitReserve("t", "tok", 3, 600, 2)).allowed).toBe(true);
  });
});
