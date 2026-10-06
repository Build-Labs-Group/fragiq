import { CS2_PANEL } from "./cs2-panel";
import { deltaEntre, type Lente, type Normal, type SnapshotRow } from "./series";
import { referenciaDe } from "./referencia";
import { calcularDelta, type Delta } from "./delta";
import { direcaoDoPainel, type Direcao } from "./direcao";
import { armasNoTexto, modosNoTexto, normalizarTexto, rotularArma, rotularMapa, rotularModo } from "./cs2-labels";
import { formatarNumero, formatarStat } from "./formato";
import type { Achado, AnaliseEstruturada } from "./analise-texto";

/**
 * Os achados do analista, com números nossos.
 *
 * O modelo escolhe **do que** falar ("Precisão M4A1", "Kills por round");
 * o número, a referência, o arredondamento, a direção e a cor saem daqui,
 * da mesma sessão e da mesma regra de normal do resto da tela. Em produção
 * o modelo escreveu "1,66 vs 0,71 ▲134%" ao lado do cartão "1,66 ▲132%"
 * (referência arredondada por ele), "Dano por round: melhor quando desce",
 * e números de outra sessão inteira. Três regras resolvem:
 *
 * 1. **Um número, um lugar.** K/D, dano por round e headshot já estão nos
 *    cartões da sessão (lidos dos insights); o achado que repete um deles
 *    sai da lista e só serve para conferir.
 * 2. **Achado é métrica conhecida.** O rótulo é resolvido para uma métrica
 *    (`resolverMetrica`); o valor é recalculado do par de coletas da sessão
 *    e a referência é `referenciaDe` sobre a série até a sessão — o "normal
 *    na hora". Rótulo que não se resolve sai: número que não dá para
 *    conferir não vai para a tela.
 * 3. **Conferência.** O número que o modelo escreveu é comparado com o
 *    nosso. Se não bate (com folga para o arredondamento dele), a análise
 *    leu outra sessão, e a tela não mostra o texto dela.
 */

export type ChavePainel = "kd" | "adr" | "hs" | "kpr" | "winrate" | "mvp" | "rounds";

export type MetricaDeAchado =
  | { tipo: "painel"; chave: ChavePainel }
  | { tipo: "precisao"; arma: string }
  | { tipo: "kills-arma"; arma: string };

/** As três que os cartões da sessão já mostram. */
export const DO_CARTAO: ReadonlySet<ChavePainel> = new Set(["kd", "adr", "hs"]);

/** Do rótulo livre que o modelo escreveu para uma métrica que sabemos calcular. */
export function resolverMetrica(rotulo: string): MetricaDeAchado | null {
  const t = ` ${normalizarTexto(rotulo)} `;
  const [arma] = armasNoTexto(rotulo);
  if (/ (precisao|precision|accuracy|acertos?|mira) /.test(t)) return arma ? { tipo: "precisao", arma } : null;
  if (/ (kills?|abates?) (por|\/|p) (round|rodada)/.test(t) || / kpr /.test(t)) return arma ? { tipo: "kills-arma", arma } : { tipo: "painel", chave: "kpr" };
  if (arma) return null;
  if (/ k ?d /.test(t) || / kdr /.test(t)) return { tipo: "painel", chave: "kd" };
  if (/ (dano|damage|adr) /.test(t)) return { tipo: "painel", chave: "adr" };
  if (/ (headshots?|hs|cabeca) /.test(t)) return { tipo: "painel", chave: "hs" };
  if (/ rounds? (por|\/) partida /.test(t)) return { tipo: "painel", chave: "rounds" };
  if (/ (vitorias?|win ?rate|taxa de vitoria) /.test(t)) return { tipo: "painel", chave: "winrate" };
  if (/ mvps? /.test(t)) return { tipo: "painel", chave: "mvp" };
  return null;
}

type Conta = {
  metric: string;
  denominator: string;
  scale: number;
  emPct: boolean;
  direcao: Direcao;
  amostra: { de: "rounds" | "partidas" | "tiros"; minimo: number; fraco: number };
  /** O que conta como sessão forte na base do normal (`normalDe`). */
  amostraNormal: { de: "rounds" | "partidas"; minimo: number };
  formatar: (v: number) => string;
};

const NORMAL_POR_ROUNDS = { de: "rounds", minimo: 10 } as const;

const PAINEL = Object.fromEntries(CS2_PANEL.map((s) => [s.key, s]));

