import { cache } from "react";
import { prisma } from "./prisma";
import { lerComVersao } from "./cache-dados";

/**
 * O CS2 que o FragIQ vê: o agregado público de todas as partidas gravadas.
 *
 * Cada partida oficial traz o placar dos **dez** jogadores (o mesmo que o
 * "Suas partidas" do jogo mostra a qualquer um deles) e, quando a demo foi
 * lida, os rounds um a um. Somado, isso é uma amostra do CS2 brasileiro que
 * nenhum dos jogadores tem sozinho: como cada mapa termina, quanto vale o
 * pistol, onde está um K/D de 1,20 na fila.
 *
 * Privacidade, em duas regras:
 *
 * - **agregado não identifica ninguém** — distribuições, médias e contagens
 *   sobre todos os jogadores vistos, sem nome nem SteamID;
 * - **ranking com nome só de conta do FragIQ com perfil público** (a chave
 *   `perfilPublico` que a pessoa controla em Configurações).
 *
 * Tudo é lido de uma vez e guardado pela versão das partidas (contagem e
 * instante mais recente de partidas, demos e cadastros): uma partida nova
 * muda a versão, e nenhuma tela mostra um agregado velho.
 */

/** Mínimo de partidas para entrar no ranking com nome: abaixo disso o K/D é ruído. */
export const MIN_PARTIDAS_RANKING = 5;
/** Mínimo de rounds para um jogador entrar nas distribuições. */
export const MIN_ROUNDS_DISTRIBUICAO = 10;
/** O corte das distribuições, dito no recorte de cada gráfico. */
export const NOTA_DISTRIBUICAO = `Jogadores com pelo menos ${MIN_ROUNDS_DISTRIBUICAO} rounds em partida oficial gravada`;

export type Panorama = {
  totais: { partidas: number; jogadores: number; rounds: number; contas: number; demos: number; desde: string | null };
  mapas: { mapa: string; partidas: number; roundsMedios: number; prorrogacoes: number; placarMedioPerdedor: number }[];
  /** K/D de cada jogador visto (soma das kills ÷ soma das mortes, em todas as partidas dele). */
  kd: number[];
  /** Headshot (%) de cada jogador visto. */
  hs: number[];
  /** Partidas por dia da semana (0 = domingo) e hora, no horário de Brasília. */
  grade: number[][];
  /** Rounds por tipo de compra, das demos: quantas vezes e quantas o time ganhou. */
  economia: { tipo: "pistol" | "eco" | "meia" | "cheia"; rounds: number; ganhos: number }[];
  ranking: { steamId: string; nome: string; avatar: string | null; partidas: number; kd: number; hs: number; vitorias: number }[];
};

type LinhaTotais = { partidas: number; jogadores: number; rounds: number; contas: number; demos: number; desde: Date | null };
type LinhaMapa = { mapa: string; partidas: number; rounds_medios: number; prorrogacoes: number; perdedor: number };
type LinhaJogador = { kills: number; deaths: number; hs: number };
type LinhaGrade = { dow: number; hora: number; n: number };
type LinhaEconomia = { pistol: number; pistol_g: number; eco: number; eco_g: number; meia: number; meia_g: number; cheia: number; cheia_g: number };
type LinhaRanking = { steamId: string; nome: string; avatar: string | null; partidas: number; kills: number; deaths: number; hs: number; vitorias: number };

export const versaoDaComunidade = cache(async (): Promise<string> => {
  const [l] = await prisma.$queryRaw<{ versao: string }[]>`
    SELECT concat_ws('|',
      (SELECT count(*) || ':' || coalesce(extract(epoch FROM max("updatedAt"))::text, '') FROM matches WHERE status = 'DONE'),
      (SELECT count(*) || ':' || coalesce(extract(epoch FROM max("updatedAt"))::text, '') FROM match_demos),
      (SELECT count(*) || ':' || coalesce(extract(epoch FROM max("updatedAt"))::text, '') FROM users)
    ) AS versao`;
  return l?.versao ?? "vazio";
});

export const carregarPanorama = cache(async (): Promise<Panorama> => {
  const versao = await versaoDaComunidade();
  return lerComVersao({ nome: "panorama", chave: [], versao, ler: montarPanorama });
});

