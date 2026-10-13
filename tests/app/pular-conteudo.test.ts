import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * "Pular para o conteúdo" (WCAG 2.4.1): o primeiro foco do teclado pula o
 * cabeçalho e as abas. O link mora no layout raiz e aponta para
 * `#conteudo`, então todo `<main>` do site tem de levar esse id; um `<main>`
 * novo sem ele deixaria o link sem destino naquela tela.
 */
const RAIZ = fileURLToPath(new URL("../../src/", import.meta.url));

function arquivosTsx(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    return statSync(caminho).isDirectory() ? arquivosTsx(caminho) : caminho.endsWith(".tsx") ? [caminho] : [];
  });
}

describe("pular para o conteúdo", () => {
  const layout = readFileSync(join(RAIZ, "app/layout.tsx"), "utf8");

  it("o layout raiz tem o link como primeiro elemento do body, em pt-BR", () => {
    expect(layout).toMatch(/<body[^>]*>[^]*?<a\s+href="#conteudo"/);
    expect(layout).toContain("Pular para o conteúdo");
  });

  it("o link só aparece quando recebe foco", () => {
    expect(layout).toMatch(/className="sr-only focus:not-sr-only/);
  });

  it("todo <main> do site leva id=\"conteudo\" e tabIndex={-1}", () => {
    const semId: string[] = [];
    let total = 0;
    for (const arquivo of arquivosTsx(RAIZ)) {
      for (const m of readFileSync(arquivo, "utf8").matchAll(/<main\b[^>]*>/g)) {
        total++;
        if (!m[0].includes('id="conteudo"') || !m[0].includes("tabIndex={-1}")) semId.push(`${arquivo}: ${m[0]}`);
      }
    }
    expect(total).toBeGreaterThan(10);
    expect(semId).toEqual([]);
  });

  it("as telas de erro e de 404 também têm o destino", () => {
    expect(readFileSync(join(RAIZ, "app/not-found.tsx"), "utf8")).toContain('<main id="conteudo"');
    expect(readFileSync(join(RAIZ, "app/error.tsx"), "utf8")).toContain('<main id="conteudo"');
  });
});