function contaDe(m: MetricaDeAchado): Conta {
  if (m.tipo === "precisao") {
    return {
      metric: `total_hits_${m.arma}`,
      denominator: `total_shots_${m.arma}`,
      scale: 100,
      emPct: true,
      direcao: "sobe",
      amostra: { de: "tiros", minimo: 10, fraco: 25 },
      amostraNormal: NORMAL_POR_ROUNDS,
      formatar: (v) => `${formatarNumero(v, 1)}%`,
    };
  }
  if (m.tipo === "kills-arma") {
    return {
      metric: `total_kills_${m.arma}`,
      denominator: "total_rounds_played",
      scale: 1,
      emPct: false,
      direcao: "sobe",
      amostra: { de: "rounds", minimo: AMOSTRA_MINIMA_ROUNDS, fraco: AMOSTRA_MINIMA_ROUNDS },
      amostraNormal: NORMAL_POR_ROUNDS,
      formatar: (v) => formatarNumero(v, 2),
    };
  }
  const stat = PAINEL[m.chave];
  const deRounds = stat.amostra.de === "rounds";
  return {
    metric: stat.spec.metric,
    denominator: stat.spec.denominator!,
    scale: stat.spec.scale ?? 1,
    emPct: stat.unit === "%",
    direcao: direcaoDoPainel(m.chave),
    // Taxa por round em menos de uma partida mínima não é número: o par de
    // coletas pegou a Steam no meio da atualização (1 round, 4.364 de dano).
    amostra: deRounds ? { de: "rounds", minimo: AMOSTRA_MINIMA_ROUNDS, fraco: stat.amostra.minimo } : { de: "partidas", minimo: 1, fraco: stat.amostra.minimo },
    amostraNormal: stat.amostra,
    formatar: (v) => formatarStat(stat, v),
  };
}

/** Abaixo disto uma sessão não vira métrica por round (`lib/sessoes.ts` usa o mesmo). */
export const AMOSTRA_MINIMA_ROUNDS = 10;

/** O par de coletas que é a sessão, e a série até ela: o recorte "na hora". */
export type JanelaLida = {
  par: { prev: SnapshotRow; curr: SnapshotRow };
  /** As coletas até a que fechou a sessão, inclusive. */
  ate: SnapshotRow[];
  /** O modo provado da sessão (null em sessão sem prova). */
  modo: string | null;
  mapa: string | null;
};

function valorNaSessao(janela: JanelaLida, c: Conta): { valor: number | null; amostra: number } {
  const n = deltaEntre(janela.par, c.metric);
  const d = deltaEntre(janela.par, c.denominator);
  const rounds = deltaEntre(janela.par, "total_rounds_played") ?? 0;
  const partidas = deltaEntre(janela.par, "total_matches_played") ?? 0;
  const amostra = c.amostra.de === "tiros" ? (d ?? 0) : c.amostra.de === "rounds" ? rounds : partidas;
  if (n === null || d === null || d <= 0 || amostra < c.amostra.minimo) return { valor: null, amostra };
  return { valor: (n / d) * c.scale, amostra };
}

function baseDe(c: Conta, amostra: number): string {
  if (c.amostra.de === "tiros") return `${formatarNumero(amostra)} tiros`;
  if (c.amostra.de === "rounds") return `${formatarNumero(amostra)} rounds`;
  return `${formatarNumero(amostra)} ${amostra === 1 ? "partida" : "partidas"}`;
}

/* ------------------------------ conferência ------------------------------ */

/** Folga para o arredondamento do modelo, por métrica. */
function folga(m: MetricaDeAchado, nosso: number): number {
  if (m.tipo === "precisao") return 2.5;
  if (m.tipo === "kills-arma") return Math.max(0.02, nosso * 0.05);
  switch (m.chave) {
    case "kd":
      return Math.max(0.02, nosso * 0.02);
    case "adr":
      return Math.max(2, nosso * 0.03);
    case "hs":
    case "winrate":
      return 2.5;
    case "kpr":
      return Math.max(0.02, nosso * 0.05);
    case "mvp":
      return Math.max(0.05, nosso * 0.05);
    case "rounds":
      return Math.max(0.2, nosso * 0.03);
  }
}

export type Divergencia = { rotulo: string; escrito: number; daSessao: number };

/**
 * O que o modelo escreveu bate com a sessão?
 *
 * Cada achado que se resolve para uma métrica é comparado com o valor da
 * sessão; e todo "N rounds" escrito (manchete, nota, causa) tem que ser os
 * rounds da sessão. Uma divergência basta: a análise leu outra janela.
 */
