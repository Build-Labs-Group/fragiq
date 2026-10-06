/**
 * A resposta do analista, lida em partes.
 *
 * Duas formas existem no banco. A **estruturada** (prompt v4, 17/09/2026):
 * um objeto JSON com manchete, achados, causa e ação, que o cartão desenha.
 * A **prosa**, das análises anteriores: manchete **em negrito** na primeira
 * linha, parágrafos, e a ação numa última linha começando com "→".
 *
 * Regra da tela: **o usuário nunca vê JSON.** Até 05/10/2026 a leitura
 * estruturada era um schema rígido — nota com mais de 48 caracteres, rótulo
 * com mais de 32, uma chave mal escrita — e qualquer escorregão do modelo
 * mandava o objeto inteiro para a leitura em prosa, que o mostrava cru com
 * um "ler ▾". Agora: o objeto é achado dentro do texto (cerca de código,
 * texto antes ou depois), o que passa do tamanho é cortado em vez de
 * recusado, e um JSON quebrado ("unidade:@"%"", vírgula sobrando) é lido
 * campo a campo. O que mesmo assim não se lê vira `ilegivel`, e o cartão
 * pede a análise de novo em vez de mostrar o texto.
 *
 * Na prosa, uma manchete é manchete quando vem marcada (`**…**` inteira ou
 * `# `), com até 90 caracteres e sem dois-pontos no fim; um primeiro
 * parágrafo curto não vira título por ser curto.
 */

export type AnaliseLida = {
  manchete: string | null;
  paragrafos: string[];
  acao: string | null;
};

/**
 * Um achado como o modelo escreveu: rótulo, número e referência. É só
 * matéria-prima — a tela não mostra estes números (`lib/achados.ts` os
 * recalcula da sessão e decide a direção pela tabela de `lib/direcao.ts`);
 * eles servem para saber de que métrica o modelo falou e para conferir que
 * ele leu a sessão certa.
 */
export type Achado = {
  rotulo: string;
  valor: number;
  referencia: number | null;
  /** "" razão pura (K/D), "%" percentual, "n" contagem. */
  unidade: "" | "%" | "n";
  nota: string | null;
};

export type AnaliseEstruturada = {
  manchete: string;
  achados: Achado[];
  causa: string | null;
  acao: string | null;
};

export type RespostaLida =
  | { forma: "estruturada"; analise: AnaliseEstruturada; /** Lida campo a campo porque o JSON veio quebrado. */ reparada: boolean }
  | { forma: "prosa"; lida: AnaliseLida }
  | { forma: "ilegivel" };

/** Tetos de tamanho: acima deles o texto é cortado com reticências, nunca recusado. */
const TETO = { manchete: 110, rotulo: 48, nota: 64, causa: 140, acao: 140 } as const;
const MAX_ACHADOS = 4;

