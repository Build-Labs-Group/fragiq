import { cache } from "react";
import { prisma } from "./prisma";
import { parseStatSchema } from "./stats";
import { metricCatalog, type SnapshotRow } from "./series";
import type { Fonte, PartidaOficial } from "./analista";
import { listarPartidas } from "./partidas";
import { rotularMapa } from "./cs2-labels";
import { lerComVersao, reviverDatas, tagDoJogador, versaoDoJogador } from "./cache-dados";

/**
 * O mesmo balde que a página do jogo carrega, para quem não é a página.
 *
 * O endpoint de dados do analista responde sobre a série de um jogador, e
 * precisa ler exatamente o que a tela lê — mesmo teto de pontos, mesma
 * ordenação, mesma coerção dos contadores. Duas leituras diferentes seriam
 * duas verdades.
 */

/** Teto de pontos, igual ao da página: a análise recalcula tudo em memória. */
export const MAX_SNAPSHOTS = 500;

/**
 * Memoizada por requisição (`cache` do React): o layout do jogo e a página
 * pedem o mesmo balde, e sem isso cada tela lia as 500 coletas duas vezes.
 *
 * E guardada entre requisições pela versão dos dados do jogador
 * (`cache-dados.ts`): enquanto nenhum evento novo chega, trocar de aba não
 * relê as coletas. A versão é lida a cada requisição, então um evento novo
 * aparece na visita seguinte, em qualquer instância.
 */
export const carregarFonte = cache(async (userId: string, appId: number): Promise<Fonte | null> => {
  const versao = await versaoDoJogador(userId);
  return lerComVersao({
    nome: "fonte",
    chave: [userId, appId],
    versao,
    tags: [tagDoJogador(userId)],
    ler: () => montarFonte(userId, appId),
    reviver: (fonte) => {
      if (fonte) for (const r of fonte.rows) reviverDatas(r, ["capturedAt"]);
      return fonte;
    },
  });
});

/** A fonte lida direto do banco, sem o cache do Next: para scripts fora de uma requisição. */
export async function montarFonte(userId: string, appId: number): Promise<Fonte | null> {
  const userGame = await prisma.userGame.findUnique({
    where: { userId_gameAppId: { userId, gameAppId: appId } },
    select: {
      playtimeForeverMin: true,
      game: { select: { name: true, statSchema: true } },
      snapshots: {
        orderBy: { capturedAt: "asc" },
        take: MAX_SNAPSHOTS,
        select: {
          id: true,
          capturedAt: true,
          playtimeForeverMin: true,
          metrics: true,
          matchMap: true,
          matchMode: true,
          matchScore: true,
        },
      },
    },
  });
  if (!userGame) return null;

  const [partidasOficiais, sessoes] = await Promise.all([
    appId === 730 ? partidasOficiaisDe(userId) : Promise.resolve([]),
    // A sessão materializada manda sobre a marca da coleta: é ela que tem
    // a prova. Uma coleta sem sessão (a primeira, ou sem rounds) fica sem
    // modo, como sempre foi.
    prisma.session.findMany({
      where: { userId, gameAppId: appId },
      select: { ateSnapshotId: true, modo: true, modoConfianca: true, mapa: true, placar: true },
    }),
  ]);
  const sessaoDe = new Map(sessoes.map((x) => [x.ateSnapshotId, x]));

  const rows: SnapshotRow[] = userGame.snapshots.map((s) => {
    const sessao = sessaoDe.get(s.id);
    if (!sessao) {
      return { id: s.id, capturedAt: s.capturedAt, playtimeForeverMin: s.playtimeForeverMin, metrics: coerce(s.metrics), matchMap: null, matchMode: null, matchScore: null, modoConfianca: null };
    }
    const provado = sessao.modoConfianca !== "MISTA";
    return {
      id: s.id,
      capturedAt: s.capturedAt,
      playtimeForeverMin: s.playtimeForeverMin,
      metrics: coerce(s.metrics),
      matchMap: sessao.mapa,
      matchMode: provado ? sessao.modo : null,
      matchScore: sessao.placar,
      modoConfianca: sessao.modoConfianca,
    };
  });

  return {
    appId,
    gameName: userGame.game.name,
    playtimeForeverMin: userGame.playtimeForeverMin,
    rows,
    catalog: metricCatalog(rows, parseStatSchema(userGame.game.statSchema)),
    partidasOficiais,
  };
}

async function partidasOficiaisDe(userId: string): Promise<PartidaOficial[]> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { steamId: true } });
  if (!user) return [];
  const linhas = await listarPartidas(user.steamId, 30);
  return linhas.map((p) => ({
    jogadaEm: p.jogadaEm.toISOString(),
    mapa: p.mapa ? rotularMapa(p.mapa) : null,
    placar: `${p.placar[0]}-${p.placar[1]}`,
    resultado: p.eu.venceu === null ? "empate" : p.eu.venceu ? "vitória" : "derrota",
    duracaoMin: Math.round(p.duracaoS / 60),
    kills: p.eu.kills,
    assists: p.eu.assists,
    deaths: p.eu.deaths,
    kd: Number((p.eu.deaths ? p.eu.kills / p.eu.deaths : p.eu.kills).toFixed(2)),
    hsPct: Number((p.eu.kills ? (p.eu.hs / p.eu.kills) * 100 : 0).toFixed(0)),
    mvps: p.eu.mvps,
    score: p.eu.score,
  }));
}

export function coerce(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    }
  }
  return out;
}
