/** Leitura do perfil da Gamers Club: pura, sem banco (docs/gamersclub.md). */

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
