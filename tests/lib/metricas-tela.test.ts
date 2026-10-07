import { describe, expect, it } from "vitest";
import { todasAsMetricas } from "@/lib/leituras";
import { fraseDoImpacto, MAX_DESTAQUES, separarMetricas } from "@/lib/metricas-tela";
import { direcaoDoContador } from "@/lib/direcao";
import { normal, serie } from "./fixtures";

/**
 * A aba Métricas: o que sobe para os cartões e o que fica na grade.
 *
 * A série tem seis sessões normais (1 kill e 1 morte por round, AK a 30%) e
 * a sessão lida: mais kills, menos mortes, a AK parada e um contador de
 * volume (tiros) que subiu muito — volume não tem lado e não é destaque.
 */
const base = { total_shots_fired: 0, total_mvps: 0, last_match_kills: 0 };
const rows = (() => {
  const r = serie([...Array.from({ length: 6 }, () => normal()), normal({ kills: 45, deaths: 20, ak: { tiros: 0, acertos: 0, kills: 0 } })], base);
  // Volume: tiros sobem sempre um pouco e explodem na última sessão.
  r.forEach((x, i) => (x.metrics.total_shots_fired = i * 300 + (i === r.length - 1 ? 2000 : 0)));
  r.forEach((x, i) => (x.metrics.last_match_kills = i));
  return r;
})();
const chaves = Object.keys(rows[0].metrics);
const linhas = todasAsMetricas(rows, chaves);
const { destaques, resto, congeladas } = separarMetricas(linhas, 30);

describe("separarMetricas", () => {
  it("destaque é o que se moveu, tem lado e fugiu do normal — do maior desvio para o menor", () => {
    expect(destaques.map((d) => d.key)).toEqual(["total_kills", "total_deaths"]);
    expect(destaques.length).toBeLessThanOrEqual(MAX_DESTAQUES);
  });

  it("a cor vem da tabela: kills a mais é bom, mortes a menos também", () => {
    const kills = destaques.find((d) => d.key === "total_kills")!;
    const mortes = destaques.find((d) => d.key === "total_deaths")!;
    expect(kills.delta).toMatchObject({ estado: "ok", direcao: "sobe", valencia: "good" });
    expect(mortes.delta).toMatchObject({ estado: "ok", direcao: "desce", valencia: "good" });
  });

  it("volume (tiros) não é destaque e tem chip neutro", () => {
    const tiros = resto.find((m) => m.key === "total_shots_fired")!;
    expect(tiros.delta).toMatchObject({ valencia: "neutral" });
  });

  it("dinheiro, pontos do placar e acertos por arma não têm lado (eram o topo da aba em produção)", () => {
    expect(direcaoDoContador("total_money_earned")).toBe("nenhuma");
    expect(direcaoDoContador("total_contribution_score")).toBe("nenhuma");
    expect(direcaoDoContador("total_hits_m4a1")).toBe("nenhuma");
  });

  it("contador parado vai para o fim da grade; última partida fica separada", () => {
    const parados = resto.filter((m) => !m.aconteceu).map((m) => m.key);
    expect(parados).toContain("total_shots_ak47");
    expect(resto.findIndex((m) => !m.aconteceu)).toBeGreaterThan(resto.findIndex((m) => m.aconteceu));
    expect(congeladas.map((m) => m.key)).toEqual(["last_match_kills"]);
    expect(resto.some((m) => m.key === "last_match_kills")).toBe(false);
  });

  it("nomes em português, não os crus da Steam", () => {
    expect(destaques.find((d) => d.key === "total_deaths")!.rotulo).toBe("Mortes");
    expect(resto.find((m) => m.key === "total_kills_ak47")!.rotulo).toBe("Kills · AK-47");
  });

  it("o impacto é dito em eventos: 45 kills em 30 rounds contra o vitalício de 225/210 por round", () => {
    const kills = destaques.find((d) => d.key === "total_kills")!;
    // (1,5 − 225/210) × 30 = 12,9
    expect(fraseDoImpacto(kills)).toBe("+13 a mais que o seu normal");
  });
});
