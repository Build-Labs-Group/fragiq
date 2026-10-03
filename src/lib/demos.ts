import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./prisma";
import { registrar } from "./eventos";
import { demoPayload, type DemoPayload } from "./demo/payload";
import { metricasDaDemo, REGRAS_VERSAO, type Metricas } from "./demo/metricas";
import { conversaoDaDemo } from "./demo/conversao";
import { ritmoDaDemo, type RitmoDeTime } from "./demo/ritmo";
import { economiaDaDemo, porCompraDaDemo, type EconomiaDeTime, type PorCompra } from "./demo/economia";

/**
 * Demos: a fila para o bot e o que fazer com o que ele traz.
 *
 * Toda partida que o GC respondeu tem uma URL de demo, e a Valve a mantém
 * por ~30 dias. O bot (`bot/src/demos.ts`) pergunta o que falta ler, baixa,
 * reduz a eventos e devolve; aqui os eventos viram `MatchDemo.dados` (o
 * fato, guardado inteiro) e as métricas por jogador viram
 * `MatchPlayerDemo` (a regra, versionada, recalculável). Ver docs/demos.md.
 */

/** Depois disso a Valve costuma ter apagado a demo; não vale pedir. */
const JANELA_DIAS = 30;
/** Tentativas de download/parser antes de desistir. */
const MAX_TENTATIVAS = 3;

export type DemoPendente = { matchId: string; shareCode: string; demoUrl: string };

/** A próxima demo a ler: a mais recente que ainda não foi lida nem esgotou as tentativas. */
export async function filaDeDemos(limite = 1): Promise<DemoPendente[]> {
  const desde = new Date(Date.now() - JANELA_DIAS * 86_400_000);
  const partidas = await prisma.match.findMany({
    where: {
      status: "DONE",
      demoUrl: { not: null },
      jogadaEm: { gte: desde },
      OR: [{ demo: null }, { demo: { status: "PENDING", tentativas: { lt: MAX_TENTATIVAS } } }],
    },
    orderBy: { jogadaEm: "desc" },
    take: limite,
    select: { id: true, shareCode: true, demoUrl: true },
  });
  return partidas.map((p) => ({ matchId: p.id, shareCode: p.shareCode, demoUrl: p.demoUrl! }));
}

function linhaDe(matchId: string, m: Metricas, porCompra: PorCompra | undefined): Prisma.MatchPlayerDemoCreateManyInput {
  const { rating, zonas, ...resto } = m;
  return {
    ...resto,
    matchId,
    versaoRegras: REGRAS_VERSAO,
    zonas: zonas as Prisma.InputJsonValue,
    porCompra: porCompra ? (porCompra as Prisma.InputJsonValue) : Prisma.JsonNull,
    ratingTipo: rating?.tipo ?? null,
    ratingAntes: rating?.antes ?? null,
    ratingDepois: rating?.depois ?? null,
    ratingMudanca: rating?.mudanca ?? null,
    ratingVitorias: rating?.vitorias ?? null,
  };
}

/**
 * A linha de um time: conversão, ritmo e economia, as três leituras de
 * time da mesma demo, casadas pelo lado em que o time começou — que é a
 * identidade que `timesPorRound` dá a todas.
 */
function linhasDosTimes(matchId: string, p: DemoPayload): Prisma.MatchTeamDemoCreateManyInput[] {
  const ritmo = new Map(ritmoDaDemo(p).map((r) => [r.ladoInicial, r]));
  const economia = new Map(economiaDaDemo(p).map((e) => [e.ladoInicial, e]));
  return conversaoDaDemo(p).map((c) => {
    const { jogadores, ...resto } = c;
    return {
      ...resto,
      ...colunasDoRitmo(ritmo.get(c.ladoInicial)),
      ...colunasDaEconomia(economia.get(c.ladoInicial)),
      matchId,
      versaoRegras: REGRAS_VERSAO,
      jogadores: jogadores as Prisma.InputJsonValue,
    };
  });
}

/**
 * As contagens de economia, uma a uma como as do ritmo. Aqui o vazio é
 * nulo, não zero: time sem amostra é demo lida em payload v1, e "0 rounds
 * de eco" diria que o time comprou em todos.
 */
function colunasDaEconomia(e: EconomiaDeTime | undefined) {
  return {
    pistol: e?.pistol ?? null,
    pistolGanhos: e?.pistolGanhos ?? null,
    eco: e?.eco ?? null,
    ecoGanhos: e?.ecoGanhos ?? null,
    meia: e?.meia ?? null,
    meiaGanhas: e?.meiaGanhas ?? null,
    cheia: e?.cheia ?? null,
    cheiaGanhas: e?.cheiaGanhas ?? null,
  };
}

/**
 * As colunas de ritmo, nomeadas uma a uma para que o banco não herde campo
 * que ninguém pediu. Time sem ritmo cai no ritmo vazio — que é o mesmo que
 * `ritmoDaDemo` devolve para quem não encostou em ninguém nem plantou.
 */
