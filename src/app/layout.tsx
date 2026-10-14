import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

/**
 * Geist vem do pacote `geist` (next/font/local), não do Google Fonts: o
 * arquivo já está no node_modules, então o build não depende de uma busca
 * de rede e a fonte sai do mesmo domínio, com preload e `font-display: swap`.
 */
const geistSans = GeistSans;
const geistMono = GeistMono;

export const metadata: Metadata = {
  title: "FragIQ — suas estatísticas de CS2 ao longo do tempo",
  description:
    "A Steam guarda só o total acumulado desde sempre. O FragIQ coleta periodicamente e mostra a diferença entre as coletas: 178 estatísticas de CS2 em série temporal, com leituras em português, painel fixo e todos os contadores comparados com o vitalício. Beta aberto.",
};

/**
 * A barra do navegador acompanha o tema do sistema, como o resto da
 * interface. Duas entradas com media query, e não um valor só: com um
 * valor só, o Safari pinta a barra de grafite numa página clara.
 */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f6f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0d10" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {/* Primeiro foco da página: quem navega por teclado ou leitor de tela pula o cabeçalho (WCAG 2.4.1). O elemento main de cada tela leva `id="conteudo"`. */}
        <a
          href="#conteudo"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-accent focus:ring-2 focus:ring-accent"
        >
          Pular para o conteúdo
        </a>
        {children}
        {/* Os scripts da Vercel só existem na Vercel (`/_vercel/...`); fora dela dariam 404 em toda página. */}
        {process.env.FRAGIQ_ALVO !== "aws" ? (
          <>
            <Analytics />
            <SpeedInsights />
          </>
        ) : null}
      </body>
    </html>
  );
}
