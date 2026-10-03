import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

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
