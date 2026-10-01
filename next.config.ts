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

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: cabecalhosDeSeguranca }];
  },
};

export default nextConfig;
