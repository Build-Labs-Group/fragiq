import type { PartidaLinha } from "./partidas";
import { percentil } from "./estatistica";
import { formatarNumero, getLocale } from "./formato";
import { rotularMapa } from "./cs2-labels";

/**
 * Leituras públicas: o que dá para dizer de um jogador só com o que é
 * público — o placar dos dez de cada partida oficial — e a comunidade ao
 * lado.
 *
 * As leituras do dono (insights, analista) leem a curva, que é privada. Estas
 * leem só as partidas, então podem aparecer no perfil público de qualquer
 * um. Cada leitura é um número grande, uma linha e um tom, e só existe com
 * amostra mínima — abaixo dela a leitura some, em vez de afirmar ruído.
 *
 * Pura: recebe as partidas (mais recente primeiro) e as distribuições da
 * comunidade; nada de banco, nada de data do relógio.
 */
export type LeituraPublica = {
  id: "posicao.kd" | "posicao.hs" | "mapa.melhor" | "mapa.pior" | "sequencia" | "forma" | "horario";
  titulo: string;
  valor: string;
  linha: string;
  tom: "bom" | "ruim" | "neutro";
  /** 0–100, para o visual de percentil, quando a leitura é de posição. */
  pct?: number;
};

/** Mínimo de partidas para qualquer leitura. */
export const MIN_PARTIDAS = 5;
/** Mínimo de partidas num mapa (ou numa faixa de horário) para ele entrar na comparação. */
export const MIN_POR_GRUPO = 3;

const kdDe = (k: number, d: number) => (d ? k / d : k);

