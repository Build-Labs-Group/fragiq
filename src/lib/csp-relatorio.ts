/**
 * Relatórios de violação da CSP (Report-Only), em forma de log.
 *
 * O navegador manda um POST a cada violação, em dois formatos: o antigo
 * (`report-uri`, `application/csp-report`, `{ "csp-report": {...} }`) e o
 * novo (`report-to`, `application/reports+json`, lista de `{ type, body }`).
 * Aqui os dois viram a mesma coisa: `{ diretiva, bloqueado, documento }`.
 *
 * Duas regras de privacidade e de custo:
 * - URL sai sem query e sem hash (um `?q=` ou um token na barra não vão
 *   para o log);
 * - o mesmo par (diretiva, bloqueado) é registrado uma vez por janela por
 *   instância, com a contagem do que foi suprimido. Uma violação em toda
 *   página não vira uma linha de log por visita.
 */

export type Violacao = {
  diretiva: string;
  bloqueado: string;
  documento: string;
};

const MAX_CAMPO = 200;

/** `https://x.com/a?b=1#c` → `https://x.com/a`; `inline`, `eval` e `data` passam como estão. */
export function limparUrl(valor: unknown): string {
  if (typeof valor !== "string" || !valor) return "";
  const texto = valor.slice(0, 2000);
  try {
    const u = new URL(texto);
    return `${u.origin}${u.pathname}`.slice(0, MAX_CAMPO);
  } catch {
    return texto.replace(/[?#].*$/, "").slice(0, MAX_CAMPO);
  }
}

function deRelatorio(r: unknown): Violacao | null {
  if (!r || typeof r !== "object") return null;
  const o = r as Record<string, unknown>;
  // O formato novo usa camelCase, o antigo usa kebab-case.
  const diretiva = o["effectiveDirective"] ?? o["effective-directive"] ?? o["violated-directive"] ?? o["violatedDirective"];
  if (typeof diretiva !== "string" || !diretiva) return null;
  return {
    diretiva: diretiva.split(/\s+/)[0].slice(0, 40),
    bloqueado: limparUrl(o["blockedURL"] ?? o["blocked-uri"] ?? o["blockedUri"]) || "(vazio)",
    documento: limparUrl(o["documentURL"] ?? o["document-uri"] ?? o["documentUri"]),
  };
}

/** Aceita o corpo já lido como JSON nos dois formatos; devolve só o que entendeu (no máximo 20). */
export function violacoesDoCorpo(corpo: unknown): Violacao[] {
  const itens: unknown[] = Array.isArray(corpo)
    ? corpo.map((e) => (e && typeof e === "object" ? ((e as Record<string, unknown>)["body"] ?? null) : null))
    : corpo && typeof corpo === "object"
      ? [(corpo as Record<string, unknown>)["csp-report"] ?? null]
      : [];
  return itens
    .slice(0, 20)
    .map(deRelatorio)
    .filter((v): v is Violacao => v !== null);
}

const JANELA_MS = 10 * 60_000;
const MAX_CHAVES = 500;
const vistas = new Map<string, { desde: number; suprimidas: number }>();

/**
 * Quais violações merecem uma linha de log agora. Devolve a violação e
 * quantas iguais ficaram de fora desde a última linha.
 */
export function aRegistrar(violacoes: Violacao[], agora = Date.now()): { violacao: Violacao; suprimidas: number }[] {
  const saida: { violacao: Violacao; suprimidas: number }[] = [];
  for (const v of violacoes) {
    const chave = `${v.diretiva}|${v.bloqueado}`;
    const visto = vistas.get(chave);
    if (visto && agora - visto.desde < JANELA_MS) {
      visto.suprimidas += 1;
      continue;
    }
    if (!visto && vistas.size >= MAX_CHAVES) vistas.clear();
    saida.push({ violacao: v, suprimidas: visto?.suprimidas ?? 0 });
    vistas.set(chave, { desde: agora, suprimidas: 0 });
  }
  return saida;
}

/** Só para os testes. */
export function zerarJanela() {
  vistas.clear();
}
