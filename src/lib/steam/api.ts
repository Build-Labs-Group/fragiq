import { CogniflowApiError, invocar } from "../cogniflow-api";
import { registrar } from "../eventos";

/**
 * A Steam, vista daqui, é um conjunto de capabilities do cogniflow.
 *
 * Este módulo já falou com api.steampowered.com diretamente. Hoje quem fala
 * é o cogniflow — a chave e a cota são da plataforma, e o mesmo `steam.*`
 * que o cron chama aqui é a tool que o analista tem no turno. O que sobrou
 * deste lado é o vocabulário que o resto do site usa: os tipos e as funções
 * mantêm a forma de sempre, e a tradução para os nomes estáveis da
 * capability (`name` em vez de `personaname`) acontece só aqui.
 */

export class SteamApiError extends Error {
  constructor(
    readonly endpoint: string,
    readonly status: number,
  ) {
    super(`Steam API ${endpoint} respondeu ${status}`);
    this.name = "SteamApiError";
  }
}

/**
 * Uma recusa da Steam vira `SteamApiError` com o status da própria Steam,
 * como sempre foi (403 = chave; quem chama decide se é fatal). Qualquer
 * outra falha — cogniflow fora, grant faltando, payload recusado — sobe
 * como está: não é a Steam dizendo não, é a nossa integração quebrada.
 *
 * Toda recusa deixa uma linha `steam.recusa` no diário com os dois
 * status, inclusive as que quem chama engole (schema, preço). Toda a
 * coleta sai de IPs compartilhados da Vercel, e um 429 da Steam bem antes
 * da cota diária é plausível; sem o registro ele seria só "o sync falhou".
 */
async function capability<T>(id: string, input: Record<string, unknown>, opcoes: { timeoutMs?: number } = {}): Promise<T> {
  try {
    return await invocar<T>(id, input, opcoes);
  } catch (err) {
    if (err instanceof CogniflowApiError) {
      await registrar("steam.recusa", {
        dados: { capability: id, status: err.status, providerStatus: err.providerStatus },
      });
      if (err.providerStatus !== null) throw new SteamApiError(id, err.providerStatus);
    }
    throw err;
  }
}

/* ---------------------------------- perfil --------------------------------- */

export type SteamPlayer = {
  steamid: string;
  personaname: string;
  avatarfull?: string;
  profileurl?: string;
  loccountrycode?: string;
  /** 3 = público. Menos que isso e a biblioteca/stats vêm vazias. */
  communityvisibilitystate?: number;
};

type Jogador = {
  steam_id: string;
  name: string | null;
  avatar_url: string | null;
  profile_url: string | null;
  country: string | null;
  public: boolean;
};

function jogador(p: Jogador): SteamPlayer {
  return {
    steamid: p.steam_id,
    personaname: p.name ?? "",
    avatarfull: p.avatar_url ?? undefined,
    profileurl: p.profile_url ?? undefined,
    loccountrycode: p.country ?? undefined,
    communityvisibilitystate: p.public ? 3 : 1,
  };
}

/** `timeoutMs` encurta a espera de quem monta uma tela e tem o que mostrar se a leitura falhar. */
export async function getPlayerSummary(steamId: string, opcoes: { timeoutMs?: number } = {}): Promise<SteamPlayer | null> {
  const { players } = await capability<{ players: Jogador[] }>("steam.player.read", { steam_ids: [steamId] }, opcoes);
  return players[0] ? jogador(players[0]) : null;
}

/** Até 100 por chamada; a Steam devolve só os que existem, em qualquer ordem. */
export async function getPlayerSummaries(steamIds: string[]): Promise<Map<string, SteamPlayer>> {
  const saida = new Map<string, SteamPlayer>();
  for (let i = 0; i < steamIds.length; i += 100) {
    const { players } = await capability<{ players: Jogador[] }>("steam.player.read", {
      steam_ids: steamIds.slice(i, i + 100),
    });
    for (const p of players) saida.set(p.steam_id, jogador(p));
  }
  return saida;
}

/* -------------------------------- biblioteca ------------------------------- */

export type OwnedGame = {
  appid: number;
  name?: string;
  playtime_forever: number;
  playtime_2weeks: number;
  img_icon_url?: string;
  rtime_last_played?: number;
};

type Jogo = {
  app_id: number;
  name: string | null;
  playtime_forever_minutes: number;
  playtime_2weeks_minutes: number;
  icon_hash: string | null;
  last_played_at: number | null;
};

