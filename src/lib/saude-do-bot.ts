/**
 * Como o painel lê o último sinal do bot (`bot_status.ultimoTickEm`).
 *
 * Com trabalho, o bot chama o tick a cada 30 s. Sem trabalho ele fica em
 * repouso e chama uma vez por turno de 30 min (`bot/src/ritmo.ts`), para o
 * banco poder dormir (correção D2, docs/migracao-site-build-labs.md). Um
 * sinal de 10 min atrás é, então, um bot em repouso, e não um bot parado.
 * Quem cai da Steam, perde o GC ou ganha amigo manda o tick na hora, mesmo
 * em repouso, então o "deslogado" continua chegando logo.
 */

/** Turno do repouso do bot (`BOT_REPOUSO_MS`, padrão de `bot/src/ritmo.ts`). */
export const REPOUSO_DO_BOT_MS = 30 * 60_000;
/** Com trabalho, o tick sai a cada 30 s; dois minutos sem ele já é estranho. */
const ATENTO_MS = 2 * 60_000;
/** O turno pode atrasar até um tick (30 s) mais a rede: folga de 5 min. */
const FOLGA_MS = 5 * 60_000;

export type EstadoDoBot = "vivo" | "repouso" | "deslogado" | "parado" | "nunca";

export function estadoDoBot(sinal: { tickHaMs: number; logado: boolean } | null): EstadoDoBot {
  if (!sinal) return "nunca";
  if (sinal.tickHaMs >= REPOUSO_DO_BOT_MS + FOLGA_MS) return "parado";
  // Três estados, não dois: o processo pode estar vivo e sem sessão na Steam.
  if (!sinal.logado) return "deslogado";
  return sinal.tickHaMs < ATENTO_MS ? "vivo" : "repouso";
}

/** "há 40 s", "há 12 min". */
export function haQuanto(ms: number): string {
  return ms < 120_000 ? `há ${Math.round(ms / 1000)} s` : `há ${Math.round(ms / 60_000)} min`;
}
