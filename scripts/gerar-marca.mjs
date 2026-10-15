/**
 * Gera as imagens de marca a partir de `src/app/icon.svg`:
 * apple-icon (180), icon-192/512 (public) e a imagem de compartilhamento
 * 1200x630 (opengraph-image e twitter-image). Rode `node scripts/gerar-marca.mjs`
 * quando a marca mudar e versione os PNGs.
 */
import sharp from "sharp";
import { readFileSync } from "node:fs";

const svg = readFileSync("src/app/icon.svg");
const png = (n) => sharp(svg, { density: 600 }).resize(n, n).png({ compressionLevel: 9 });
await png(180).toFile("src/app/apple-icon.png");
await png(192).toFile("public/icon-192.png");
await png(512).toFile("public/icon-512.png");

const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs><radialGradient id="g" cx="80%" cy="20%" r="70%"><stop offset="0" stop-color="#ff6b3d" stop-opacity=".28"/><stop offset="1" stop-color="#0b0d10" stop-opacity="0"/></radialGradient></defs>
<rect width="1200" height="630" fill="#0b0d10"/><rect width="1200" height="630" fill="url(#g)"/>
<g transform="translate(90 90) scale(1.5)"><rect width="64" height="64" rx="14" fill="#13161a"/><g fill="none" stroke="#ff6b3d" stroke-width="5" stroke-linecap="round"><circle cx="32" cy="32" r="16"/><path d="M32 6v12M32 46v12M6 32h12M46 32h12"/></g><circle cx="32" cy="32" r="4" fill="#ff6b3d"/></g>
<text x="90" y="330" font-family="Arial, Helvetica, sans-serif" font-size="120" font-weight="700" fill="#eef0f3">Frag<tspan fill="#ff6b3d">IQ</tspan></text>
<text x="90" y="420" font-family="Arial, Helvetica, sans-serif" font-size="44" fill="#eef0f3">Suas estatísticas de CS2 ao longo do tempo</text>
<text x="90" y="490" font-family="Arial, Helvetica, sans-serif" font-size="30" fill="#a3a9b3">178 estatísticas em série temporal, leituras em português</text>
<text x="90" y="570" font-family="Arial, Helvetica, sans-serif" font-size="28" fill="#ff6b3d">fragiq.buildlabs.com.br</text></svg>`;
for (const nome of ["opengraph-image", "twitter-image"]) {
  await sharp(Buffer.from(og)).png({ palette: true, compressionLevel: 9 }).toFile(`src/app/${nome}.png`);
}
