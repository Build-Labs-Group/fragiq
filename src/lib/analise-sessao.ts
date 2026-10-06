import { createHash } from "node:crypto";
import { ultimoPar, type SnapshotRow } from "./series";
import { conferirAnalise, leituraDaTela, AMOSTRA_MINIMA_ROUNDS, type Divergencia, type JanelaLida, type LeituraLimpa } from "./achados";
import { lerResposta, type AnaliseLida } from "./analise-texto";
import type { Fonte } from "./analista";

/**
 * Uma análise, uma janela.
 *
 * Uma análise de sessão descreve um intervalo exato entre duas coletas. Até
 * 05/10/2026 nada amarrava o texto a esse intervalo: o agente lia "a última
 * sessão" na hora do turno (e, numa sessão sem modo, "a última do modo que
 * ele lembrava da conversa"), e a tela casava a análise com a sessão só pelo
 * id da coleta. Resultado em produção: a sessão de 01/10 00:22 (K/D 0,67)
 * mostrando K/D 1,47 e dano 161 — os números da sessão anterior.
 *
 * Três amarras, cada uma fechando um buraco:
 *
 * 1. **Na pergunta**: a análise grava a janela (`janela`, `janelaHash`) e
 *    manda no `context` a coleta que fecha a sessão e o modo provado dela.
 * 2. **No turno**: `/api/cogniflow/data` corta a série nessa coleta e força
 *    o modo da sessão (`recortarParaSessao`). Toda view lê a sessão
 *    perguntada, contra o normal daquela hora, não importa o que o modelo
 *    lembre ou peça.
 * 3. **Na tela**: a análise só aparece se a sessão de hoje ainda é a mesma
 *    janela (`desatualizada` se não) e se os números que o texto cita batem
 *    com ela (`outra-sessao` se não). Nos dois casos o texto não aparece e a
 *    análise é pedida de novo.
 */

export type JanelaDaSessao = {
  de: string;
  ate: string;
  rounds: number;
  partidas: number | null;
  kills: number | null;
  deaths: number | null;
  dano: number | null;
  headshots: number | null;
};

/** O que identifica a sessão: as duas coletas e os totais do intervalo. */
export function janelaDaSessao(s: {
  deSnapshotId: string;
  ateSnapshotId: string;
  rounds: number;
  partidas: number | null;
  kills: number | null;
  deaths: number | null;
  dano: number | null;
  headshots: number | null;
}): JanelaDaSessao {
  return { de: s.deSnapshotId, ate: s.ateSnapshotId, rounds: s.rounds, partidas: s.partidas, kills: s.kills, deaths: s.deaths, dano: s.dano, headshots: s.headshots };
}

export function hashDaJanela(j: JanelaDaSessao): string {
  const ordenada = [j.de, j.ate, j.rounds, j.partidas, j.kills, j.deaths, j.dano, j.headshots];
  return createHash("sha256").update(JSON.stringify(ordenada)).digest("hex");
}

/**
 * Contadores que nenhuma partida produz: mais de 5 kills ou 500 de dano por
 * round. Acontece quando a coleta pega a Steam no meio da atualização (1
 * round e 39 kills) ou num modo que não conta round (deathmatch). Sessão
 * assim não tem número confiável nenhum — nem K/D, que não se sabe de quais
 * partidas é.
 */
export function sessaoIncompleta(s: { rounds: number; kills: number | null; dano: number | null }): boolean {
  if (s.rounds <= 0) return true;
  return (s.kills ?? 0) > 5 * s.rounds || (s.dano ?? 0) > 500 * s.rounds;
}

/** Menos que isto, nenhuma métrica por round da sessão vai para a tela. */
export { AMOSTRA_MINIMA_ROUNDS };

/**
 * A série cortada na coleta que fecha a sessão, e o par que é a sessão.
 * Null quando a coleta não está na série ou não fecha um intervalo com
 * rounds (a sessão deixou de existir).
 */
export function lerJanela(rows: SnapshotRow[], ateSnapshotId: string, contexto: { modo: string | null; mapa: string | null }): JanelaLida | null {
  const i = rows.findIndex((r) => r.id === ateSnapshotId);
  if (i < 0) return null;
  const ate = rows.slice(0, i + 1);
  const par = ultimoPar(ate, "total_rounds_played");
  if (!par || par.curr.id !== ateSnapshotId) return null;
  return { par, ate, modo: contexto.modo, mapa: contexto.mapa };
}

