import { cache } from "react";
import { unstable_cache } from "next/cache";
import { prisma } from "./prisma";

/**
 * Cache das leituras pesadas, chaveado pela versão dos dados.
 *
 * As telas do jogo releem a cada visita as 500 coletas (cada uma com os
 * 178 contadores em JSON), as sessões, as partidas e os insights — e quase
 * sempre nada mudou desde a visita anterior: os dados só andam quando chega
 * um evento (uma coleta, uma partida do GC, uma demo lida, um modo marcado).
 *
 * Por isso a chave do cache não é o tempo, é a **versão**: uma consulta
 * barata devolve, por jogador, a contagem e o instante mais recente de cada
 * tabela que alimenta as telas. Mudou qualquer coisa, a versão muda e a
 * leitura refaz; nada mudou, a tela sai da memória.
 *
 * Duas consequências que importam para a integridade:
 *
 * - **Nunca serve dado velho.** A versão é lida do banco em toda requisição,
 *   então uma Lambda que não viu a escrita (cada instância tem a sua
 *   memória) também não acha a entrada antiga: a chave dela é outra.
 * - **Não depende de ninguém lembrar de invalidar.** Quem grava (sync, bot,
 *   demo, marcar modo, recálculo) não precisa chamar nada. O `revalidateTag`
 *   continua possível pela tag do jogador, só para liberar memória.
 *
 * O armazenamento é o data cache do Next (`unstable_cache`), em memória:
 * `isrFlushToDisk: false` no `next.config.ts`, porque o disco da Lambda é
 * só leitura. O valor passa por JSON, então quem guarda `Date` declara os
 * campos a reviver (`reviver`).
 */

/** Por jogador: coletas, sessões, partidas (e demos), insights e o próprio cadastro. */
export type VersaoDosDados = string;

type LinhaVersao = { versao: string | null };

/**
 * A versão dos dados de um jogador. Memoizada por requisição: o layout e a
 * página perguntam a mesma coisa.
 *
 * Cada parte é `contagem:instante mais recente`, para que apagar (a
 * contagem cai) também mude a versão, não só gravar.
 */
export const versaoDoJogador = cache(async (userId: string): Promise<VersaoDosDados> => {
  const [linha] = await prisma.$queryRaw<LinhaVersao[]>`
    SELECT concat_ws('|',
      (SELECT count(*) || ':' || coalesce(extract(epoch FROM max(s."capturedAt"))::text, '')
         FROM stat_snapshots s JOIN user_games ug ON ug.id = s."userGameId"
        WHERE ug."userId" = ${userId}),
      (SELECT count(*) || ':' || coalesce(extract(epoch FROM max("updatedAt"))::text, '')
         FROM sessions WHERE "userId" = ${userId}),
      (SELECT count(*) || ':' || coalesce(extract(epoch FROM max(greatest(m."updatedAt", md."updatedAt")))::text, '')
         FROM match_players mp
         JOIN users u ON u."steamId" = mp."steamId" AND u.id = ${userId}
         JOIN matches m ON m.id = mp."matchId"
         LEFT JOIN match_demos md ON md."matchId" = m.id),
      (SELECT count(*) || ':' || coalesce(extract(epoch FROM max("updatedAt"))::text, '')
         FROM insights WHERE "userId" = ${userId}),
      (SELECT count(*) || ':' || coalesce(extract(epoch FROM max("updatedAt"))::text, '')
         FROM user_games WHERE "userId" = ${userId}),
      (SELECT extract(epoch FROM "updatedAt")::text FROM users WHERE id = ${userId})
    ) AS versao`;
  return linha?.versao ?? "vazio";
});

/**
 * A versão das partidas de um SteamID — conta ou não do FragIQ. É o que a
 * página pública e o painel de partidas leem.
 */
export const versaoDasPartidas = cache(async (steamId: string): Promise<VersaoDosDados> => {
  const [linha] = await prisma.$queryRaw<LinhaVersao[]>`
    SELECT count(*) || ':' || coalesce(extract(epoch FROM max(greatest(m."updatedAt", md."updatedAt")))::text, '') AS versao
      FROM match_players mp
      JOIN matches m ON m.id = mp."matchId"
      LEFT JOIN match_demos md ON md."matchId" = m.id
     WHERE mp."steamId" = ${steamId}`;
  return linha?.versao ?? "vazio";
});

/** A tag de um jogador, para quem quiser liberar a memória depois de gravar. */
export const tagDoJogador = (userId: string) => `jogador:${userId}`;

/**
 * Embrulha uma leitura no data cache, com a versão dentro da chave.
 *
 * `revalidate` é só o teto de vida na memória (a versão é que garante a
 * frescura); `reviver` devolve os `Date` que o JSON transformou em texto.
 */
export async function lerComVersao<T>(opcoes: {
  nome: string;
  chave: (string | number | null)[];
  versao: VersaoDosDados;
  tags?: string[];
  ler: () => Promise<T>;
  reviver?: (valor: T) => T;
  revalidate?: number;
}): Promise<T> {
  const partes = [opcoes.nome, ...opcoes.chave.map((p) => String(p)), opcoes.versao];
  const guardado = unstable_cache(opcoes.ler, partes, { tags: opcoes.tags, revalidate: opcoes.revalidate ?? 3600 });
  let valor: T;
  try {
    valor = await guardado();
  } catch (e) {
    // Fora de uma requisição do Next (script, teste) não há data cache:
    // lê direto. Qualquer outro erro é da leitura e sobe como sempre.
    if (!(e instanceof Error && /incrementalCache missing/i.test(e.message))) throw e;
    return opcoes.ler();
  }
  return opcoes.reviver ? opcoes.reviver(valor) : valor;
}

/** Converte em `Date` os campos que o JSON do cache devolveu como texto. */
export function reviverDatas<T extends Record<string, unknown>>(obj: T, campos: (keyof T)[]): T {
  for (const c of campos) {
    const v = obj[c];
    if (typeof v === "string") (obj as Record<keyof T, unknown>)[c] = new Date(v);
  }
  return obj;
}
