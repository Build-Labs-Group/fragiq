import { describe, expect, it } from "vitest";
import { cuHoraPorMes, diferenca, tempoAcordado } from "../../scripts/banco/medir";

const MIN = 60_000;

describe("medição do banco (D2)", () => {
  it("consultas por minuto: só o que cresceu, da maior para a menor", () => {
    const antes = [
      { queryid: "1", query: 'SELECT  "public"."a"', calls: "10" },
      { queryid: "2", query: 'SELECT "public"."b"', calls: "5" },
    ];
    const depois = [
      { queryid: "1", query: 'SELECT  "public"."a"', calls: "20" },
      { queryid: "2", query: 'SELECT "public"."b"', calls: "5" },
      { queryid: "3", query: 'INSERT "public"."c"', calls: "25" },
    ];
    const d = diferenca(antes, depois, 5);
    expect(d.total).toBe(7);
    expect(d.porConsulta.map((l) => [l.query, l.porMinuto])).toEqual([
      ['INSERT "public"."c"', 5],
      ['SELECT "public"."a"', 2],
    ]);
  });

  it("o bot de antes (consulta a cada minuto) deixa o Neon acordado o tempo todo: 182 CU-hora", () => {
    const amostras = Array.from({ length: 60 }, (_, i) => ({ em: (i + 1) * MIN, chamadas: 30 }));
    const t = tempoAcordado(amostras, 0, 60 * MIN);
    expect(t.fracao).toBe(1);
    expect(cuHoraPorMes(t.fracao)).toBeCloseTo(182.5);
  });

  it("um acordar a cada 30 min deixa o Neon acordado um quinto do tempo (o minuto da amostra mais 5)", () => {
    // Amostra de 1 min; consulta só nos minutos 0-1 e 30-31 de cada hora.
    const amostras = Array.from({ length: 120 }, (_, i) => ({ em: (i + 1) * MIN, chamadas: i % 30 === 0 ? 4 : 0 }));
    const t = tempoAcordado(amostras, 0, 120 * MIN);
    // Cada acordar: o minuto da amostra mais 5 de suspensão.
    expect(t.acordadoMs).toBe(4 * 6 * MIN);
    expect(t.fracao).toBeCloseTo(0.2);
    expect(cuHoraPorMes(t.fracao)).toBeCloseTo(36.5);
  });

  it("acordares próximos se juntam e nada passa do fim", () => {
    const t = tempoAcordado(
      [
        { em: 1 * MIN, chamadas: 1 },
        { em: 3 * MIN, chamadas: 1 },
        { em: 10 * MIN, chamadas: 0 },
      ],
      0,
      10 * MIN,
    );
    // [0, 6] ∪ [1, 8] = 8 min.
    expect(t.acordadoMs).toBe(8 * MIN);
  });
});