export function conferirAnalise(analise: AnaliseEstruturada, janela: JanelaLida): Divergencia[] {
  const divergencias: Divergencia[] = [];
  for (const a of analise.achados) {
    const m = resolverMetrica(a.rotulo);
    if (!m) continue;
    const c = contaDe(m);
    // A conferência usa o par cru, sem o mínimo de amostra da tela.
    const n = deltaEntre(janela.par, c.metric);
    const d = deltaEntre(janela.par, c.denominator);
    if (n === null || d === null || d <= 0) continue;
    const nosso = (n / d) * c.scale;
    const escrito = c.emPct && a.valor <= 1 && nosso > 1.5 ? a.valor * 100 : a.valor;
    if (Math.abs(escrito - nosso) > folga(m, nosso)) divergencias.push({ rotulo: a.rotulo, escrito: a.valor, daSessao: nosso });
  }
  divergencias.push(...roundsCitados([analise.manchete, analise.causa ?? "", ...analise.achados.map((a) => a.nota ?? "")], janela));
  return divergencias;
}

/** Todo "N rounds" escrito tem que ser os rounds da sessão. */
function roundsCitados(textos: string[], janela: JanelaLida): Divergencia[] {
  const rounds = deltaEntre(janela.par, "total_rounds_played");
  if (rounds === null) return [];
  const divergencias: Divergencia[] = [];
  for (const t of textos) {
    for (const m of t.matchAll(/(\d+)\s+(rounds?|rodadas?)\b(?!\s+(ganhos|vencidos|perdidos|de base))/gi)) {
      const n = Number(m[1]);
      if (n !== rounds) divergencias.push({ rotulo: "rounds citados", escrito: n, daSessao: rounds });
    }
  }
  return divergencias;
}

/**
 * A mesma conferência para uma resposta em prosa (o modelo às vezes ignora
 * o formato e escreve markdown): os rounds citados e o K/D escrito como
 * "K/D: 0.67". Prosa não tem achados para recalcular, então é o que dá
 * para provar — e é o que denunciava a análise de outra sessão.
 */
export function conferirProsa(texto: string, janela: JanelaLida): Divergencia[] {
  const divergencias = roundsCitados([texto], janela);
  const kills = deltaEntre(janela.par, "total_kills");
  const deaths = deltaEntre(janela.par, "total_deaths");
  const m = /K\/D(?:\*\*)?\s*:?\s*(?:\*\*)?\s*(\d+[.,]\d+)/i.exec(texto);
  if (m && kills !== null && deaths) {
    const nosso = kills / deaths;
    const escrito = Number(m[1].replace(",", "."));
    if (Math.abs(escrito - nosso) > Math.max(0.02, nosso * 0.02)) divergencias.push({ rotulo: "K/D", escrito, daSessao: nosso });
  }
  return divergencias;
}

/* ------------------------------ o que a tela mostra ------------------------------ */

export type AchadoDaTela = {
  id: string;
  rotulo: string;
  arma: string | null;
  valor: number;
  texto: string;
  referencia: number | null;
  textoReferencia: string | null;
  delta: Delta;
  emPct: boolean;
  /** Sobre o que o número se apoia: "60 tiros", "24 rounds". */
  base: string;
};

function rotuloDe(m: MetricaDeAchado): string {
  if (m.tipo === "precisao") return `Precisão ${rotularArma(m.arma)}`;
  if (m.tipo === "kills-arma") return `Kills por round · ${rotularArma(m.arma)}`;
  return PAINEL[m.chave].label;
}

function referenciaNaHora(janela: JanelaLida, c: Conta): Normal {
  const lente: Lente = { modo: janela.modo };
  return referenciaDe(janela.ate, { metric: c.metric, denominator: c.denominator, mode: "ratio", scale: c.scale }, lente, janela.par.curr.id ?? null, c.amostraNormal);
}

/**
 * Os achados que a tela desenha: os do modelo que se resolvem para uma
 * métrica fora dos cartões, cada um com o valor da sessão, o normal na hora
 * e a direção da tabela. Sem duplicatas; no máximo três.
 */
export function achadosDaTela(achados: Achado[], janela: JanelaLida): AchadoDaTela[] {
  const vistos = new Set<string>();
  const saida: AchadoDaTela[] = [];
  for (const a of achados) {
    const m = resolverMetrica(a.rotulo);
    if (!m || (m.tipo === "painel" && DO_CARTAO.has(m.chave))) continue;
    const id = m.tipo === "painel" ? m.chave : `${m.tipo}:${m.arma}`;
    if (vistos.has(id)) continue;
    vistos.add(id);
    const c = contaDe(m);
    const { valor, amostra } = valorNaSessao(janela, c);
    if (valor === null) continue;
    const normal = referenciaNaHora(janela, c);
    const delta = calcularDelta({ unit: c.emPct ? "%" : undefined, melhorQuando: c.direcao }, valor, normal, amostra < c.amostra.fraco);
    const referencia = normal.tipo === "nenhum" ? null : normal.valor;
    saida.push({
      id,
      rotulo: rotuloDe(m),
      arma: m.tipo === "painel" ? null : m.arma,
      valor,
      texto: c.formatar(valor),
      referencia,
      textoReferencia: referencia === null ? null : `${normal.tipo === "modo" ? "normal" : "vitalício"} ${c.formatar(referencia)}`,
      delta,
      emPct: c.emPct,
      base: baseDe(c, amostra),
    });
    if (saida.length === 3) break;
  }
  return saida;
}

