import { describe, expect, it } from "vitest";
import { criarRitmo, opcoesDoAmbiente } from "../../bot/src/ritmo";

const MIN = 60_000;

/** Relógio de mentira: começa num múltiplo de 30 min, para os turnos ficarem previsíveis. */
function relogio(inicio = 1_000 * 30 * MIN) {
  let t = inicio;
  return { agora: () => t, andar: (ms: number) => (t += ms) };
}

describe("ritmo do bot", () => {
  it("começa atento: na subida todo laço chama sempre", () => {
    const r = relogio();
    const ritmo = criarRitmo({ janelaMs: 35 * MIN, repousoMs: 30 * MIN, agora: r.agora });
    expect(ritmo.atento()).toBe(true);
    for (let i = 0; i < 5; i++) {
      expect(ritmo.podeChamar("tick")).toBe(true);
      r.andar(30_000);
    }
  });

  it("em repouso, cada laço chama uma vez por turno, e os turnos são do relógio", () => {
    const r = relogio();
    const ritmo = criarRitmo({ janelaMs: 0, repousoMs: 30 * MIN, agora: r.agora });
    expect(ritmo.atento()).toBe(false);
    expect(ritmo.podeChamar("tick")).toBe(true);
    expect(ritmo.podeChamar("tick")).toBe(false);
    // Outro laço no mesmo turno ainda pode: é o mesmo acordar do banco.
    expect(ritmo.podeChamar("mensagens")).toBe(true);
    r.andar(29 * MIN);
    expect(ritmo.podeChamar("tick")).toBe(false);
    r.andar(1 * MIN);
    expect(ritmo.podeChamar("tick")).toBe(true);
  });

  it("acordar volta ao ritmo normal pela janela, e um prazo menor não encurta a janela em curso", () => {
    const r = relogio();
    const mudancas: string[] = [];
    const ritmo = criarRitmo({ janelaMs: 35 * MIN, repousoMs: 30 * MIN, agora: r.agora, aoMudar: (a, m) => mudancas.push(`${a}:${m}`) });
    r.andar(36 * MIN);
    expect(ritmo.atento()).toBe(false);
    ritmo.acordar("terminou a partida");
    expect(ritmo.atento()).toBe(true);
    ritmo.acordar("mensagens na fila", 1 * MIN);
    r.andar(34 * MIN);
    expect(ritmo.atento()).toBe(true);
    r.andar(2 * MIN);
    expect(ritmo.atento()).toBe(false);
    expect(mudancas).toEqual(["false:janela acabou", "true:terminou a partida", "false:janela acabou"]);
  });

  it("repousoMs = 0 desliga o repouso (a volta sem mexer no código)", () => {
    const r = relogio();
    const ritmo = criarRitmo({ janelaMs: 0, repousoMs: 0, agora: r.agora });
    r.andar(10 * 60 * MIN);
    expect(ritmo.atento()).toBe(true);
    expect(ritmo.podeChamar("tick")).toBe(true);
    expect(ritmo.podeChamar("tick")).toBe(true);
    expect(ritmo.estado()).toEqual({ atento: true, atentoAte: null, repousoMs: 0 });
  });

  it("um dia sem trabalho: os laços do bot acordam o banco 48 vezes, não 11 mil", () => {
    const r = relogio();
    const ritmo = criarRitmo({ janelaMs: 35 * MIN, repousoMs: 30 * MIN, agora: r.agora });
    // Os laços de produção: tick 30 s, mensagens e partidas 20 s, demos 5 min, logs 10 s.
    const lacos = { tick: 30_000, mensagens: 20_000, partidas: 20_000, demos: 5 * MIN, logs: 10_000 };
    const proxima = Object.fromEntries(Object.keys(lacos).map((l) => [l, r.agora()]));
    const chamadas: number[] = [];
    const fim = r.agora() + 24 * 60 * MIN;
    while (r.agora() < fim) {
      for (const [laco, intervalo] of Object.entries(lacos)) {
        if (r.agora() >= proxima[laco]!) {
          if (ritmo.podeChamar(laco)) chamadas.push(r.agora());
          proxima[laco] = r.agora() + intervalo;
        }
      }
      r.andar(10_000);
    }
    // Primeiros 35 min atentos, como na subida; depois, um turno por meia hora.
    const depoisDaJanela = chamadas.filter((t) => t >= 1_000 * 30 * MIN + 35 * MIN);
    const turnos = new Set(depoisDaJanela.map((t) => Math.floor(t / (30 * MIN))));
    expect(turnos.size).toBeLessThanOrEqual(48);
    // No máximo uma chamada por laço em cada turno.
    expect(depoisDaJanela.length).toBeLessThanOrEqual(turnos.size * Object.keys(lacos).length);
    // E todas as chamadas de um turno caem nos primeiros 5 min dele (o demos, de 5 em 5 min, é o último).
    for (const t of depoisDaJanela) expect(t % (30 * MIN)).toBeLessThanOrEqual(5 * MIN);
  });

  it("opções do ambiente: padrões de produção, número inválido cai no padrão e 0 vale", () => {
    expect(opcoesDoAmbiente({})).toEqual({ janelaMs: 35 * MIN, repousoMs: 30 * MIN });
    expect(opcoesDoAmbiente({ BOT_REPOUSO_MS: "0", BOT_JANELA_MS: " 60000 " })).toEqual({ janelaMs: 60_000, repousoMs: 0 });
    expect(opcoesDoAmbiente({ BOT_REPOUSO_MS: "abc", BOT_JANELA_MS: "-5" })).toEqual({ janelaMs: 35 * MIN, repousoMs: 30 * MIN });
  });
});