/**
 * O turno lê a sessão perguntada, não a última.
 *
 * A série é cortada na coleta que fecha a sessão (o que veio depois não
 * existe para este turno, e o normal é o daquela hora), e as partidas
 * oficiais também. O modo é o da sessão, não o que o modelo pedir: o
 * agente tem memória da conversa e levava o "competitive" de uma sessão
 * para a seguinte. Sessão sem modo provado — ou cuja coleta não carrega o
 * modo (`montarFonte` só põe na coleta o modo provado da sessão) — lê sem
 * filtro de modo nem de mapa, porque filtrar pegaria o último par daquele
 * modo, que é outra sessão. Coleta que não está na série (sessão refeita) devolve
 * null: a rota responde 409 e o turno não inventa.
 */
export function recortarParaSessao(
  fonte: Fonte,
  sessao: { ate: string; modo: string | null },
  params: Record<string, unknown>,
): { fonte: Fonte; params: Record<string, unknown> } | null {
  const i = fonte.rows.findIndex((r) => r.id === sessao.ate);
  if (i < 0) return null;
  const rows = fonte.rows.slice(0, i + 1);
  const fim = rows[i].capturedAt.toISOString();
  const { modo: _modo, mapa: _mapa, ...resto } = params;
  void _modo;
  void _mapa;
  const modoNaColeta = sessao.modo !== null && rows[i].matchMode === sessao.modo;
  return {
    fonte: { ...fonte, rows, partidasOficiais: fonte.partidasOficiais.filter((p) => p.jogadaEm <= fim) },
    params: modoNaColeta ? { ...resto, modo: sessao.modo } : resto,
  };
}

export type EstadoDaAnalise =
  /** Na fila do analista. */
  | "pendente"
  /** O turno não respondeu a tempo. */
  | "falhou"
  /** Lida, conferida (ou sem número para conferir) e da mesma janela. */
  | "ok"
  /** A sessão mudou desde a pergunta. */
  | "desatualizada"
  /** Os números do texto são de outra sessão. */
  | "outra-sessao"
  /** Texto que nem como JSON quebrado se lê. */
  | "ilegivel"
  /** A sessão tem contadores impossíveis: não há o que ler. */
  | "incompleta";

export type LeituraDaAnalise =
  | { forma: "estruturada"; leitura: LeituraLimpa }
  | { forma: "prosa"; lida: AnaliseLida };

export type Avaliacao = {
  estado: EstadoDaAnalise;
  leitura: LeituraDaAnalise | null;
  divergencias: Divergencia[];
};

/**
 * O estado de uma análise respondida, e o que a tela pode mostrar dela.
 *
 * `janelaHash` nulo é análise anterior à amarra: vale só a conferência do
 * conteúdo. Sem `janela` lida (a sessão não está mais na série), não há
 * como conferir nem recalcular os achados, e a tela mostra só o texto.
 */
export function avaliarResposta(args: {
  resposta: string;
  janelaHashGravado: string | null;
  janelaAtual: JanelaDaSessao | null;
  janela: JanelaLida | null;
  incompleta: boolean;
}): Avaliacao {
  if (args.incompleta) return { estado: "incompleta", leitura: null, divergencias: [] };
  if (args.janelaHashGravado && args.janelaAtual && hashDaJanela(args.janelaAtual) !== args.janelaHashGravado) {
    return { estado: "desatualizada", leitura: null, divergencias: [] };
  }
  const lida = lerResposta(args.resposta);
  if (lida.forma === "ilegivel") return { estado: "ilegivel", leitura: null, divergencias: [] };
  if (lida.forma === "prosa") return { estado: "ok", leitura: { forma: "prosa", lida: lida.lida }, divergencias: [] };
  if (!args.janela) {
    return { estado: "ok", leitura: { forma: "estruturada", leitura: { manchete: lida.analise.manchete, achados: [], causa: null, acao: lida.analise.acao } }, divergencias: [] };
  }
  const divergencias = conferirAnalise(lida.analise, args.janela);
  if (divergencias.length > 0) return { estado: "outra-sessao", leitura: null, divergencias };
  return { estado: "ok", leitura: { forma: "estruturada", leitura: leituraDaTela(lida.analise, args.janela) }, divergencias: [] };
}

/** Estados em que o texto não vai para a tela e a análise deve ser pedida de novo. */
export const PEDIR_DE_NOVO: ReadonlySet<EstadoDaAnalise> = new Set(["desatualizada", "outra-sessao", "ilegivel", "falhou"]);