/* ------------------------------- o texto ------------------------------- */

const ANGLICISMOS: [RegExp, string][] = [
  [/\bprecision\b/gi, "precisão"],
  [/\baccuracy\b/gi, "precisão"],
];

const MODOS_DE_PARTIDA = new Set(["competitive", "premier", "scrimcomp2v2", "deathmatch"]);

/** Mapas que um texto pode citar, pelo nome em português da tela. */
const MAPAS_CONHECIDOS = ["de_mirage", "de_dust2", "de_inferno", "de_nuke", "de_ancient", "de_anubis", "de_overpass", "de_vertigo", "de_train", "de_cache", "cs_office", "cs_italy", "de_cbble"];

function semCitacao(texto: string, nome: string): string {
  const n = nome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return texto.replace(new RegExp(`\\s*,?\\s*\\b(no|na|em|do|da|de|pelo|pela)\\s+(modo\\s+)?${n}\\b`, "gi"), "").replace(new RegExp(`\\b${n}\\b\\s*`, "gi"), "");
}

function arrumar(texto: string): string {
  const t = texto.replace(/\s{2,}/g, " ").replace(/\s+([,.;:])/g, "$1").replace(/^[\s,;:–-]+|[\s,;:–-]+$/g, "").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

/**
 * Tira do texto o que a sessão desmente.
 *
 * Modo que a sessão não tem ("no Competitivo" numa sessão sem prova de
 * modo — o modelo trazia o modo da conversa anterior), mapa diferente do
 * da sessão, e inglês no meio do português ("precision com Galil").
 */
export function limparFrase(texto: string, janela: Pick<JanelaLida, "modo" | "mapa">): string {
  let t = texto;
  for (const [re, troca] of ANGLICISMOS) t = t.replace(re, troca);
  for (const modo of modosNoTexto(t)) {
    // "treino", "casual" e afins também são palavras comuns; só os modos de
    // partida que o modelo de fato confunde entram na limpeza.
    if (MODOS_DE_PARTIDA.has(modo) && modo !== janela.modo) t = semCitacao(t, rotularModo(modo));
  }
  if (janela.modo !== "competitive" && janela.modo !== "premier") t = t.replace(/\s+competitiv[ao]s?\b/gi, "");
  // Mapa que não é o da sessão sai; sessão sem mapa provado não tem mapa nenhum.
  for (const mapa of MAPAS_CONHECIDOS) {
    if (mapa !== janela.mapa && new RegExp(`\\b${rotularMapa(mapa)}\\b`, "i").test(t)) t = semCitacao(t, rotularMapa(mapa));
  }
  return arrumar(t);
}

export type LeituraLimpa = {
  manchete: string;
  achados: AchadoDaTela[];
  causa: string | null;
  acao: string | null;
};

/**
 * A análise pronta para a tela: frases limpas, achados nossos, causa só se
 * as armas que ela cita estão nos achados, ação só se a arma que ela cita
 * foi usada na sessão.
 */
export function leituraDaTela(analise: AnaliseEstruturada, janela: JanelaLida): LeituraLimpa {
  const achados = achadosDaTela(analise.achados, janela);
  const armasDosAchados = new Set(achados.map((a) => a.arma).filter(Boolean));
  const usadas = (arma: string) => (deltaEntre(janela.par, `total_shots_${arma}`) ?? 0) > 0 || (deltaEntre(janela.par, `total_kills_${arma}`) ?? 0) > 0;

  const causa = analise.causa ? limparFrase(analise.causa, janela) : null;
  const causaOk = causa && armasNoTexto(causa).every((a) => armasDosAchados.has(a)) ? causa : null;
  const acao = analise.acao ? limparFrase(analise.acao, janela) : null;
  const acaoOk = acao && armasNoTexto(acao).every(usadas) ? acao : null;

  return { manchete: limparFrase(analise.manchete, janela) || analise.manchete, achados, causa: causaOk || null, acao: acaoOk || null };
}