function colunasDoRitmo(r: RitmoDeTime | undefined) {
  return {
    segundoContatoCT: r?.segundoContatoCT ?? null,
    contatosCT: r?.contatosCT ?? 0,
    segundoContatoT: r?.segundoContatoT ?? null,
    contatosT: r?.contatosT ?? 0,
    segundoPlant: r?.segundoPlant ?? null,
  };
}

/** As linhas de jogador de uma demo: as métricas e, quando o payload tem economia, o recorte por compra. */
function linhasDosJogadores(matchId: string, p: DemoPayload): Prisma.MatchPlayerDemoCreateManyInput[] {
  const porCompra = porCompraDaDemo(p);
  return metricasDaDemo(p).map((m) => linhaDe(matchId, m, porCompra.get(m.steamId)));
}

/** Eventos gravados inteiros, métricas calculadas e gravadas; o mapa da partida ganha o do cabeçalho se ainda não tinha. */
export async function gravarDemo(matchId: string, bruto: unknown): Promise<{ jogadores: number }> {
  const payload: DemoPayload = demoPayload.parse(bruto);
  const jogadores = linhasDosJogadores(matchId, payload);
  const times = linhasDosTimes(matchId, payload);
  await prisma.$transaction([
    prisma.matchDemo.upsert({
      where: { matchId },
      create: { matchId, status: "DONE", versao: payload.versao, parser: payload.parser, ticks: payload.ticks, dados: payload as Prisma.InputJsonValue },
      update: { status: "DONE", error: null, versao: payload.versao, parser: payload.parser, ticks: payload.ticks, dados: payload as Prisma.InputJsonValue },
    }),
    prisma.matchPlayerDemo.deleteMany({ where: { matchId } }),
    prisma.matchPlayerDemo.createMany({ data: jogadores }),
    prisma.matchTeamDemo.deleteMany({ where: { matchId } }),
    prisma.matchTeamDemo.createMany({ data: times }),
    prisma.match.updateMany({ where: { id: matchId, mapa: null, NOT: { demo: null } }, data: { mapa: payload.mapa, servidor: payload.servidor } }),
  ]);
  await registrar("demo.lida", { dados: { matchId, rounds: payload.rounds.length, eventos: payload.eventos.length, jogadores: jogadores.length } });
  return { jogadores: jogadores.length };
}

export async function registrarFalhaDaDemo(matchId: string, motivo: "EXPIRED" | "FAILED", error?: string) {
  const atual = await prisma.matchDemo.findUnique({ where: { matchId }, select: { tentativas: true } });
  const tentativas = (atual?.tentativas ?? 0) + 1;
  const desiste = motivo === "EXPIRED" || tentativas >= MAX_TENTATIVAS;
  await prisma.matchDemo.upsert({
    where: { matchId },
    create: { matchId, status: desiste ? motivo : "PENDING", tentativas, error: error ?? null },
    update: { status: desiste ? motivo : "PENDING", tentativas, error: error ?? null },
  });
}

/** Refaz as métricas de todas as demos gravadas com a regra atual (`npm run recompute:demos`). */
export async function recomputarMetricasDasDemos(): Promise<number> {
  const demos = await prisma.matchDemo.findMany({ where: { status: "DONE", dados: { not: Prisma.JsonNull } }, select: { matchId: true, dados: true } });
  let n = 0;
  for (const d of demos) {
    const parsed = demoPayload.safeParse(d.dados);
    if (!parsed.success) continue;
    await prisma.$transaction([
      prisma.matchPlayerDemo.deleteMany({ where: { matchId: d.matchId } }),
      prisma.matchPlayerDemo.createMany({ data: linhasDosJogadores(d.matchId, parsed.data) }),
      prisma.matchTeamDemo.deleteMany({ where: { matchId: d.matchId } }),
      prisma.matchTeamDemo.createMany({ data: linhasDosTimes(d.matchId, parsed.data) }),
    ]);
    n++;
  }
  return n;
}

/* --------------------------------- leitura -------------------------------- */

export type MetricasDaPartida = Map<string, Prisma.MatchPlayerDemoGetPayload<object>>;
export type ConversaoGravada = Prisma.MatchTeamDemoGetPayload<object>;

/** As métricas dos jogadores de uma partida, por SteamID; vazio quando a demo ainda não foi lida. */
export async function metricasDaPartida(
  matchId: string,
): Promise<{ status: string | null; porJogador: MetricasDaPartida; times: ConversaoGravada[] }> {
  const [demo, linhas, times] = await Promise.all([
    prisma.matchDemo.findUnique({ where: { matchId }, select: { status: true } }),
    prisma.matchPlayerDemo.findMany({ where: { matchId } }),
    prisma.matchTeamDemo.findMany({ where: { matchId } }),
  ]);
  const porJogador: MetricasDaPartida = new Map();
  for (const linha of linhas) porJogador.set(linha.steamId, linha);
  return { status: demo?.status ?? null, porJogador, times };
}

