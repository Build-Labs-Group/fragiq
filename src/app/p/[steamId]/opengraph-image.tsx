import { carregarPerfilPublico, pareceSteamId } from "@/lib/perfil-publico";
import { cartaoOg, TAMANHO_OG } from "@/lib/og-imagem";

export const dynamic = "force-dynamic";
export const alt = "Perfil de CS2 no FragIQ";
export const size = TAMANHO_OG;
export const contentType = "image/png";

/** Imagem de compartilhamento do perfil público: nome do jogador e horas; qualquer falha cai no cartão de marca. */
export default async function Imagem({ params }: { params: Promise<{ steamId: string }> }) {
  const { steamId } = await params;
  const id = decodeURIComponent(steamId);
  const perfil = pareceSteamId(id) ? await carregarPerfilPublico(id).catch(() => null) : null;
  const jogador = perfil && "jogador" in perfil ? perfil.jogador : null;
  const horas = perfil?.estado === "ok" ? `${Math.round(perfil.horas).toLocaleString("pt-BR")} h de CS2` : undefined;
  return cartaoOg(jogador?.personaname ?? "Perfil de CS2", "Estatísticas de CS2 ao longo do tempo", horas);
}
