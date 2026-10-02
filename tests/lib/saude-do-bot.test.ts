import { describe, expect, it } from "vitest";
import { estadoDoBot, haQuanto, REPOUSO_DO_BOT_MS } from "@/lib/saude-do-bot";

describe("saúde do bot no painel", () => {
  it("tick recente é vivo; dentro do turno do repouso é repouso; além disso, parado", () => {
    expect(estadoDoBot({ tickHaMs: 30_000, logado: true })).toBe("vivo");
    expect(estadoDoBot({ tickHaMs: 10 * 60_000, logado: true })).toBe("repouso");
    expect(estadoDoBot({ tickHaMs: REPOUSO_DO_BOT_MS + 4 * 60_000, logado: true })).toBe("repouso");
    expect(estadoDoBot({ tickHaMs: REPOUSO_DO_BOT_MS + 5 * 60_000, logado: true })).toBe("parado");
  });

  it("sem sessão na Steam é deslogado enquanto o processo dá sinal, e parado depois", () => {
    expect(estadoDoBot({ tickHaMs: 30_000, logado: false })).toBe("deslogado");
    expect(estadoDoBot({ tickHaMs: 20 * 60_000, logado: false })).toBe("deslogado");
    expect(estadoDoBot({ tickHaMs: 2 * REPOUSO_DO_BOT_MS, logado: false })).toBe("parado");
  });

  it("sem tick nenhum é nunca", () => {
    expect(estadoDoBot(null)).toBe("nunca");
  });

  it("o tempo sai em segundos até 2 min e em minutos depois", () => {
    expect(haQuanto(40_000)).toBe("há 40 s");
    expect(haQuanto(12 * 60_000)).toBe("há 12 min");
  });
});
