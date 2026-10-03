import { prisma } from "./prisma";

/**
 * Quem pode abrir /admin.
 *
 * Uma lista de SteamIDs numa variável de ambiente, e não uma coluna no
 * banco: o painel existe para quem opera o produto, e isso muda por deploy,
 * não por clique. Sem a variável, ninguém é admin — o padrão seguro.
 */
export function isAdmin(steamId: string | null | undefined): boolean {
  if (!steamId) return false;
  const lista = (process.env.ADMIN_STEAM_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return lista.includes(steamId);
}

/**
 * O selo vem da conta, não do formulário.
 *
 * Quem entrou com a Steam durante o beta é beta tester — foi o que a landing
 * pediu e o que a pessoa aceitou ao logar. Os cem primeiros são Fundadores.
 * O formulário da comunidade acrescenta papéis, GitHub e uma frase; não é
 * ele que dá o selo, senão o primeiro usuário do site ficaria sem.
 */
export async function seloDe(userId: string): Promise<"fundador" | "beta" | null> {
  const eu = await prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } });
  if (!eu) return null;
  const antes = await prisma.user.count({ where: { createdAt: { lt: eu.createdAt } } });
  return antes < 100 ? "fundador" : "beta";
}