/** Lê qualquer resposta guardada: estruturada, prosa ou ilegível. */
export function lerResposta(texto: string): RespostaLida {
  const bruto = (texto ?? "").trim();
  if (!bruto) return { forma: "ilegivel" };

  const pareceJson = /^\s*(```|\{)/.test(bruto) || /"(manchete|achados|causa|acao)"\s*:/.test(bruto);
  if (!pareceJson) return { forma: "prosa", lida: lerAnalise(bruto) };

  const objeto = recortarObjeto(bruto);
  if (objeto !== null) {
    try {
      const estruturada = normalizar(JSON.parse(objeto));
      if (estruturada) return { forma: "estruturada", analise: estruturada, reparada: false };
    } catch {
      // cai na leitura campo a campo
    }
  }
  const reparada = lerCampoACampo(objeto ?? bruto);
  return reparada ? { forma: "estruturada", analise: reparada, reparada: true } : { forma: "ilegivel" };
}

/** Só a forma estruturada (ou null): o que o cartão desenha. */
export function lerAnaliseEstruturada(texto: string): AnaliseEstruturada | null {
  const r = lerResposta(texto);
  return r.forma === "estruturada" ? r.analise : null;
}

/** Do primeiro `{` ao último `}`: tira cerca de código e texto em volta. */
function recortarObjeto(texto: string): string | null {
  const ini = texto.indexOf("{");
  const fim = texto.lastIndexOf("}");
  return ini >= 0 && fim > ini ? texto.slice(ini, fim + 1) : null;
}

function cortar(v: string, teto: number): string {
  const limpo = v.replace(/\s+/g, " ").trim();
  if (limpo.length <= teto) return limpo;
  const corte = limpo.slice(0, teto - 1);
  const espaco = corte.lastIndexOf(" ");
  return `${(espaco > teto * 0.6 ? corte.slice(0, espaco) : corte).replace(/[\s,;:.–-]+$/, "")}…`;
}

function texto(v: unknown, teto: number): string | null {
  if (typeof v !== "string") return null;
  const limpo = v.trim();
  return limpo ? cortar(limpo, teto) : null;
}

/** Número cru ou escrito ("1,47", "27%"); qualquer outra coisa é null. */
function numero(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const m = /-?\d+(?:[.,]\d+)?/.exec(v.replace(/\s/g, ""));
  if (!m) return null;
  const n = Number(m[0].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function unidade(v: unknown, rotulo: string): Achado["unidade"] {
  if (v === "%" || v === "n" || v === "") return v;
  return /precis|headshot|\bhs\b|vit[oó]ria|%/i.test(rotulo) ? "%" : "";
}

function achadoDe(o: unknown): Achado | null {
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  const rotulo = texto(r.rotulo, TETO.rotulo);
  const valor = numero(r.valor);
  if (!rotulo || valor === null) return null;
  return { rotulo, valor, referencia: numero(r.referencia), unidade: unidade(r.unidade, rotulo), nota: texto(r.nota, TETO.nota) };
}

function normalizar(o: unknown): AnaliseEstruturada | null {
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const r = o as Record<string, unknown>;
  const manchete = texto(r.manchete, TETO.manchete);
  if (!manchete) return null;
  const achados = (Array.isArray(r.achados) ? r.achados : []).map(achadoDe).filter((a): a is Achado => a !== null).slice(0, MAX_ACHADOS);
  return { manchete, achados, causa: texto(r.causa, TETO.causa), acao: texto(r.acao, TETO.acao) };
}

/** O conteúdo de uma string JSON (`"..."`) com os escapes resolvidos. */
function desescapar(cru: string): string {
  try {
    return JSON.parse(`"${cru}"`) as string;
  } catch {
    return cru.replace(/\\"/g, '"').replace(/\\n/g, " ");
  }
}

function campoTexto(fonte: string, nome: string): string | null {
  const m = new RegExp(`"${nome}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(fonte);
  return m ? desescapar(m[1]) : null;
}

function campoNumero(fonte: string, nome: string): number | null {
  const m = new RegExp(`"${nome}"\\s*:\\s*"?(-?\\d+(?:[.,]\\d+)?)`).exec(fonte);
  return m ? numero(m[1]) : null;
}

/**
 * A leitura de um JSON quebrado, campo a campo. Cada achado é lido de
 * dentro do seu próprio `{…}`; um campo ilegível perde só ele.
 */
function lerCampoACampo(fonte: string): AnaliseEstruturada | null {
  const manchete = campoTexto(fonte, "manchete");
  if (!manchete?.trim()) return null;
  const lista = /"achados"\s*:\s*\[([\s\S]*?)\]\s*(,|\})/.exec(fonte)?.[1] ?? "";
  const achados = [...lista.matchAll(/\{[^{}]*\}/g)]
    .map(([obj]) => {
      const rotulo = campoTexto(obj, "rotulo");
      const valor = campoNumero(obj, "valor");
      if (!rotulo || valor === null) return null;
      const r = cortar(rotulo, TETO.rotulo);
      return { rotulo: r, valor, referencia: campoNumero(obj, "referencia"), unidade: unidade(campoTexto(obj, "unidade"), r), nota: texto(campoTexto(obj, "nota"), TETO.nota) } satisfies Achado;
    })
    .filter((a): a is Achado => a !== null)
    .slice(0, MAX_ACHADOS);
  return {
    manchete: cortar(manchete, TETO.manchete),
    achados,
    causa: texto(campoTexto(fonte, "causa"), TETO.causa),
    acao: texto(campoTexto(fonte, "acao"), TETO.acao),
  };
}

const MAX_MANCHETE = 90;

export function lerAnalise(texto: string): AnaliseLida {
  const blocos = texto
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean)
    .flatMap(separarAcaoColada);

  let manchete: string | null = null;
  let acao: string | null = null;

  const primeiro = blocos[0];
  if (primeiro && blocos.length > 1) {
    const marcada = /^\*\*([^*\n]+)\*\*$/.exec(primeiro)?.[1] ?? /^#\s+([^\n]+)$/.exec(primeiro)?.[1] ?? null;
    if (marcada && marcada.trim().length <= MAX_MANCHETE && !marcada.trim().endsWith(":")) {
      manchete = marcada.trim();
      blocos.shift();
    }
  }
  const ultimo = blocos[blocos.length - 1];
  if (ultimo && /^(→|->|➜)\s*/.test(ultimo)) {
    acao = blocos.pop()!.replace(/^(→|->|➜)\s*/, "");
  }
  return { manchete, paragrafos: blocos, acao };
}

/** "→" no fim de um parágrafo, sem linha em branco antes, ainda é a ação. */
function separarAcaoColada(bloco: string): string[] {
  const linhas = bloco.split("\n");
  const i = linhas.findIndex((l, idx) => idx > 0 && /^(→|->|➜)\s*/.test(l.trim()));
  if (i === -1) return [bloco];
  return [linhas.slice(0, i).join("\n").trim(), linhas.slice(i).join(" ").trim()];
}
