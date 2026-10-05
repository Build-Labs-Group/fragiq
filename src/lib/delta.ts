import type { Normal } from "./series";

/**
 * A distância entre um valor e o seu normal, julgada.
 *
 * Um cálculo só, para o hero, o cartão, a tabela de sessões e a página da
 * estatística — cada um fazia o seu e nenhum concordava. Regras:
 *
 * - stats em `%` comparam em pontos percentuais (headshot de 36 % para 53 %
 *   é `▲ 17 pp`, não `+47 %`; vitórias de 41 % para 0 % é `▼ 41 pp`, não
 *   `-100 %`); as outras, em razão relativa;
 * - abaixo de 3 % (ou 1 pp) é ruído: `≈`, sem cor;
 * - a cor é a direção vezes o que é bom para a estatística;
 * - amostra pequena não muda o número, muda a confiança: chip `fraco`;
 * - sem base não há chip: a linha de referência diz por quê. `0%` por falta
 *   de base não existe.
 */
export type Valencia = "good" | "bad" | "neutral";

export type Delta =
  | {
      estado: "ok";
      valor: number;
      unidade: "%" | "pp";
      direcao: "sobe" | "desce" | "igual";
      valencia: Valencia;
      fraco: boolean;
    }
  | { estado: "sem-base"; motivo: "sem-normal" | "poucas-sessoes" | "sem-amostra" };

const LIMIAR_PCT = 3;
const LIMIAR_PP = 1;

export function calcularDelta(
  stat: { unit?: string; melhorQuando: "sobe" | "desce" | "nenhuma" },
  valor: number | null,
  normal: Normal,
  fraco = false,
): Delta {
  if (valor === null) return { estado: "sem-base", motivo: "sem-amostra" };
  if (normal.tipo === "nenhum") return { estado: "sem-base", motivo: "sem-normal" };

  const emPp = stat.unit === "%";
  const bruto = emPp ? valor - normal.valor : normal.valor === 0 ? null : ((valor - normal.valor) / Math.abs(normal.valor)) * 100;
  if (bruto === null) return { estado: "sem-base", motivo: "sem-normal" };

  const limiar = emPp ? LIMIAR_PP : LIMIAR_PCT;
  const direcao = Math.abs(bruto) < limiar ? "igual" : bruto > 0 ? "sobe" : "desce";
  const valencia =
    direcao === "igual" || stat.melhorQuando === "nenhuma"
      ? "neutral"
      : direcao === stat.melhorQuando
        ? "good"
        : "bad";
  return { estado: "ok", valor: bruto, unidade: emPp ? "pp" : "%", direcao, valencia, fraco: fraco || normal.tipo === "vitalicio-fraco" };
}
