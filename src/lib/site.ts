/**
 * Identidade pública do site (ADR 0008 da Build Labs): URL de produção,
 * nome e contêiner do Google Tag Manager. Um lugar só, para metadados,
 * robots, sitemap e rastreio não discordarem entre si.
 */

/** Domínio de produção. Nunca `localhost`: vai em og:image, canonical, robots e sitemap. */
export const URL_PRODUCAO = "https://fragiq.buildlabs.com.br";

export const NOME_DO_SITE = "FragIQ";

/** Contêiner único da Build Labs (não é segredo; o GA4 e o Pixel se configuram dentro dele). */
export const GTM_ID_PADRAO = "GTM-TTBSQVB6";

/** Slug do projeto em `_buildlabs/projetos.md`, enviado em todo evento do dataLayer. */
export const PROJETO_BUILDLABS = "fragiq";

/**
 * URL pública para metadados. `APP_URL` manda quando aponta para um domínio
 * de verdade; localhost (dev) cai no domínio de produção, para o HTML
 * compartilhado nunca citar um endereço local.
 */
export function urlDoSite(): string {
  const explicita = process.env.APP_URL?.trim().replace(/\/$/, "");
  if (explicita && /^https:\/\//.test(explicita) && !/localhost|127\.0\.0\.1/.test(explicita)) return explicita;
  return URL_PRODUCAO;
}

/**
 * ID do GTM. `NEXT_PUBLIC_GTM_ID` sobrepõe o padrão; definida vazia, desliga
 * o rastreio (o snippet não renderiza). Valor fora do formato `GTM-XXXX` também desliga.
 */
export function gtmId(): string | null {
  const env = process.env.NEXT_PUBLIC_GTM_ID;
  const id = (env === undefined ? GTM_ID_PADRAO : env).trim();
  return /^GTM-[A-Z0-9]{4,}$/.test(id) ? id : null;
}
