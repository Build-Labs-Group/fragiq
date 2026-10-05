import { describe, expect, it } from "vitest";
import { leiturasPublicas } from "@/lib/leituras-publicas";
import { histograma, percentil, quantil } from "@/lib/estatistica";
import type { PartidaLinha } from "@/lib/partidas";

/**
 * As leituras do perfil público e as contas de distribuição. O que importa:
 * nenhuma leitura com amostra abaixo do mínimo, posição contada contra a
 * comunidade inteira, e mapa/horário só entre grupos com amostra.
 */
let seq = 0;
function partida(o: { mapa?: string; venceu?: boolean | null; k?: number; d?: number; hs?: number; hora?: number }): PartidaLinha {
  seq++;
  // 2026-10-01 às `hora` de Brasília (UTC-3), uma partida por dia para trás.
  const jogadaEm = new Date(Date.UTC(2026, 9, 1, (o.hora ?? 21) + 3) - seq * 86_400_000);
  return {
    id: `m${seq}`,
    shareCode: `CSGO-${seq}`,
    jogadaEm,
    duracaoS: 2400,
    rounds: 24,
    mapa: o.mapa ?? "de_mirage",
    modo: "competitive",
    placar: [13, 11],
    demoUrl: null,
    eu: { kills: o.k ?? 20, assists: 3, deaths: o.d ?? 20, mvps: 2, score: 40, hs: o.hs ?? 8, venceu: o.venceu === undefined ? true : o.venceu, time: 0 },
    conhecidos: [],
  };
}
const comunidade = (n: number) => ({ kd: Array.from({ length: n }, (_, i) => 0.5 + i / n).sort((a, b) => a - b), hs: Array.from({ length: n }, (_, i) => 20 + (i * 40) / n) });

describe("leituras públicas", () => {
  it("abaixo de 5 partidas não diz nada", () => {
    expect(leiturasPublicas([partida({}), partida({}), partida({}), partida({})], comunidade(100))).toEqual([]);
  });

  it("posição na fila só com comunidade de 20 ou mais", () => {
    const ps = Array.from({ length: 6 }, () => partida({ k: 30, d: 20 }));
    expect(leiturasPublicas(ps, comunidade(10)).find((l) => l.id === "posicao.kd")).toBeUndefined();
    const kd = leiturasPublicas(ps, comunidade(100)).find((l) => l.id === "posicao.kd")!;
    // K/D 1,50 numa comunidade de 0,50 a 1,49: acima de todos.
    expect(kd.valor).toBe("top 1%");
    expect(kd.tom).toBe("bom");
  });

  it("melhor e pior mapa só entre mapas com 3 partidas ou mais", () => {
    const ps = [
      ...Array.from({ length: 3 }, () => partida({ mapa: "de_dust2", venceu: true })),
      ...Array.from({ length: 3 }, () => partida({ mapa: "de_inferno", venceu: false })),
      partida({ mapa: "de_nuke", venceu: false }),
      partida({ mapa: "de_nuke", venceu: false }),
    ];
    const ls = leiturasPublicas(ps, comunidade(0));
    expect(ls.find((l) => l.id === "mapa.melhor")?.valor).toBe("Dust2");
    expect(ls.find((l) => l.id === "mapa.pior")?.valor).toBe("Inferno");
  });

  it("sequência a partir de 3, contando da partida mais recente", () => {
    const ps = [partida({ venceu: false }), partida({ venceu: false }), partida({ venceu: false }), partida({ venceu: true }), partida({ venceu: true })];
    expect(leiturasPublicas(ps, comunidade(0)).find((l) => l.id === "sequencia")).toMatchObject({ valor: "3 derrotas", tom: "ruim" });
  });

  it("forma compara as últimas 5 com as anteriores, soma sobre soma", () => {
    const ps = [...Array.from({ length: 5 }, () => partida({ k: 30, d: 15 })), ...Array.from({ length: 5 }, () => partida({ k: 15, d: 15 }))];
    expect(leiturasPublicas(ps, comunidade(0)).find((l) => l.id === "forma")).toMatchObject({ valor: "▲ 100%", tom: "bom" });
  });

  it("melhor horário pelo fuso de Brasília", () => {
    const ps = [
      ...Array.from({ length: 3 }, () => partida({ hora: 21, venceu: true })),
      ...Array.from({ length: 3 }, () => partida({ hora: 14, venceu: false })),
    ];
    expect(leiturasPublicas(ps, comunidade(0)).find((l) => l.id === "horario")?.valor).toBe("noite");
  });
});

describe("estatística", () => {
  it("percentil com empates pela metade", () => {
    expect(percentil([1, 2, 3, 4], 3)).toBe(62.5);
    expect(percentil([], 3)).toBeNull();
  });
  it("quantil por interpolação", () => {
    expect(quantil([0, 10], 0.5)).toBe(5);
    expect(quantil([1, 2, 3], 1)).toBe(3);
  });
  it("histograma põe os extremos nas pontas", () => {
    const h = histograma([-5, 0, 0.5, 1, 99], 0, 1, 2);
    expect(h.map((b) => b.n)).toEqual([2, 3]);
  });
});
