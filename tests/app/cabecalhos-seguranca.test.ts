import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

/**
 * Cabeçalhos de segurança de toda resposta (FQ-0003). O teste lê a mesma
 * `headers()` que a Vercel aplica, então um cabeçalho que some do
 * `next.config.ts` quebra aqui antes de sumir de produção.
 */
async function cabecalhosDe(caminho: string): Promise<Map<string, string>> {
  const regras = (await nextConfig.headers?.()) ?? [];
  const valem = regras.filter((r) => new RegExp(`^${r.source.replace("(.*)", ".*")}$`).test(caminho));
  return new Map(valem.flatMap((r) => r.headers.map((h) => [h.key.toLowerCase(), h.value] as const)));
}

/** `"a x y; b z"` → `{ a: ["x", "y"], b: ["z"] }`. */
function diretivas(csp: string): Record<string, string[]> {
  return Object.fromEntries(
    csp
      .split(";")
      .map((d) => d.trim().split(/\s+/))
      .filter((d) => d[0])
      .map(([nome, ...valores]) => [nome, valores]),
  );
}

describe("cabeçalhos de segurança", () => {
  for (const caminho of ["/", "/cs2", "/partida/abc123", "/api/perfil/buscar"]) {
    it(`${caminho} recebe nosniff, referrer, permissions e proteção contra iframe`, async () => {
      const h = await cabecalhosDe(caminho);
      expect(h.get("x-content-type-options")).toBe("nosniff");
      expect(h.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
      expect(h.get("x-frame-options")).toBe("DENY");
      expect(diretivas(h.get("content-security-policy") ?? "")["frame-ancestors"]).toEqual(["'none'"]);
      const permissoes = h.get("permissions-policy") ?? "";
      for (const recurso of ["camera", "microphone", "geolocation", "payment", "usb"]) {
        expect(permissoes).toContain(`${recurso}=()`);
      }
    });
  }

  it("a CSP que bloqueia de verdade só cuida de iframe, para não quebrar nada", async () => {
    const h = await cabecalhosDe("/");
    expect(Object.keys(diretivas(h.get("content-security-policy") ?? ""))).toEqual(["frame-ancestors"]);
  });

  it("a CSP completa vem em Report-Only, com as exceções de Steam e Vercel", async () => {
    const csp = diretivas((await cabecalhosDe("/")).get("content-security-policy-report-only") ?? "");
    expect(csp["default-src"]).toEqual(["'self'"]);
    expect(csp["object-src"]).toEqual(["'none'"]);
    expect(csp["base-uri"]).toEqual(["'self'"]);
    expect(csp["form-action"]).toEqual(["'self'"]);
    expect(csp["img-src"]).toEqual(expect.arrayContaining(["'self'", "https://*.steamstatic.com"]));
    expect(csp["script-src"]).toEqual(expect.arrayContaining(["'self'", "https://va.vercel-scripts.com"]));
    expect(csp["connect-src"]).toEqual(expect.arrayContaining(["'self'"]));
    // O Cloudflare na frente do domínio injeta o beacon do Web Analytics em
    // toda página; sem isso a home avisa no console em produção.
    expect(csp["script-src"]).toContain("https://static.cloudflareinsights.com");
    expect(csp["connect-src"]).toContain("https://cloudflareinsights.com");
    // frame-ancestors é ignorado em Report-Only; ele mora na CSP que bloqueia.
    expect(csp["frame-ancestors"]).toBeUndefined();
  });

  it("não anuncia o framework", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
