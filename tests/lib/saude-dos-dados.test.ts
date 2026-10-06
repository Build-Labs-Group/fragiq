import { describe, expect, it, vi } from "vitest";
import { linhaDeMetricas, pendenciasDe, type DadosDaSaude } from "@/lib/saude-dos-dados";

// A regra é pura; o banco só entra em medirPendencias.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

/**
 * A checagem que teria pegado os dois casos de 02 e 03/10/2026: a análise
 * que ficou sem resposta (e deslocou as seguintes) e a partida que o GC
 * devolveu mas nenhuma sessão contém.
 */

const AGORA = new Date("2026-10-04T12:00:00Z");
const h = (horas: number) => new Date(AGORA.getTime() - horas * 3_600_000);

function dados(parcial: Partial<DadosDaSaude>): DadosDaSaude {
  return { partidas: [], sessoes: [], primeiroPonto: new Map([["u1", h(24 * 10)]]), analisesAbertas: [], capturas: [], ...parcial };
}

describe("partida sem sessão", () => {
  const partida = { id: "m1", jogadaEm: h(30), duracaoS: 40 * 60, userIds: ["u1"] };

  it("terminada há mais de 24 h e fora de toda sessão: pendente", () => {
    const p = pendenciasDe(dados({ partidas: [partida] }), AGORA);
    expect(p.partidasSemSessao).toEqual([{ matchId: "m1", userId: "u1", fim: new Date(h(30).getTime() + 40 * 60_000) }]);
  });

  it("dentro da janela de uma sessão, ou citada nela: coberta", () => {
    const janela = { userId: "u1", de: h(31), ate: h(28), matchIds: [] };
    expect(pendenciasDe(dados({ partidas: [partida], sessoes: [janela] }), AGORA).partidasSemSessao).toEqual([]);
    const citada = { userId: "u1", de: h(100), ate: h(99), matchIds: ["m1"] };
    expect(pendenciasDe(dados({ partidas: [partida], sessoes: [citada] }), AGORA).partidasSemSessao).toEqual([]);
  });

  it("a sessão de outro jogador não cobre", () => {
    const deOutro = { userId: "u2", de: h(31), ate: h(28), matchIds: ["m1"] };
    expect(pendenciasDe(dados({ partidas: [partida], sessoes: [deOutro] }), AGORA).partidasSemSessao).toHaveLength(1);
  });

  it("menos de 24 h: ainda no prazo (a Steam pode só publicar quando o jogo fecha)", () => {
    const recente = { ...partida, jogadaEm: h(10) };
    expect(pendenciasDe(dados({ partidas: [recente] }), AGORA).partidasSemSessao).toEqual([]);
  });

  it("antes do primeiro ponto do jogador não há série: não conta", () => {
    const d = dados({ partidas: [partida], primeiroPonto: new Map([["u1", h(5)]]) });
    expect(pendenciasDe(d, AGORA).partidasSemSessao).toEqual([]);
    expect(pendenciasDe(dados({ partidas: [partida], primeiroPonto: new Map() }), AGORA).partidasSemSessao).toEqual([]);
  });
});

describe("análise sem resposta e captura vencida", () => {
  it("análise aberta há mais de 30 min: pendente; há 10 min: no prazo", () => {
    const p = pendenciasDe(
      dados({
        analisesAbertas: [
          { id: "a-velha", userId: "u1", createdAt: h(1) },
          { id: "a-nova", userId: "u1", createdAt: new Date(AGORA.getTime() - 10 * 60_000) },
        ],
      }),
      AGORA,
    );
    expect(p.analisesSemResposta.map((a) => a.id)).toEqual(["a-velha"]);
  });

  it("captura que devia ter rodado há mais de 1 h: o tick parou", () => {
    const p = pendenciasDe(
      dados({ capturas: [{ id: "c1", userId: "u1", proximaEm: h(2) }, { id: "c2", userId: "u1", proximaEm: h(0.2) }] }),
      AGORA,
    );
    expect(p.capturasVencidas.map((c) => c.id)).toEqual(["c1"]);
  });
});

describe("linha de métricas (EMF)", () => {
  it("três contagens no namespace FragIQ, sem dimensão", () => {
    const linha = JSON.parse(
      linhaDeMetricas({ partidasSemSessao: [], analisesSemResposta: [{ id: "a", userId: "u", createdAt: AGORA }], capturasVencidas: [] }, AGORA),
    );
    expect(linha._aws.CloudWatchMetrics[0]).toMatchObject({ Namespace: "FragIQ", Dimensions: [[]] });
    expect(linha).toMatchObject({ PartidasSemSessao: 0, AnalisesSemResposta: 1, CapturasVencidas: 0 });
  });
});
