import { prisma } from "./prisma";
import { CogniflowApiError } from "./cogniflow-api";
import { registrar } from "./eventos";
import { getPlayerSummary, getUserStatsForGame, resolveVanityUrl, type SteamPlayer } from "./steam/api";
import { armasNasMetricas, rotularArma, rotularMapa } from "./cs2-labels";

/**
 * A página pública de um jogador: o que a Steam já mostra a qualquer um.
 *
 * Números vitalícios, por arma e por mapa, lidos ao vivo da Web API — os
 * mesmos que csstats e Leetify exibem para quem tem o SteamID. Nada de
 * curva, leitura ou analista: isso é do dono, atrás do login. A privacidade
 * é a da Steam ("Detalhes do jogo" público) mais o botão de esconder do
 * próprio FragIQ.
 *
 * As leituras da Steam ficam em cache por dez minutos por SteamID, para uma
 * página compartilhada num grupo não virar rajada contra a chave.
 */

const CS2 = 730;
const CACHE_MS = 10 * 60_000;

export type PerfilPublico =
  | { estado: "oculto" }
  | { estado: "inexistente" }
  /** A Steam (via cogniflow) não respondeu e não há dado guardado desta pessoa. Passageiro. */
  | { estado: "indisponivel" }
  | { estado: "privado"; jogador: SteamPlayer }
  | { estado: "sem-cs2"; jogador: SteamPlayer }
  | {
      estado: "ok";
      jogador: SteamPlayer;
      usuarioDoFragiq: { desde: Date; coletas: number } | null;
      horas: number;
      resumo: { rotulo: string; valor: string }[];
      /** `id` é o nome da Valve (`ak47`, `de_nuke`), que acha o ícone; o outro campo é o rótulo. */
      armas: { id: string; arma: string; kills: number; tiros: number; acertos: number; precisao: number | null }[];
      mapas: { id: string; mapa: string; rounds: number; vitorias: number; taxa: number | null }[];
      /** Presente só quando a leitura ao vivo falhou: os números são os da última coleta, feita nesta hora. */
      atualizadoEm?: Date;
    };

const cache = new Map<string, { expira: number; valor: PerfilPublico }>();

export function pareceSteamId(v: string) {
  return /^7656119\d{10}$/.test(v);
}

/**
 * O que a pessoa colou: SteamID64, link /profiles/<id>, link /id/<apelido>
 * ou só o apelido. Devolve o SteamID64 ou null.
 */
