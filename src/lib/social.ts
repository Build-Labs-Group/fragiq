import { prisma } from "./prisma";
import { reportarErro } from "./eventos";
import { getFriendIds } from "./steam/api";

/**
 * A parte social: amigos da Steam que já estão aqui, e quem segue quem.
 *
 * Seguir é unilateral e imediato — não há pedido, não há aceite. O que a
 * aprovação controlava de verdade era outra coisa: ver a curva. Isso virou
 * `User.curvaVisivel`, uma decisão só, do dono, que vale para todos os
 * seguidores; e assim acompanhar alguém deixa de exigir a permissão dessa
 * pessoa, que é como funciona em qualquer outro lugar.
 *
 * Tudo aqui é lido por quem está logado e sobre si mesmo — a lista de
 * amigos da Steam de alguém nunca é mostrada a terceiros.
 */

const CACHE_MS = 10 * 60_000;
const amigosCache = new Map<string, { em: number; ids: string[] }>();

export type Pessoa = {
  id: string;
  steamId: string;
  personaName: string;
  avatarUrl: string | null;
};

export type EstadoSeguir = "nada" | "seguindo";

async function idsDeAmigos(steamId: string): Promise<string[]> {
  const hit = amigosCache.get(steamId);
  if (hit && Date.now() - hit.em < CACHE_MS) return hit.ids;
  const ids = await getFriendIds(steamId);
  amigosCache.set(steamId, { em: Date.now(), ids });
  return ids;
}

/**
 * Amigos da Steam que têm conta no FragIQ, com o estado de seguir de cada um.
 *
 * Lista vazia é lista privada; leitura que falhou (cogniflow fora, timeout,
 * recusa) é outra coisa, vai para o diário e não derruba quem chama: o resto
 * de `/amigos` vem só do nosso banco.
 */
export async function amigosNoFragiq(
  meuId: string,
  meuSteamId: string,
): Promise<{ amigos: (Pessoa & { estado: EstadoSeguir; meSegue: boolean })[]; listaPrivada: boolean; leituraFalhou: boolean; totalAmigos: number }> {
  let ids: string[];
  try {
    ids = await idsDeAmigos(meuSteamId);
  } catch (err) {
    await reportarErro("amigos.leitura", err, meuId);
    return { amigos: [], listaPrivada: false, leituraFalhou: true, totalAmigos: 0 };
  }
  if (ids.length === 0) return { amigos: [], listaPrivada: true, leituraFalhou: false, totalAmigos: 0 };

  const [pessoas, saidas, entradas] = await Promise.all([
    prisma.user.findMany({
      where: { steamId: { in: ids }, perfilPublico: true },
      select: { id: true, steamId: true, personaName: true, avatarUrl: true },
      orderBy: { personaName: "asc" },
    }),
    prisma.follow.findMany({ where: { seguidorId: meuId }, select: { seguidoId: true } }),
    prisma.follow.findMany({ where: { seguidoId: meuId }, select: { seguidorId: true } }),
  ]);
  const sigo = new Set(saidas.map((f) => f.seguidoId));
  const meSeguem = new Set(entradas.map((f) => f.seguidorId));

  return {
    amigos: pessoas.map((p) => ({
      ...p,
      estado: sigo.has(p.id) ? ("seguindo" as const) : ("nada" as const),
      meSegue: meSeguem.has(p.id),
    })),
    listaPrivada: false,
    leituraFalhou: false,
    totalAmigos: ids.length,
  };
}

export async function estadoDeSeguir(meuId: string, alvoId: string): Promise<EstadoSeguir> {
  const f = await prisma.follow.findUnique({
    where: { seguidorId_seguidoId: { seguidorId: meuId, seguidoId: alvoId } },
    select: { id: true },
  });
  return f ? "seguindo" : "nada";
}

const pessoa = { id: true, steamId: true, personaName: true, avatarUrl: true } as const;

export async function quemSigo(meuId: string): Promise<Pessoa[]> {
  const rows = await prisma.follow.findMany({
    where: { seguidorId: meuId },
    orderBy: { createdAt: "desc" },
    select: { seguido: { select: pessoa } },
  });
  return rows.map((r) => r.seguido);
}

export async function quemMeSegue(meuId: string): Promise<Pessoa[]> {
  const rows = await prisma.follow.findMany({
    where: { seguidoId: meuId },
    orderBy: { createdAt: "desc" },
    select: { seguidor: { select: pessoa } },
  });
  return rows.map((r) => r.seguidor);
}
