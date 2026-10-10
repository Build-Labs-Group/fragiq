import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * As fontes de produção sobre um Prisma de mentira: o que sai delas são
 * contagens e idades, nunca linhas (sem SteamID, sem id de usuário).
 */
const prisma = vi.hoisted(() => ({
  botStatus: { findUnique: vi.fn() },
  cronRun: { findFirst: vi.fn() },
  user: { count: vi.fn() },
  statSnapshot: { count: vi.fn() },
  match: { count: vi.fn() },
  session: { count: vi.fn() },
  insight: { groupBy: vi.fn() },
  botLog: { count: vi.fn() },
  steamMessage: { count: vi.fn() },
  $queryRaw: vi.fn(),
}));
const medirPendencias = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/lib/saude-dos-dados", () => ({ medirPendencias }));

import { fontesDoBanco } from "@/lib/indicadores-fonte";
import { REGRAS_EM_VIGOR } from "@/lib/insights/regras";

const AGORA = new Date("2026-10-10T12:00:00Z");

beforeEach(() => vi.resetAllMocks());

describe("fontes de indicadores sobre o banco", () => {
  it("pendências viram contagens: a mesma partida de dois jogadores conta uma vez e nada de id vaza", async () => {
    medirPendencias.mockResolvedValue({
      partidasSemSessao: [
        { matchId: "m1", userId: "cuid-da-ana", fim: new Date("2026-10-09T01:00:00Z") },
        { matchId: "m1", userId: "cuid-da-bia", fim: new Date("2026-10-09T01:00:00Z") },
        { matchId: "m2", userId: "cuid-da-ana", fim: new Date("2026-10-09T10:00:00Z") },
      ],
      analisesSemResposta: [{ id: "a1", userId: "u", createdAt: AGORA }],
      capturasVencidas: [],
    });
    const r = await fontesDoBanco().pendencias(AGORA);
    expect(r).toEqual({
      partidasSemSessao: 2,
      partidaMaisAntigaMs: 35 * 3_600_000,
      analisesSemResposta: 1,
      capturasVencidas: 0,
    });
    expect(JSON.stringify(r)).not.toContain("cuid");
  });

  it("sem pendência, a partida mais antiga é null", async () => {
    medirPendencias.mockResolvedValue({ partidasSemSessao: [], analisesSemResposta: [], capturasVencidas: [] });
    expect((await fontesDoBanco().pendencias(AGORA)).partidaMaisAntigaMs).toBeNull();
  });

  it("bot: sem linha é null; com linha devolve a idade do tick", async () => {
    prisma.botStatus.findUnique.mockResolvedValueOnce(null);
    expect(await fontesDoBanco().bot(AGORA)).toBeNull();
    prisma.botStatus.findUnique.mockResolvedValueOnce({
      ultimoTickEm: new Date("2026-10-10T11:58:00Z"),
      logado: true,
      desconectadoDesde: null,
    });
    expect(await fontesDoBanco().bot(AGORA)).toMatchObject({ tickHaMs: 120_000, logado: true });
  });

  it("coleta: horas desde a última, ou null sem nenhuma", async () => {
    prisma.cronRun.findFirst.mockResolvedValueOnce({ startedAt: new Date("2026-10-10T07:00:00Z") });
    expect(await fontesDoBanco().coletaHaH(AGORA)).toBe(5);
    prisma.cronRun.findFirst.mockResolvedValueOnce(null);
    expect(await fontesDoBanco().coletaHaH(AGORA)).toBeNull();
  });

  it("uso: só contagens", async () => {
    prisma.user.count.mockResolvedValueOnce(12).mockResolvedValueOnce(2);
    prisma.statSnapshot.count.mockResolvedValue(9);
    prisma.match.count.mockResolvedValue(4);
    prisma.session.count.mockResolvedValue(3);
    expect(await fontesDoBanco().uso(AGORA)).toEqual({ usuarios: 12, novos7d: 2, snapshots24h: 9, partidas24h: 4, sessoes24h: 3 });
    expect(prisma.match.count).toHaveBeenCalledWith({ where: { status: "DONE", createdAt: { gte: new Date("2026-10-09T12:00:00Z") } } });
  });

  it("integridade: conta só insights de regras em vigor com versão diferente da atual", async () => {
    const r0 = REGRAS_EM_VIGOR[0];
    const r1 = REGRAS_EM_VIGOR[REGRAS_EM_VIGOR.length - 1];
    prisma.session.count.mockResolvedValue(2);
    prisma.insight.groupBy.mockResolvedValue([
      { regra: r0.regra, escopo: r0.escopo, regraVersao: r0.versao, _count: { _all: 40 } },
      { regra: r0.regra, escopo: r0.escopo, regraVersao: r0.versao + 1, _count: { _all: 6 } },
      { regra: r1.regra, escopo: r1.escopo, regraVersao: r1.versao + 1, _count: { _all: 1 } },
      { regra: "regra.aposentada", escopo: "SESSAO", regraVersao: 0, _count: { _all: 99 } },
    ]);
    prisma.$queryRaw.mockResolvedValueOnce([{ n: BigInt(1) }]).mockResolvedValueOnce([{ n: BigInt(4) }]);
    expect(await fontesDoBanco().integridade(AGORA)).toEqual({
      sessoesComRegraAtrasada: 2,
      insightsComRegraAtrasada: 7,
      sessoesComPartidaInexistente: 1,
      observacoesSemPonto: 4,
    });
  });

  it("integridade: consulta sem linha dá NaN (a fonte falha), não zero", async () => {
    prisma.session.count.mockResolvedValue(0);
    prisma.insight.groupBy.mockResolvedValue([]);
    prisma.$queryRaw.mockResolvedValue([]);
    const r = await fontesDoBanco().integridade(AGORA);
    expect(Number.isNaN(r.sessoesComPartidaInexistente)).toBe(true);
  });

  it("filas: erros do bot, mensagens que falharam e partidas do GC paradas", async () => {
    prisma.botLog.count.mockResolvedValue(11);
    prisma.steamMessage.count.mockResolvedValue(1);
    prisma.match.count.mockResolvedValue(2);
    expect(await fontesDoBanco().filas(AGORA)).toEqual({ botErros24h: 11, mensagensSteamFalhas24h: 1, partidasGcPendentes: 2 });
    expect(prisma.botLog.count).toHaveBeenCalledWith({ where: { nivel: "ERROR", em: { gte: new Date("2026-10-09T12:00:00Z") } } });
  });
});
