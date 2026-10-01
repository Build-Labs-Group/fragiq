import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Contraste dos tokens de texto contra os fundos em que eles aparecem, nos
 * dois temas. A conta é a do WCAG 2 (a mesma do axe), lida direto de
 * `globals.css`: trocar um token por um que não alcança 4,5:1 quebra aqui,
 * antes de chegar à home (FQ-0002).
 */
const css = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");

/** Variáveis `--x: #rrggbb;` do primeiro bloco `:root { ... }` a partir de `inicio`. */
function tokens(inicio: number): Record<string, string> {
  const abre = css.indexOf(":root {", inicio);
  const fecha = css.indexOf("}", abre);
  const bloco = css.slice(abre, fecha);
  return Object.fromEntries([...bloco.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1], m[2].toLowerCase()]));
}

const claro = tokens(0);
const escuro = tokens(css.indexOf("@media (prefers-color-scheme: dark)"));

function luminancia(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function razao(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Texto pequeno (o `.hud` tem 11px), então vale o mínimo de 4,5:1. */
const MINIMO = 4.5;
const TEXTOS = ["ink", "ink-muted", "ink-faint", "accent"];
const FUNDOS = ["canvas", "surface", "surface-2", "accent-soft"];

/** Fundo do cabeçalho translúcido da home sobre o brilho do hero, como o axe mediu em produção. */
const CABECALHO_DA_HOME = "#f2eae8";

describe("contraste dos tokens de texto", () => {
  it("lê os tokens dos dois temas", () => {
    for (const t of [...TEXTOS, ...FUNDOS]) {
      expect(claro[t], `claro --${t}`).toMatch(/^#/);
      expect(escuro[t], `escuro --${t}`).toMatch(/^#/);
    }
    expect(claro["ink-faint"]).not.toBe(escuro["ink-faint"]);
  });

  for (const [tema, cores] of [["claro", claro], ["escuro", escuro]] as const) {
    for (const texto of TEXTOS) {
      for (const fundo of FUNDOS) {
        it(`${tema}: --${texto} sobre --${fundo} alcança ${MINIMO}:1`, () => {
          expect(razao(cores[texto], cores[fundo])).toBeGreaterThanOrEqual(MINIMO);
        });
      }
    }
  }

  it("claro: logo e rótulos do cabeçalho da home alcançam 4,5:1", () => {
    expect(razao(claro["accent"], CABECALHO_DA_HOME)).toBeGreaterThanOrEqual(MINIMO);
    expect(razao(claro["ink-faint"], CABECALHO_DA_HOME)).toBeGreaterThanOrEqual(MINIMO);
  });

  it("a conta bate com a referência do WCAG", () => {
    expect(razao("#000000", "#ffffff")).toBeCloseTo(21, 5);
    // Valor que o axe mediu na home antes da correção.
    expect(razao("#7c8695", "#f5f6f8")).toBeCloseTo(3.41, 2);
  });
});
