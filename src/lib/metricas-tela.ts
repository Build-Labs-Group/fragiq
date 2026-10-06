import type { LinhaMetrica } from "./leituras";
import type { Normal } from "./series";
import { humanizeKey } from "./series";
import { calcularDelta, type Delta } from "./delta";
import { direcaoDoContador, type Direcao } from "./direcao";
import { rotularMetrica } from "./cs2-labels";
import { formatarNumero } from "./formato";

/**
 * A aba Métricas em duas partes: o que importa em cartões, o resto numa
 * grade.
 *
 * Até 05/10/2026 eram ~180 linhas iguais, com chip cinza em todas (a tabela
 * não sabia se subir era bom), nomes crus da Steam ("Kills · ak47") e os
 * contadores parados ocupando a maior parte da rolagem. Agora:
 *
 * - **Destaques**: até `MAX_DESTAQUES` contadores que se moveram de verdade
 *   na última sessão (`relevante`), que têm lado (`direcao` ≠ "nenhuma") e
 *   que fugiram do normal (chip fora do ruído), na ordem do impacto — os
 *   eventos a mais ou a menos que o normal previa. Cada um vira cartão com
 *   o número, o chip na cor certa, a régua contra o normal e a frase do
 *   impacto ("+6 a mais que o seu normal").
 * - **Resto**: tudo que não é destaque, em ladrilhos de tamanho fixo numa
 *   grade com rolagem, na mesma ordem de camadas de `todasAsMetricas`
 *   (moveu e pesou, moveu pouco, não moveu). Os parados vão apagados.
 * - **Congeladas**: os contadores de "última partida", que a Valve parou de
 *   atualizar, fora da grade principal.
 */

export const MAX_DESTAQUES = 6;

const GRUPO_CONGELADO = "Última partida";

export type MetricaDaTela = LinhaMetrica & {
  rotulo: string;
  direcao: Direcao;
  /** O chip: valência pela tabela de `lib/direcao.ts`, fraco sem amostra. */
  delta: Delta;
  /** Eventos a mais (+) ou a menos (−) do que o normal previa nos rounds da sessão. */
  diferenca: number | null;
};

function normalDaLinha(l: LinhaMetrica): Normal {
  if (l.vitalicio === null || l.referencia === null || l.referencia === "nenhum") return { tipo: "nenhum", motivo: "sem-vitalicio" };
  if (l.referencia === "modo") return { tipo: "modo", valor: l.vitalicio, rotulo: "normal do modo", sessoes: 0 };
  if (l.referencia === "vitalicio-fraco") return { tipo: "vitalicio-fraco", valor: l.vitalicio, rotulo: "vitalício", progresso: { sessoes: 0, minimo: 0 } };
  return { tipo: "vitalicio", valor: l.vitalicio, rotulo: "vitalício" };
}

export function metricaDaTela(l: LinhaMetrica, roundsDaSessao: number): MetricaDaTela {
  const direcao = l.porRound ? direcaoDoContador(l.key) : "nenhuma";
  const delta = l.porRound ? calcularDelta({ melhorQuando: direcao }, l.periodo, normalDaLinha(l), !l.relevante) : ({ estado: "sem-base", motivo: "sem-normal" } as const);
  const diferenca = l.porRound && l.periodo !== null && l.vitalicio !== null && roundsDaSessao > 0 ? (l.periodo - l.vitalicio) * roundsDaSessao : null;
  return { ...l, rotulo: rotularMetrica(l.key, humanizeKey), direcao, delta, diferenca };
}

export function ehDestaque(m: MetricaDaTela): boolean {
  return m.relevante && m.aconteceu && m.direcao !== "nenhuma" && m.delta.estado === "ok" && m.delta.direcao !== "igual" && !m.delta.fraco;
}

export function separarMetricas(
  linhas: LinhaMetrica[],
  roundsDaSessao: number,
): { destaques: MetricaDaTela[]; resto: MetricaDaTela[]; congeladas: MetricaDaTela[] } {
  const todas = linhas.map((l) => metricaDaTela(l, roundsDaSessao));
  const congeladas = todas.filter((m) => m.grupo === GRUPO_CONGELADO);
  const vivas = todas.filter((m) => m.grupo !== GRUPO_CONGELADO);
  // `todasAsMetricas` já ordena por camada e impacto: os primeiros destaques são os que mais pesaram.
  const destaques = vivas.filter(ehDestaque).slice(0, MAX_DESTAQUES);
  const ids = new Set(destaques.map((d) => d.key));
  return { destaques, resto: vivas.filter((m) => !ids.has(m.key)), congeladas };
}

/** "+6 a mais que o seu normal" / "4 a menos que o seu normal" / null (≈ ou sem base). */
export function fraseDoImpacto(m: MetricaDaTela): string | null {
  if (m.diferenca === null) return null;
  const n = Math.round(m.diferenca);
  if (n === 0) return null;
  return n > 0 ? `+${formatarNumero(n)} a mais que o seu normal` : `${formatarNumero(Math.abs(n))} a menos que o seu normal`;
}