export function leiturasPublicas(partidas: PartidaLinha[], comunidade: { kd: number[]; hs: number[] }): LeituraPublica[] {
  if (partidas.length < MIN_PARTIDAS) return [];
  const out: LeituraPublica[] = [];
  const soma = partidas.reduce((a, p) => ({ k: a.k + p.eu.kills, d: a.d + p.eu.deaths, hs: a.hs + p.eu.hs }), { k: 0, d: 0, hs: 0 });

  // Posição na comunidade. Acima da mediana, "top X%" — é como quem joga
  // fala; abaixo dela, "top 66%" soa como elogio torto, e vira "melhor que Y%".
  const kd = kdDe(soma.k, soma.d);
  const pKd = percentil(comunidade.kd, kd);
  if (pKd !== null && comunidade.kd.length >= 20) {
    out.push({
      id: "posicao.kd",
      titulo: "K/D na fila",
      valor: posicao(pKd),
      linha: `K/D ${formatarNumero(kd, 2)} entre ${formatarNumero(comunidade.kd.length)} jogadores vistos`,
      tom: pKd >= 60 ? "bom" : pKd <= 40 ? "ruim" : "neutro",
      pct: pKd,
    });
  }
  const hs = soma.k ? (soma.hs / soma.k) * 100 : null;
  const pHs = hs === null ? null : percentil(comunidade.hs, hs);
  if (hs !== null && pHs !== null && comunidade.hs.length >= 20) {
    out.push({
      id: "posicao.hs",
      titulo: "Headshot na fila",
      valor: posicao(pHs),
      linha: `${formatarNumero(hs)}% de HS entre ${formatarNumero(comunidade.hs.length)} jogadores vistos`,
      tom: pHs >= 60 ? "bom" : pHs <= 40 ? "ruim" : "neutro",
      pct: pHs,
    });
  }

  // Mapas: taxa de vitória com amostra mínima. Melhor e pior só se forem diferentes.
  const porMapa = agrupar(partidas, (p) => p.mapa);
  const mapas = [...porMapa.entries()]
    .filter(([m, g]) => m !== null && g.n >= MIN_POR_GRUPO)
    .map(([m, g]) => ({ mapa: m as string, n: g.n, v: g.v, d: g.d, taxa: (g.v / g.n) * 100 }))
    .sort((a, b) => b.taxa - a.taxa || b.n - a.n);
  if (mapas.length >= 2 && mapas[0].taxa !== mapas[mapas.length - 1].taxa) {
    const m = mapas[0];
    out.push({ id: "mapa.melhor", titulo: "Melhor mapa", valor: rotularMapa(m.mapa), linha: `${formatarNumero(m.taxa)}% de vitórias · ${m.v}–${m.d} em ${m.n}`, tom: "bom" });
    const pior = mapas[mapas.length - 1];
    out.push({ id: "mapa.pior", titulo: "Mapa a evitar", valor: rotularMapa(pior.mapa), linha: `${formatarNumero(pior.taxa)}% de vitórias · ${pior.v}–${pior.d} em ${pior.n}`, tom: "ruim" });
  }

  // Sequência atual: só a partir de 3, que é quando deixa de ser acaso de duas.
  const ultimo = partidas[0].eu.venceu;
  let seq = 0;
  for (const p of partidas) {
    if (ultimo === null || p.eu.venceu !== ultimo) break;
    seq++;
  }
  if (seq >= 3 && ultimo !== null) {
    out.push({ id: "sequencia", titulo: "Sequência", valor: `${seq} ${ultimo ? "vitórias" : "derrotas"}`, linha: `seguidas, até a partida mais recente`, tom: ultimo ? "bom" : "ruim" });
  }

  // Forma: K/D das últimas 5 contra as 5–20 anteriores (soma ÷ soma).
  if (partidas.length >= 10) {
    const recentes = partidas.slice(0, 5);
    const antes = partidas.slice(5, 20);
    const a = kdDe(recentes.reduce((s, p) => s + p.eu.kills, 0), recentes.reduce((s, p) => s + p.eu.deaths, 0));
    const b = kdDe(antes.reduce((s, p) => s + p.eu.kills, 0), antes.reduce((s, p) => s + p.eu.deaths, 0));
    if (b > 0) {
      const var_ = ((a - b) / b) * 100;
      const igual = Math.abs(var_) < 5;
      out.push({
        id: "forma",
        titulo: "Forma",
        valor: igual ? "estável" : var_ > 0 ? `▲ ${formatarNumero(Math.abs(var_))}%` : `▼ ${formatarNumero(Math.abs(var_))}%`,
        linha: `K/D ${formatarNumero(a, 2)} nas últimas 5 · ${formatarNumero(b, 2)} nas ${antes.length} antes`,
        tom: igual ? "neutro" : var_ > 0 ? "bom" : "ruim",
      });
    }
  }

  // Horário: a faixa do dia com maior taxa de vitória, entre as que têm amostra.
  const { tz } = getLocale();
  const faixa = (d: Date) => {
    const h = Number(d.toLocaleString("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz }));
    return h < 6 ? "madrugada" : h < 12 ? "manhã" : h < 18 ? "tarde" : "noite";
  };
  const porFaixa = [...agrupar(partidas, (p) => faixa(p.jogadaEm)).entries()]
    .filter(([, g]) => g.n >= MIN_POR_GRUPO)
    .map(([f, g]) => ({ f: f as string, n: g.n, taxa: (g.v / g.n) * 100, kd: kdDe(g.k, g.mortes) }))
    .sort((a, b) => b.taxa - a.taxa || b.kd - a.kd);
  if (porFaixa.length >= 2 && porFaixa[0].taxa > porFaixa[porFaixa.length - 1].taxa) {
    const f = porFaixa[0];
    out.push({ id: "horario", titulo: "Melhor horário", valor: f.f, linha: `${formatarNumero(f.taxa)}% de vitórias · K/D ${formatarNumero(f.kd, 2)} em ${f.n} partidas`, tom: "neutro" });
  }

  return out;
}

function posicao(pct: number): string {
  return pct >= 50 ? `top ${Math.max(1, Math.round(100 - pct))}%` : `melhor que ${Math.round(pct)}%`;
}

function agrupar(partidas: PartidaLinha[], chave: (p: PartidaLinha) => string | null) {
  const m = new Map<string | null, { n: number; v: number; d: number; k: number; mortes: number }>();
  for (const p of partidas) {
    const k = chave(p);
    const g = m.get(k) ?? { n: 0, v: 0, d: 0, k: 0, mortes: 0 };
    g.n++;
    if (p.eu.venceu === true) g.v++;
    if (p.eu.venceu === false) g.d++;
    g.k += p.eu.kills;
    g.mortes += p.eu.deaths;
    m.set(k, g);
  }
  return m;
}
