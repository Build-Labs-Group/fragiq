/**
 * Contas de distribuição, puras, para os gráficos e as leituras públicas.
 * Sem banco e sem formato: só números entram e saem.
 */

/** Fração (0–100) dos valores estritamente abaixo de `v`, com metade dos empates. */
export function percentil(ordenados: number[], v: number): number | null {
  if (ordenados.length === 0 || !Number.isFinite(v)) return null;
  let abaixo = 0;
  let iguais = 0;
  for (const x of ordenados) {
    if (x < v) abaixo++;
    else if (x === v) iguais++;
  }
  return ((abaixo + iguais / 2) / ordenados.length) * 100;
}

/** O quantil `q` (0–1) de uma lista ordenada, por interpolação linear. */
export function quantil(ordenados: number[], q: number): number | null {
  if (ordenados.length === 0) return null;
  const pos = (ordenados.length - 1) * q;
  const base = Math.floor(pos);
  const resto = pos - base;
  const prox = ordenados[base + 1];
  return prox === undefined ? ordenados[base] : ordenados[base] + resto * (prox - ordenados[base]);
}

/** Contagem por faixa, para o histograma: `faixas` intervalos iguais de `min` a `max`; o que passa cai nas pontas. */
export function histograma(valores: number[], min: number, max: number, faixas: number): { de: number; ate: number; n: number }[] {
  const passo = (max - min) / faixas || 1;
  const out = Array.from({ length: faixas }, (_, i) => ({ de: min + i * passo, ate: min + (i + 1) * passo, n: 0 }));
  for (const v of valores) {
    const i = Math.min(faixas - 1, Math.max(0, Math.floor((v - min) / passo)));
    out[i].n++;
  }
  return out;
}
