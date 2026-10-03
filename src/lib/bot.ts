import { getPlayerSummary, type SteamPlayer } from "./steam/api";
import { getFriendIds } from "./steam/api";
import { prisma } from "./prisma";

/**
 * O bot de presença, visto do site.
 *
 * É uma conta comum da Steam que, sendo sua amiga, enxerga o rich presence
 * do CS2 — mapa, modo e placar — e avisa o site no fim de cada partida. A
 * foto e o nome vêm da Steam ao vivo, para a pessoa conferir que é a mesma
 * conta que está adicionando.
 */
export const BOT_STEAM_ID = process.env.BOT_STEAM_ID ?? "76561198647798293";

const CACHE_MS = 10 * 60_000;
let cache: { em: number; perfil: SteamPlayer | null } | null = null;
const amizade = new Map<string, { em: number; amigo: boolean | null }>();

export async function perfilDoBot(): Promise<SteamPlayer | null> {
  if (cache && Date.now() - cache.em < CACHE_MS) return cache.perfil;
  const perfil = await getPlayerSummary(BOT_STEAM_ID).catch(() => null);
  cache = { em: Date.now(), perfil };
  return perfil;
}

/**
 * A pessoa já é amiga do bot? Null quando não dá para saber.
 *
 * Primeiro a lista do próprio bot, que ele sincroniza com o site
 * (`bot_amigos`): ela vale mesmo quando a lista de amigos da pessoa é
 * privada, que é o caso em que a Web API não diz nada e o onboarding
 * mostrava "?" para quem já tinha adicionado. A Web API fica para o
 * intervalo entre a pessoa adicionar e o bot sincronizar.
 *
 * O cache guarda a resposta inteira — antes guardava `false` para lista
 * privada, e a segunda visita dizia "não é amigo" em vez de "não sei".
 */
export async function botEhAmigo(steamId: string): Promise<boolean | null> {
  const doBot = await prisma.botAmigo.findUnique({ where: { steamId }, select: { saiuEm: true } }).catch(() => null);
  if (doBot && !doBot.saiuEm) return true;
  const hit = amizade.get(steamId);
  if (hit && Date.now() - hit.em < CACHE_MS) return hit.amigo;
  const ids: string[] = await getFriendIds(steamId).catch(() => []);
  const amigo = ids.length === 0 ? null : ids.includes(BOT_STEAM_ID);
  amizade.set(steamId, { em: Date.now(), amigo });
  return amigo;
}
