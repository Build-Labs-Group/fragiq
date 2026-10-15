import { prisma } from "@/lib/prisma";

/**
 * Vínculo com a Gamers Club (docs/gamersclub.md).
 *
 * A Gamers Club não oferece API nem OAuth, e os termos de uso proíbem
 * reproduzir ou usar o conteúdo do serviço sem autorização escrita. Por
 * isso este módulo nunca fala com o site deles: guarda só o que a pessoa
 * declara (o número do perfil e, se quiser, o nível), marcado como tal.
 * `verificada` fica falso até existir um canal autorizado.
 */

export const FONTE_USUARIO = "USUARIO";
export const NIVEL_MAX = 30;

const PERFIL = /^https?:\/\/(?:www\.)?gamersclub\.com\.br\/(?:[a-z]{2}\/)?(?:player|jogador)\/(\d{1,12})(?:[/?#].*)?$/i;

const semZeros = (n: string) => n.replace(/^0+(?=\d)/, "");

/** Aceita o número solto ou o link do perfil; devolve o id ou null. */
export function lerPerfilGamersClub(entrada: string): string | null {
  const t = entrada.trim();
  if (/^\d{1,12}$/.test(t)) return semZeros(t);
  const m = PERFIL.exec(t);
  return m ? semZeros(m[1]!) : null;
}

export type VinculoGc = {
  gcPlayerId: string;
  nivel: number | null;
  fonte: string;
  verificada: boolean;
  informadoEm: Date;
  vinculadaEm: Date;
};

export async function vinculoDe(userId: string): Promise<VinculoGc | null> {
  return prisma.contaGamersClub.findUnique({
    where: { userId },
    select: { gcPlayerId: true, nivel: true, fonte: true, verificada: true, informadoEm: true, vinculadaEm: true },
  });
}

/** Cria ou corrige o vínculo. Trocar o perfil refaz a data do vínculo: é outra conta. */
export async function vincular(userId: string, gcPlayerId: string, nivel: number | null) {
  const agora = new Date();
  const atual = await prisma.contaGamersClub.findUnique({ where: { userId }, select: { gcPlayerId: true } });
  const dados = { gcPlayerId, nivel, fonte: FONTE_USUARIO, verificada: false, informadoEm: agora };
  return prisma.contaGamersClub.upsert({
    where: { userId },
    create: { userId, ...dados, vinculadaEm: agora },
    update: atual?.gcPlayerId === gcPlayerId ? dados : { ...dados, vinculadaEm: agora },
  });
}

/** Desvincular é apagar: a linha inteira, sem cópia nem "desativada". */
export async function desvincular(userId: string): Promise<boolean> {
  const { count } = await prisma.contaGamersClub.deleteMany({ where: { userId } });
  return count > 0;
}