export async function resolverEntrada(entrada: string): Promise<string | null> {
  const v = entrada.trim();
  if (!v) return null;
  if (pareceSteamId(v)) return v;
  const m = v.match(/steamcommunity\.com\/(profiles|id)\/([^/?#\s]+)/i);
  if (m?.[1] === "profiles") return pareceSteamId(m[2]) ? m[2] : null;
  const vanity = m ? m[2] : v;
  if (!/^[A-Za-z0-9_-]{2,32}$/.test(vanity)) return null;
  return resolveVanityUrl(vanity);
}

export async function carregarPerfilPublico(steamId: string): Promise<PerfilPublico> {
  const hit = cache.get(steamId);
  if (hit && Date.now() < hit.expira) return hit.valor;

  const valor = await montar(steamId);
  const degradado = valor.estado === "indisponivel" || (valor.estado === "ok" && valor.atualizadoEm !== undefined);
  cache.set(steamId, { expira: Date.now() + (degradado ? CACHE_ATRASADO_MS : CACHE_MS), valor });
  return valor;
}

const TIMEOUT_LEITURA_MS = 6_000;
const ESPERA_RETENTATIVA_MS = 300;
/** Quanto uma resposta degradada fica em cache: pouco, para a próxima visita já tentar de novo. */
const CACHE_ATRASADO_MS = 30_000;

type Guardado = {
  jogador: SteamPlayer;
  metrics: Record<string, number>;
  capturadoEm: Date;
};

/**
 * Uma leitura ao cogniflow com uma nova tentativa curta, só para o que vale
 * repetir (503, 429, timeout, rede). Recusa permanente sobe de primeira.
 */
async function lerComRetentativa<T>(ler: () => Promise<T>): Promise<T> {
  try {
    return await ler();
  } catch (err) {
    if (err instanceof CogniflowApiError && err.permanente) throw err;
    await new Promise((r) => setTimeout(r, ESPERA_RETENTATIVA_MS));
    return ler();
  }
}

/** Nível warn, e uma linha no diário para contar quantas vezes a tela serviu dado guardado. */
async function avisarAtraso(
  steamId: string,
  capability: string,
  err: unknown,
  guardado: boolean,
) {
  const mensagem = err instanceof Error ? err.message : String(err);
  console.warn(
    `[perfil.publico] leitura atrasada (${capability}), ${guardado ? "mostrando o último dado guardado" : "sem dado guardado"}:`,
    mensagem,
  );
  await registrar("perfil.leitura_atrasada", {
    dados: {
      capability,
      steamId,
      comDadoGuardado: guardado,
      mensagem: mensagem.slice(0, 300),
    },
  });
}

/** O último dado que o FragIQ já coletou desta pessoa, ou null se ela nunca entrou. */
async function lerGuardado(steamId: string): Promise<Guardado | null> {
  const u = await prisma.user.findUnique({
    where: { steamId },
    select: {
      personaName: true,
      avatarUrl: true,
      profileUrl: true,
      countryCode: true,
      games: {
        where: { gameAppId: CS2 },
        select: {
          snapshots: {
            orderBy: { capturedAt: "desc" },
            take: 1,
            select: { metrics: true, capturedAt: true },
          },
        },
      },
    },
  });
  const ultimo = u?.games[0]?.snapshots[0];
  if (!u || !ultimo) return null;
  return {
    // Se há snapshot, as estatísticas eram legíveis na última coleta: o perfil era público.
    jogador: {
      steamid: steamId,
      personaname: u.personaName,
      avatarfull: u.avatarUrl ?? undefined,
      profileurl: u.profileUrl ?? undefined,
      loccountrycode: u.countryCode ?? undefined,
      communityvisibilitystate: 3,
    },
    metrics: ultimo.metrics as Record<string, number>,
    capturadoEm: ultimo.capturedAt,
  };
}

async function montar(steamId: string): Promise<PerfilPublico> {
  const usuario = await prisma.user.findUnique({
    where: { steamId },
    select: {
      perfilPublico: true,
      createdAt: true,
      games: {
        where: { gameAppId: CS2 },
        select: { _count: { select: { snapshots: true } } },
      },
    },
  });
  if (usuario && !usuario.perfilPublico) return { estado: "oculto" };
  const usuarioDoFragiq = usuario
    ? {
        desde: usuario.createdAt,
        coletas: usuario.games[0]?._count.snapshots ?? 0,
      }
    : null;

  let jogador: SteamPlayer | null;
  try {
    jogador = await lerComRetentativa(() =>
      getPlayerSummary(steamId, { timeoutMs: TIMEOUT_LEITURA_MS }),
    );
  } catch (err) {
    // Cogniflow fora, timeout ou recusa: a tela não cai. Mostra o último
    // dado que já guardamos, com a hora dele, ou diz que não deu para ler.
    const guardado = await lerGuardado(steamId);
    await avisarAtraso(steamId, "steam.player.read", err, guardado !== null);
    if (!guardado) return { estado: "indisponivel" };
    return {
      ...corpo(guardado.jogador, guardado.metrics, usuarioDoFragiq),
      atualizadoEm: guardado.capturadoEm,
    };
  }
  if (!jogador) return { estado: "inexistente" };
  if (jogador.communityvisibilitystate !== 3)
    return { estado: "privado", jogador };

  let stats: Awaited<ReturnType<typeof getUserStatsForGame>>;
  try {
    stats = await lerComRetentativa(() =>
      getUserStatsForGame(steamId, CS2, { timeoutMs: TIMEOUT_LEITURA_MS }),
    );
  } catch (err) {
    const guardado = await lerGuardado(steamId);
    await avisarAtraso(steamId, "steam.stats.read", err, guardado !== null);
    if (!guardado) return { estado: "indisponivel" };
    return {
      ...corpo(jogador, guardado.metrics, usuarioDoFragiq),
      atualizadoEm: guardado.capturadoEm,
    };
  }
  if (!stats) return { estado: "sem-cs2", jogador };
  return corpo(jogador, stats.metrics, usuarioDoFragiq);
}

type Ok = Extract<PerfilPublico, { estado: "ok" }>;

/** Os números da página a partir das métricas (ao vivo ou guardadas): a mesma conta nos dois casos. */
function corpo(
  jogador: SteamPlayer,
  m: Record<string, number>,
  usuarioDoFragiq: Ok["usuarioDoFragiq"],
): Ok {
  const razao = (a: string, b: string, escala = 1) =>
    m[b] ? ((m[a] ?? 0) / m[b]) * escala : null;
  const fmt = (v: number | null, casas: number, sufixo = "") =>
    v === null
      ? "—"
      : v.toLocaleString("pt-BR", {
          minimumFractionDigits: casas,
          maximumFractionDigits: casas,
        }) + sufixo;

  const armas = armasNasMetricas(m)
    .map((arma) => {
      const tiros = m[`total_shots_${arma}`] ?? 0;
      const acertos = m[`total_hits_${arma}`] ?? 0;
      return {
        id: arma,
        arma: rotularArma(arma),
        kills: m[`total_kills_${arma}`] ?? 0,
        tiros,
        acertos,
        precisao: tiros ? (acertos / tiros) * 100 : null,
      };
    })
    .filter((a) => a.tiros > 0)
    .sort((a, b) => b.kills - a.kills);

  const mapas = Object.keys(m)
    .filter((k) => k.startsWith("total_rounds_map_"))
    .map((k) => {
      const mapa = k.replace("total_rounds_map_", "");
      const rounds = m[k] ?? 0;
      const vitorias = m[`total_wins_map_${mapa}`] ?? 0;
      return { id: mapa, mapa: rotularMapa(mapa), rounds, vitorias, taxa: rounds ? (vitorias / rounds) * 100 : null };
    })
    .filter((x) => x.rounds > 0)
    .sort((a, b) => b.rounds - a.rounds);

  return {
    estado: "ok",
    jogador,
    usuarioDoFragiq,
    horas: Math.round((m.total_time_played ?? 0) / 3600),
    resumo: [
      { rotulo: "K/D", valor: fmt(razao("total_kills", "total_deaths"), 2) },
      { rotulo: "Headshot", valor: fmt(razao("total_kills_headshot", "total_kills", 100), 1, "%") },
      { rotulo: "Vitórias", valor: fmt(razao("total_matches_won", "total_matches_played", 100), 1, "%") },
      { rotulo: "Dano / round", valor: fmt(razao("total_damage_done", "total_rounds_played"), 0) },
      { rotulo: "MVP / partida", valor: fmt(razao("total_mvps", "total_matches_played"), 2) },
      { rotulo: "Kills", valor: fmt(m.total_kills ?? null, 0) },
      { rotulo: "Rounds", valor: fmt(m.total_rounds_played ?? null, 0) },
      { rotulo: "Partidas", valor: fmt(m.total_matches_played ?? null, 0) },
    ],
    armas,
    mapas,
  };
}