async function montarPanorama(): Promise<Panorama> {
  const [totais, mapas, jogadores, grade, economia, ranking] = await Promise.all([
    prisma.$queryRaw<LinhaTotais[]>`
      SELECT
        (SELECT count(*)::int FROM matches WHERE status = 'DONE') AS partidas,
        (SELECT count(DISTINCT mp."steamId")::int FROM match_players mp JOIN matches m ON m.id = mp."matchId" WHERE m.status = 'DONE') AS jogadores,
        (SELECT coalesce(sum(rounds), 0)::int FROM matches WHERE status = 'DONE') AS rounds,
        (SELECT count(*)::int FROM users) AS contas,
        (SELECT count(*)::int FROM match_demos WHERE status = 'DONE') AS demos,
        (SELECT min("jogadaEm") FROM matches WHERE status = 'DONE') AS desde`,
    // Prorrogação: placar do vencedor acima de 13 (MR12). Perdedor médio diz o quão disputado o mapa é.
    prisma.$queryRaw<LinhaMapa[]>`
      SELECT mapa,
             count(*)::int AS partidas,
             round(avg(rounds)::numeric, 1)::float AS rounds_medios,
             count(*) FILTER (WHERE greatest("placarA", "placarB") > 13)::int AS prorrogacoes,
             round(avg(least("placarA", "placarB"))::numeric, 1)::float AS perdedor
        FROM matches
       WHERE status = 'DONE' AND mapa IS NOT NULL AND "placarA" IS NOT NULL
       GROUP BY mapa
       ORDER BY count(*) DESC`,
    prisma.$queryRaw<LinhaJogador[]>`
      SELECT sum(mp.kills)::int AS kills, sum(mp.deaths)::int AS deaths, sum(mp.hs)::int AS hs
        FROM match_players mp JOIN matches m ON m.id = mp."matchId"
       WHERE m.status = 'DONE'
       GROUP BY mp."steamId"
      HAVING sum(coalesce(m.rounds, 0)) >= ${MIN_ROUNDS_DISTRIBUICAO}`,
    prisma.$queryRaw<LinhaGrade[]>`
      SELECT extract(dow FROM ("jogadaEm" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::int AS dow,
             extract(hour FROM ("jogadaEm" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo')::int AS hora,
             count(*)::int AS n
        FROM matches
       WHERE status = 'DONE' AND "jogadaEm" IS NOT NULL
       GROUP BY 1, 2`,
    prisma.$queryRaw<LinhaEconomia[]>`
      SELECT coalesce(sum(pistol), 0)::int AS pistol, coalesce(sum("pistolGanhos"), 0)::int AS pistol_g,
             coalesce(sum(eco), 0)::int AS eco, coalesce(sum("ecoGanhos"), 0)::int AS eco_g,
             coalesce(sum(meia), 0)::int AS meia, coalesce(sum("meiaGanhas"), 0)::int AS meia_g,
             coalesce(sum(cheia), 0)::int AS cheia, coalesce(sum("cheiaGanhas"), 0)::int AS cheia_g
        FROM match_team_demos`,
    prisma.$queryRaw<LinhaRanking[]>`
      SELECT u."steamId", u."personaName" AS nome, u."avatarUrl" AS avatar,
             count(*)::int AS partidas, sum(mp.kills)::int AS kills, sum(mp.deaths)::int AS deaths,
             sum(mp.hs)::int AS hs, count(*) FILTER (WHERE mp.venceu)::int AS vitorias
        FROM users u
        JOIN match_players mp ON mp."steamId" = u."steamId"
        JOIN matches m ON m.id = mp."matchId" AND m.status = 'DONE'
       WHERE u."perfilPublico"
       GROUP BY u."steamId", u."personaName", u."avatarUrl"
      HAVING count(*) >= ${MIN_PARTIDAS_RANKING}`,
  ]);

  const t = totais[0];
  const matriz = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  for (const g of grade) matriz[g.dow][g.hora] = g.n;
  const e = economia[0];

  return {
    totais: { partidas: t?.partidas ?? 0, jogadores: t?.jogadores ?? 0, rounds: t?.rounds ?? 0, contas: t?.contas ?? 0, demos: t?.demos ?? 0, desde: t?.desde ? t.desde.toISOString() : null },
    mapas: mapas.map((m) => ({ mapa: m.mapa, partidas: m.partidas, roundsMedios: m.rounds_medios, prorrogacoes: m.prorrogacoes, placarMedioPerdedor: m.perdedor })),
    kd: jogadores.filter((j) => j.deaths > 0).map((j) => j.kills / j.deaths).sort((a, b) => a - b),
    hs: jogadores.filter((j) => j.kills > 0).map((j) => (j.hs / j.kills) * 100).sort((a, b) => a - b),
    grade: matriz,
    economia: e
      ? [
          { tipo: "pistol", rounds: e.pistol, ganhos: e.pistol_g },
          { tipo: "eco", rounds: e.eco, ganhos: e.eco_g },
          { tipo: "meia", rounds: e.meia, ganhos: e.meia_g },
          { tipo: "cheia", rounds: e.cheia, ganhos: e.cheia_g },
        ]
      : [],
    ranking: ranking
      .filter((r) => r.deaths > 0)
      .map((r) => ({ steamId: r.steamId, nome: r.nome, avatar: r.avatar, partidas: r.partidas, kd: r.kills / r.deaths, hs: r.kills ? (r.hs / r.kills) * 100 : 0, vitorias: (r.vitorias / r.partidas) * 100 }))
      .sort((a, b) => b.kd - a.kd),
  };
}
