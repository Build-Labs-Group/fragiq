/**
 * Partidas oficiais fictícias para o usuário do `npm run seed`, para avaliar
 * a aba Partidas e a página da partida sem o bot nem o Game Coordinator.
 *
 *   npm run seed && npm run seed:partidas
 *
 * Passa pelo mesmo caminho do bot: a partida nasce PENDING com um share
 * code, o scoreboard entra por `gravarPartidaDoGC` e a demo da mais recente
 * por `gravarDemo` — a partida real de Ancient dos testes, com o jogador de
 * demonstração no lugar do primeiro da escalação e uma amostra de economia
 * (payload v2), para a linha "eco 1 de 3 · cheia 5 de 8" aparecer.
 */

import "dotenv/config";
import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/prisma";
import { gravarPartidaDoGC } from "../src/lib/partidas";
import { gravarDemo } from "../src/lib/demos";
import { ladosPorRound } from "../src/lib/demo/metricas";
import type { DemoPayload } from "../src/lib/demo/payload";
/** O mesmo de `scripts/seed.ts` (importar de lá rodaria o seed inteiro). */
const DEMO_STEAM_ID = "76561197960287930";

const BASE = 76561197960265728n;
const conta = (steamId: string) => Number(BigInt(steamId) - BASE);

const MAPAS = ["de_ancient", "de_mirage", "de_inferno", "de_nuke", "de_dust2", "de_anubis", "de_train", "de_overpass"];
/** 8 = competitivo no bitmask do GC; o modo Premier vem da presença, que aqui não existe. */
const GAME_TYPE_COMPETITIVO = 8;

function aleatorio(semente: number) {
  let s = semente;
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32;
    return s / 2 ** 32;
  };
}

async function main() {
  const user = await prisma.user.findUnique({ where: { steamId: DEMO_STEAM_ID }, select: { id: true } });
  if (!user) throw new Error("Rode `npm run seed` primeiro.");

  const ancient: DemoPayload = JSON.parse(readFileSync(new URL("../tests/fixtures/demo-ancient.json", import.meta.url), "utf8"));
  const original = ancient.jogadores[0].steamId;
  const payload = JSON.parse(JSON.stringify(ancient).replaceAll(original, DEMO_STEAM_ID)) as DemoPayload;
  const lados = ladosPorRound(payload);
  const comEconomia: DemoPayload = {
    ...payload,
    versao: 2,
    rounds: payload.rounds.map((r) => ({
      ...r,
      economia: [...(lados.get(r.n) ?? [])].map(([steamId, lado]) => ({
        steamId,
        lado,
        saldo: 0,
        equipamento: r.n === 1 ? 800 : r.n % 4 === 0 ? 1500 : 4400,
      })),
    })),
  };
  const escalacao = payload.jogadores.map((j) => j.steamId);

  const rnd = aleatorio(42);
  let criadas = 0;
  for (let i = 0; i < 12; i++) {
    const matchId = `90000000000000${String(i).padStart(4, "0")}`;
    const shareCode = `CSGO-SEED${String(i).padStart(1, "0")}-AAAAA-BBBBB-CCCCC-DDDDD`;
    await prisma.match.upsert({
      where: { id: matchId },
      update: { status: "PENDING" },
      create: { id: matchId, shareCode, status: "PENDING", descobertaPorId: user.id },
    });

    const venceu = rnd() > 0.45;
    const perdedor = 5 + Math.floor(rnd() * 8);
    const placar: [number, number] = venceu ? [13, perdedor] : [perdedor, 13];
    const rounds = placar[0] + placar[1];
    const linha = () => {
      const kills = Math.round(rounds * (0.45 + rnd() * 0.5));
      return { kills, deaths: Math.round(rounds * (0.5 + rnd() * 0.35)), assists: Math.round(rnd() * 8), hs: Math.round(kills * (0.3 + rnd() * 0.3)), mvps: Math.round(rnd() * 5) };
    };
    const linhas = escalacao.map(linha);
    const matchtime = Math.floor(Date.now() / 1000) - (i * 2 + 1) * 86_400 + Math.floor(rnd() * 3600);
    await gravarPartidaDoGC(shareCode, {
      matchId,
      matchtime,
      duracaoS: rounds * 110,
      rounds,
      gameType: GAME_TYPE_COMPETITIVO,
      demoUrl: null,
      mapa: i === 0 ? "de_ancient" : MAPAS[i % MAPAS.length],
      servidor: "Valve Counter-Strike 2 south_america Server (seed)",
      contas: escalacao.map(conta),
      kills: linhas.map((l) => l.kills),
      assists: linhas.map((l) => l.assists),
      deaths: linhas.map((l) => l.deaths),
      mvps: linhas.map((l) => l.mvps),
      scores: linhas.map((l) => l.kills * 2 + l.assists),
      hs: linhas.map((l) => l.hs),
      pings: escalacao.map(() => 20 + Math.round(rnd() * 40)),
      placar,
    });
    if (i === 0) await gravarDemo(matchId, comEconomia);
    criadas++;
  }
  console.log(`Seed de partidas pronto: ${criadas} partidas para demo_player (1 com demo).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
