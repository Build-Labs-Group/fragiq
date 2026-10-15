import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import manifest from "@/app/manifest";
import { GtmHead, GtmNoscript } from "@/components/gtm";
import { GTM_ID_PADRAO, URL_PRODUCAO, gtmId, urlDoSite } from "@/lib/site";

/**
 * ADR 0008 da Build Labs: compartilhamento (og:image, ícones), robots,
 * sitemap e GTM com Consent Mode. Trava as regras para uma mudança futura
 * não derrubar o cartão do link nem soltar rastreio sem consentimento.
 */
const RAIZ = fileURLToPath(new URL("../../", import.meta.url));
const arquivo = (p: string) => join(RAIZ, p);

afterEach(() => vi.unstubAllEnvs());

describe("URL pública", () => {
  it("cai no domínio de produção quando APP_URL falta ou é localhost", () => {
    vi.stubEnv("APP_URL", "");
    expect(urlDoSite()).toBe(URL_PRODUCAO);
    vi.stubEnv("APP_URL", "http://localhost:3000");
    expect(urlDoSite()).toBe(URL_PRODUCAO);
  });
  it("robots e sitemap só citam URL absoluta https e nunca localhost", () => {
    vi.stubEnv("APP_URL", "http://localhost:3000");
    const r = robots();
    expect(JSON.stringify(r)).not.toMatch(/localhost/);
    expect(r.sitemap).toBe(`${URL_PRODUCAO}/sitemap.xml`);
    const urls = sitemap().map((s) => s.url);
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u).toMatch(/^https:\/\/fragiq\.buildlabs\.com\.br/);
  });
});

describe("metadados do layout", () => {
  // O layout importa a fonte Geist (next/font), que o vitest não resolve: confere-se o código-fonte.
  it("tem metadataBase, canonical, og e twitter summary_large_image", () => {
    const layout = readFileSync(arquivo("src/app/layout.tsx"), "utf8");
    expect(layout).toContain("metadataBase: new URL(urlDoSite())");
    expect(layout).toContain('alternates: { canonical: "./" }');
    expect(layout).toContain("siteName: NOME_DO_SITE");
    expect(layout).toContain('locale: "pt_BR"');
    expect(layout).toContain('card: "summary_large_image"');
  });
  it("imagem de compartilhamento 1200x630 e abaixo de 300 KB, em og e twitter", () => {
    for (const nome of ["opengraph-image.png", "twitter-image.png"]) {
      const caminho = arquivo(`src/app/${nome}`);
      expect(existsSync(caminho)).toBe(true);
      expect(statSync(caminho).size).toBeLessThan(300_000);
      const png = readFileSync(caminho);
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
    }
  });
  it("perfil e partida têm og:image dinâmica", () => {
    expect(existsSync(arquivo("src/app/p/[steamId]/opengraph-image.tsx"))).toBe(true);
    expect(existsSync(arquivo("src/app/partida/[id]/opengraph-image.tsx"))).toBe(true);
  });
});

describe("ícones e manifest", () => {
  it("existem favicon.ico, icon.svg, apple-icon e icon-192/512", () => {
    for (const p of ["src/app/favicon.ico", "src/app/icon.svg", "src/app/apple-icon.png", "public/icon-192.png", "public/icon-512.png"]) {
      expect(existsSync(arquivo(p)), p).toBe(true);
    }
    expect(readFileSync(arquivo("public/icon-512.png")).readUInt32BE(16)).toBe(512);
    expect(readFileSync(arquivo("public/icon-192.png")).readUInt32BE(16)).toBe(192);
  });
  it("o manifest aponta para os ícones 192 e 512", () => {
    const tamanhos = (manifest().icons ?? []).map((i) => i.sizes);
    expect(tamanhos).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  });
});

describe("GTM e consentimento", () => {
  it("usa o contêiner da Build Labs por padrão", () => {
    vi.stubEnv("NEXT_PUBLIC_GTM_ID", undefined as unknown as string);
    delete process.env.NEXT_PUBLIC_GTM_ID;
    expect(gtmId()).toBe(GTM_ID_PADRAO);
  });
  it("NEXT_PUBLIC_GTM_ID vazio ou inválido: o snippet não renderiza", () => {
    for (const v of ["", "abc"]) {
      vi.stubEnv("NEXT_PUBLIC_GTM_ID", v);
      expect(gtmId()).toBeNull();
      expect(renderToStaticMarkup(GtmHead() ?? null)).toBe("");
      expect(renderToStaticMarkup(GtmNoscript() ?? null)).toBe("");
    }
  });
  it("com ID: Consent Mode v2 negado antes do GTM, dataLayer com projeto e ambiente", () => {
    vi.stubEnv("NEXT_PUBLIC_GTM_ID", "GTM-ABCD1234");
    const html = renderToStaticMarkup(GtmHead()!);
    const iConsent = html.indexOf("'consent','default'");
    const iGtm = html.indexOf("googletagmanager.com/gtm.js");
    expect(iConsent).toBeGreaterThan(-1);
    expect(iGtm).toBeGreaterThan(iConsent);
    for (const k of ["ad_storage", "analytics_storage", "ad_user_data", "ad_personalization"]) expect(html).toContain(`${k}:'denied'`);
    expect(html).toContain("buildlabs_projeto:'fragiq'");
    expect(html).toContain("buildlabs_ambiente");
    expect(html).toContain("GTM-ABCD1234");
  });
  it("o layout carrega GTM, noscript e o banner em pt-BR em toda página", () => {
    const layout = readFileSync(arquivo("src/app/layout.tsx"), "utf8");
    for (const t of ["<GtmHead />", "<GtmNoscript />", "<BannerConsentimento />"]) expect(layout).toContain(t);
    const banner = readFileSync(arquivo("src/components/banner-consentimento.tsx"), "utf8");
    expect(banner).toContain("Aceitar");
    expect(banner).toContain("Recusar");
  });
});
