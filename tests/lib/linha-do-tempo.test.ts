import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DemoPayload } from "@/lib/demo/payload";
import { conversaoDaDemo } from "@/lib/demo/conversao";
import { ladosPorRound } from "@/lib/demo/metricas";
import { LINHA_DO_TEMPO_VERSAO, lerLinhaDoTempo, linhaDoTempo } from "@/lib/demo/linha-do-tempo";

/** A partida real de Premier em Ancient dos outros testes de demo — 8 rounds, o último por rendição. */
const ancient: DemoPayload = JSON.parse(readFileSync(new URL("../fixtures/demo-ancient.json", import.meta.url), "utf8"));

describe("linhaDoTempo", () => {
  it("um round por round jogado, sem o da rendição, com o placar acumulado", () => {
    const l = linhaDoTempo(ancient);
    expect(l.versao).toBe(LINHA_DO_TEMPO_VERSAO);
    expect(l.rounds.map((r) => r.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const ultimo = l.rounds[l.rounds.length - 1];
    expect(ultimo.placar[0] + ultimo.placar[1]).toBe(7);
    // O lado de quem venceu é o que a demo diz.
    expect(l.rounds.map((r) => r.lado)).toEqual(["T", "CT", "CT", "CT", "CT", "CT", "T"]);
  });

  it("o placar da faixa é o mesmo da conversão — a mesma identidade de time", () => {
    const l = linhaDoTempo(ancient);
    const conversao = conversaoDaDemo(ancient);
    const final = l.rounds[l.rounds.length - 1].placar;
    for (const [i, t] of l.times.entries()) {
      const c = conversao.find((x) => x.ladoInicial === t.ladoInicial)!;
      expect(final[i]).toBe(c.roundsGanhos);
    }
  });

  it("sem economia no payload (v1) não há compra; com economia, uma classe por time", () => {
    expect(linhaDoTempo(ancient).rounds.every((r) => r.compra === undefined)).toBe(true);
    const lados = ladosPorRound(ancient);
    const v2: DemoPayload = {
      ...ancient,
      versao: 2,
      rounds: ancient.rounds.map((r) => ({
        ...r,
        economia: [...(lados.get(r.n) ?? [])].map(([steamId, lado]) => ({ steamId, lado, saldo: 0, equipamento: r.n === 1 ? 800 : 4200 })),
      })),
    };
    const l = linhaDoTempo(v2);
    expect(l.rounds[0].compra).toEqual(["pistol", "pistol"]);
    expect(l.rounds[1].compra).toEqual(["cheia", "cheia"]);
  });

  it("lê só a versão atual; o resto é nada", () => {
    expect(lerLinhaDoTempo(linhaDoTempo(ancient))).not.toBeNull();
    expect(lerLinhaDoTempo({ versao: 0, rounds: [], times: [] })).toBeNull();
    expect(lerLinhaDoTempo(null)).toBeNull();
  });
});
