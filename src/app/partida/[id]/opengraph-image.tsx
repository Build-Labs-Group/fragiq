import { carregarScoreboard } from "@/lib/partidas";
import { rotularMapa } from "@/lib/cs2-labels";
import { cartaoOg, TAMANHO_OG } from "@/lib/og-imagem";

export const dynamic = "force-dynamic";
export const alt = "Partida de CS2 no FragIQ";
export const size = TAMANHO_OG;
export const contentType = "image/png";

/** Imagem de compartilhamento da partida: mapa e placar; qualquer falha cai no cartão de marca. */
export default async function Imagem({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await carregarScoreboard(id).catch(() => null);
  if (!p) return cartaoOg("Partida de CS2", "Placar e leituras da partida");
  return cartaoOg(p.mapa ? rotularMapa(p.mapa) : "Partida de CS2", `Placar ${p.placar[0]} x ${p.placar[1]}`, "Partida no FragIQ");
}