export async function getOwnedGames(steamId: string): Promise<OwnedGame[]> {
  const { games } = await capability<{ games: Jogo[] }>("steam.library.read", { steam_id: steamId });
  return games.map((g) => ({
    appid: g.app_id,
    name: g.name ?? undefined,
    playtime_forever: g.playtime_forever_minutes ?? 0,
    playtime_2weeks: g.playtime_2weeks_minutes ?? 0,
    img_icon_url: g.icon_hash ?? undefined,
    rtime_last_played: g.last_played_at ?? undefined,
  }));
}

/* --------------------------- estatísticas por jogo -------------------------- */

export type GameStats = {
  metrics: Record<string, number>;
  achievementsUnlocked: number | null;
  achievementsTotal: number | null;
};

/**
 * Retorna null (em vez de lançar) quando o jogo simplesmente não expõe stats
 * ou o perfil está privado — o cogniflow já traduz o 400 da Steam para
 * `stats: null`, e um sync de centenas de jogos não pode morrer por isso.
 */
export async function getUserStatsForGame(
  steamId: string,
  appId: number,
  opcoes: { timeoutMs?: number } = {},
): Promise<GameStats | null> {
  const { stats } = await capability<{
    stats: { metrics: Record<string, number>; achievements_unlocked: number | null; achievements_total: number | null } | null;
  }>("steam.stats.read", { steam_id: steamId, app_id: appId }, opcoes);
  if (!stats) return null;
  return {
    metrics: stats.metrics,
    achievementsUnlocked: stats.achievements_unlocked,
    achievementsTotal: stats.achievements_total,
  };
}

/** Nomes legíveis das stats de um jogo. Igual para todo mundo — cacheamos. */
export async function getGameStatSchema(appId: number): Promise<Record<string, string> | null> {
  try {
    const { schema } = await capability<{ schema: Record<string, string> | null }>("steam.stats.schema.read", {
      app_id: appId,
    });
    return schema;
  } catch {
    return null;
  }
}

export function gameIconUrl(appId: number, iconHash: string | null) {
  if (!iconHash) return null;
  return `https://media.steampowered.com/steamcommunity/public/images/apps/${appId}/${iconHash}.jpg`;
}

export function gameHeaderUrl(appId: number) {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`;
}

/* ------------------------------- vanity URL -------------------------------- */

/**
 * steamcommunity.com/id/<apelido> → SteamID64. Null quando o apelido não
 * existe. É a única forma de aceitar o link do perfil como as pessoas o
 * copiam da barra de endereço.
 */
export async function resolveVanityUrl(vanity: string): Promise<string | null> {
  const { steam_id } = await capability<{ steam_id: string | null }>("steam.vanity.resolve", { vanity });
  return steam_id;
}

/* --------------------------------- amigos ---------------------------------- */

/**
 * SteamIDs dos amigos. Lista vazia quando a lista de amigos é privada — o
 * cogniflow já traduz o 401 da Steam, e "sem amigos visíveis" não é erro.
 */
export async function getFriendIds(steamId: string): Promise<string[]> {
  const { steam_ids } = await capability<{ steam_ids: string[] }>("steam.friends.read", { steam_id: steamId });
  return steam_ids;
}

export type InventoryItemRead = {
  asset_id: string;
  class_id: string;
  amount: number;
  name: string | null;
  market_hash_name: string | null;
  type: string | null;
  image: string | null;
  rarity: string | null;
  rarity_key: string | null;
  rarity_color: string | null;
  exterior: string | null;
  exterior_key: string | null;
  weapon: string | null;
  category: string | null;
  stattrak: boolean;
  souvenir: boolean;
  tradable: boolean;
  marketable: boolean;
};

/** O inventário público de CS2; `public: false` é escolha da pessoa, não erro. */
export async function getInventory(steamId: string): Promise<{ public: boolean; total: number; items: InventoryItemRead[] }> {
  return capability("steam.inventory.read", { steam_id: steamId, app_id: 730 });
}

export type MarketPrice = { listed: boolean; lowest_cents: number | null; median_cents: number | null; volume: number | null; currency: number };

/** O preço de um item no Mercado da Comunidade, em BRL (moeda 7). */
export async function getMarketPrice(marketHashName: string): Promise<MarketPrice> {
  return capability("steam.market.price", { market_hash_name: marketHashName, app_id: 730, currency: 7 });
}
