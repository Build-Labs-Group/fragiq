# Compartilhamento e rastreio (ADR 0008 da Build Labs)

- **GTM**: contêiner único da Build Labs, `GTM-TTBSQVB6` (padrão em `src/lib/site.ts`). `NEXT_PUBLIC_GTM_ID` sobrepõe; definida vazia, o snippet não renderiza. O `dataLayer` nasce com `buildlabs_projeto='fragiq'` e `buildlabs_ambiente` (`producao` no domínio de produção). GA4 e Pixel se configuram dentro do GTM, nunca no código.
- **LGPD**: Consent Mode v2 com `ad_storage`, `analytics_storage`, `ad_user_data` e `ad_personalization` em `denied` antes do GTM carregar; o banner (`src/components/banner-consentimento.tsx`) grava a escolha em `localStorage` (`buildlabs_consent`). A CSP em Report-Only já inclui os domínios do Google.
- **Metadados**: `metadataBase` = `urlDoSite()` (produção; nunca localhost), canonical por rota, og/twitter `summary_large_image`. Imagens: `opengraph-image.png`/`twitter-image.png` (1200x630, geradas por `node scripts/gerar-marca.mjs` a partir de `icon.svg`), mais imagem dinâmica em `/p/[steamId]` e `/partida/[id]` (`src/lib/og-imagem.tsx`, cai no cartão de marca se o dado falhar).
- **Ícones**: `favicon.ico`, `icon.svg`, `apple-icon.png`, `public/icon-192.png`/`icon-512.png`, `manifest.webmanifest`.
- **robots.txt / sitemap.xml**: `src/app/robots.ts` e `sitemap.ts`, sempre com a URL de produção.
- **Trava**: `tests/app/compartilhamento-rastreio.test.ts`. Conferência em produção: `node _buildlabs/bin/verificar-head.mjs https://fragiq.buildlabs.com.br`.
