import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * FQ-0004: `.hud` fora de `@layer` vencia os utilitários do Tailwind 4, e o
 * selo "beta" (`hud text-accent text-[10px]`) saía cinza e com 11px. A regra
 * tem de morar em `@layer components`, que perde para `@layer utilities`.
 */
const css = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** Conteúdo do bloco `{ ... }` que começa em `abre` (índice do `{`), com chaves aninhadas. */
function bloco(abre: number): string {
  let fundo = 0;
  for (let i = abre; i < css.length; i++) {
    if (css[i] === "{") fundo++;
    if (css[i] === "}" && --fundo === 0) return css.slice(abre + 1, i);
  }
  throw new Error("bloco sem fechamento");
}

describe(".hud e as camadas do Tailwind (FQ-0004)", () => {
  it("a regra .hud está dentro de @layer components", () => {
    const camadas = [...css.matchAll(/@layer components\s*\{/g)];
    expect(camadas.length).toBeGreaterThan(0);
    const dentro = camadas.some((m) => /(^|\s)\.hud\s*\{/.test(bloco(m.index! + m[0].length - 1)));
    expect(dentro).toBe(true);
  });

  it("não sobra nenhuma .hud solta, fora de camada", () => {
    // Tira os blocos @layer e confere que a regra não aparece no que restou.
    let resto = css;
    for (const m of [...css.matchAll(/@layer [\w, ]+\{/g)].reverse()) {
      const abre = m.index! + m[0].length - 1;
      resto = resto.slice(0, m.index!) + resto.slice(abre + bloco(abre).length + 2);
    }
    expect(resto).not.toMatch(/(^|\n)\.hud\s*\{/);
  });

  it("sem cor nem tamanho explícitos, o padrão continua --ink-faint a 11px", () => {
    const m = css.match(/@layer components\s*\{[^]*?\.hud\s*\{([^}]*)\}/);
    expect(m?.[1]).toContain("color: var(--ink-faint)");
    expect(m?.[1]).toContain("font-size: 11px");
  });
});
