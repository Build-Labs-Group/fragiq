import type { NextConfig } from "next";

const emDesenvolvimento = process.env.NODE_ENV === "development";

/**
 * CSP completa, por enquanto só em Report-Only: o navegador avisa no console
 * o que ela bloquearia e não bloqueia nada. Os scripts inline do Next pedem
 * `'unsafe-inline'` até a página ganhar nonce; o próximo passo é observar o
 * console em produção e então promover para `Content-Security-Policy`.
 *
 * - imagens: avatares, ícones e itens vêm dos CDNs da Steam (`*.steamstatic.com`,
 *   `*.steampowered.com`, `*.akamaihd.net`);
 * - Vercel Analytics e Speed Insights servem do próprio domínio
 *   (`/_vercel/...`); `va.vercel-scripts.com` cobre o modo de depuração deles;
 * - o Cloudflare na frente do domínio injeta o beacon do Web Analytics dele
 *   (`static.cloudflareinsights.com`, que envia para `cloudflareinsights.com`);
 * - em `next dev`, o HMR precisa de `eval` e de WebSocket.
 */
const cspReportOnly = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com https://static.cloudflareinsights.com${emDesenvolvimento ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.steamstatic.com https://*.steampowered.com https://*.akamaihd.net",
  "font-src 'self' data:",
  `connect-src 'self' https://va.vercel-scripts.com https://cloudflareinsights.com${emDesenvolvimento ? " ws:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

/**
 * Em toda resposta. `frame-ancestors` é ignorado em Report-Only, por isso
 * vai sozinho numa CSP que bloqueia de verdade (junto do `X-Frame-Options`
 * para navegador antigo): nenhuma tela do FragIQ é feita para iframe, e
 * botões como seguir e sincronizar não podem ser clicados por baixo de
 * outra página.
 */
const cabecalhosDeSeguranca = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Content-Security-Policy-Report-Only", value: cspReportOnly },
];

/**
 * Build para a AWS (Lambda + Lambda Web Adapter, ver docs/migracao-site-build-labs.md):
 * `FRAGIQ_ALVO=aws next build` gera `.next/standalone`, um servidor Node com
 * só as dependências que as rotas usam. Na Vercel a variável não existe e o
 * build continua exatamente o de antes.
 */
const paraAws = process.env.FRAGIQ_ALVO === "aws";

/**
 * Na Vercel o HSTS vem da plataforma; na AWS ninguém o põe, então ele vai
 * aqui, com o mesmo valor que a Vercel manda (2 anos, sem subdomínios: a
 * zona buildlabs.com.br tem outros sites).
 */
const hsts = { key: "Strict-Transport-Security", value: "max-age=63072000" };

/** Imagens de mapa, radar e arma: mudam só quando `npm run assets:cs2` roda de novo. */
const ASSET_ESTATICO = "public, max-age=86400, stale-while-revalidate=604800";

const nextConfig: NextConfig = {
  // Todas as imagens já são `unoptimized` (vêm prontas dos CDNs da Steam); sem
  // otimizador, o pacote da Lambda não precisa do sharp, que é binário nativo.
  // `env` fixa FRAGIQ_ALVO no build, para o layout saber que não está na Vercel.
  ...(paraAws ? { output: "standalone" as const, images: { unoptimized: true }, env: { FRAGIQ_ALVO: "aws" } } : {}),
  poweredByHeader: false,
  experimental: {
    // O data cache (`src/lib/cache-dados.ts`) fica só na memória da
    // instância: o disco da Lambda é só leitura, e a chave já carrega a
    // versão dos dados, então não há o que persistir entre instâncias.
    isrFlushToDisk: false,
    // Voltar a uma aba vista há menos de 30 s não vai ao servidor. Sincronizar,
    // marcar modo e as outras ações chamam `router.refresh()`, que limpa isto.
    staleTimes: { dynamic: 30, static: 300 },
  },
  async redirects() {
    // As duas URLs antigas já circularam; resolvidas aqui, na borda, elas
    // não custam uma renderização nem um salto a mais pelo servidor.
    return [
      { source: "/cs2", destination: "/games/730", permanent: false },
      { source: "/dashboard", destination: "/games/730", permanent: false },
    ];
  },
  async headers() {
    return [
      { source: "/(.*)", headers: paraAws ? [...cabecalhosDeSeguranca, hsts] : cabecalhosDeSeguranca },
      { source: "/mapas/:path*", headers: [{ key: "Cache-Control", value: ASSET_ESTATICO }] },
      { source: "/cs2/:path*", headers: [{ key: "Cache-Control", value: ASSET_ESTATICO }] },
    ];
  },
};

export default nextConfig;
