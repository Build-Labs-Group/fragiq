import { prisma } from "./prisma";

/**
 * Quantos dos primeiros passos a pessoa já deu, para o cabeçalho.
 *
 * A lista completa mora no Resumo; fora dele, quem acabou de entrar não
 * tinha como saber que faltava algo. O cabeçalho mostra "2 de 5" em toda
 * página até tudo ficar verde. Conta só com o banco — o bot pela amizade
 * gravada, não pela lista de amigos da Steam — porque roda em toda página
 * e não pode esperar a Web API.
 *
 * Os cinco são os mesmos do cartão (`PrimeirosPassos`): entrar, deixar as
 * estatísticas visíveis, o bot, a segunda coleta e as partidas oficiais.
 */
export type Progresso = { feitos: number; total: number };

/** Quantos são — o cartão do Resumo e o cabeçalho contam a mesma lista. */
export const TOTAL_DE_PASSOS = 5;

export async function progressoDosPrimeirosPassos(userId: string): Promise<Progresso | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      botAmigoDesde: true,
      partidasAtivadasEm: true,
      partidasErro: true,
      games: { where: { gameAppId: 730 }, select: { _count: { select: { snapshots: true } } } },
    },
  });
  if (!user) return null;
  const coletas = user.games[0]?._count.snapshots ?? 0;
  const passos = [true, coletas > 0, Boolean(user.botAmigoDesde), coletas >= 2, Boolean(user.partidasAtivadasEm && !user.partidasErro)];
  const feitos = passos.filter(Boolean).length;
  return feitos === passos.length ? null : { feitos, total: passos.length };
}
