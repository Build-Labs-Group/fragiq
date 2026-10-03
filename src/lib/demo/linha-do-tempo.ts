import { timesPorRound } from "./conversao";
import { economiaDosRounds, type ClasseEconomica } from "./economia";
import { roundsJogados } from "./metricas";
import type { DemoPayload, Lado } from "./payload";

/**
 * A partida round a round: quem venceu cada um, de que lado, como, e com
 * que compra cada time entrou.
 *
 * É o que a página da partida desenha como faixa (a "round history" que
 * todo scoreboard de CS tem), e sai da mesma identidade de time de
 * `conversao.ts` — o time 0 é o que começou de CT —, para que o placar
 * desta faixa e o da conversão nunca discordem.
 *
 * Fica guardada pronta em `MatchDemo.linhaDoTempo` (é pequena: um objeto
 * por round), porque montar exige o payload inteiro, que tem os tiros e
 * pesa centenas de KB; a página só lê o resumo.
 */

export const LINHA_DO_TEMPO_VERSAO = 1;

export type RoundNaLinha = {
  n: number;
  /** O time que venceu o round (0 = começou de CT, 1 = de T). */
  vencedor: 0 | 1;
  /** O lado de quem venceu, no round. */
  lado: Lado;
  /** Como o round acabou, no vocabulário da Valve (`ct_killed`, `bomb_defused`, `target_bombed`, `target_saved`…). */
  motivo: string | null;
  /** O placar depois do round, na ordem dos times da demo. */
  placar: [number, number];
  /** A compra de cada time no round, quando o payload tem economia (v2). */
  compra?: [ClasseEconomica | null, ClasseEconomica | null];
};

export type LinhaDoTempo = {
  versao: number;
  /** Os dois times, pela escalação: é assim que a página casa com o time A/B do placar. */
  times: { ladoInicial: Lado; jogadores: string[] }[];
  rounds: RoundNaLinha[];
};

export function linhaDoTempo(p: DemoPayload): LinhaDoTempo {
  const { times, dono } = timesPorRound(p);
  const compras = new Map<string, ClasseEconomica>();
  for (const e of economiaDosRounds(p)) compras.set(`${e.n}:${e.time}`, e.classe);
  const temCompra = compras.size > 0;

  const placar: [number, number] = [0, 0];
  const rounds: RoundNaLinha[] = [];
  for (const r of roundsJogados(p)) {
    const quem = dono.get(r.n);
    if (!quem || !r.vencedor) continue;
    const vencedor = quem[r.vencedor];
    placar[vencedor]++;
    rounds.push({
      n: r.n,
      vencedor,
      lado: r.vencedor,
      motivo: r.motivo,
      placar: [placar[0], placar[1]],
      ...(temCompra ? { compra: [compras.get(`${r.n}:0`) ?? null, compras.get(`${r.n}:1`) ?? null] as [ClasseEconomica | null, ClasseEconomica | null] } : {}),
    });
  }
  return { versao: LINHA_DO_TEMPO_VERSAO, times, rounds };
}

/** Lê o que está gravado, ou nada — o formato é nosso, mas o banco é JSON e pode ter uma versão velha. */
export function lerLinhaDoTempo(bruto: unknown): LinhaDoTempo | null {
  if (!bruto || typeof bruto !== "object") return null;
  const l = bruto as Partial<LinhaDoTempo>;
  if (l.versao !== LINHA_DO_TEMPO_VERSAO || !Array.isArray(l.rounds) || !Array.isArray(l.times)) return null;
  return l as LinhaDoTempo;
}
