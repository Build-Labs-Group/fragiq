import { ImageResponse } from "next/og";

export const TAMANHO_OG = { width: 1200, height: 630 } as const;

/**
 * Cartão 1200x630 de marca para páginas dinâmicas (perfil, partida): título
 * grande, linha de apoio e o domínio. Só texto (sem buscar imagem de fora),
 * para a resposta ser rápida e nunca falhar por causa de um CDN.
 */
export function cartaoOg(titulo: string, apoio: string, destaque?: string) {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#0b0d10", color: "#eef0f3", padding: 80 }}>
        <div style={{ display: "flex", fontSize: 56, fontWeight: 700 }}>
          Frag<span style={{ color: "#ff6b3d" }}>IQ</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {destaque ? <div style={{ display: "flex", fontSize: 40, color: "#ff6b3d", marginBottom: 12 }}>{destaque}</div> : null}
          <div style={{ display: "flex", fontSize: 84, fontWeight: 700, lineHeight: 1.1 }}>{titulo.slice(0, 40)}</div>
          <div style={{ display: "flex", fontSize: 38, color: "#a3a9b3", marginTop: 20 }}>{apoio}</div>
        </div>
        <div style={{ display: "flex", fontSize: 28, color: "#ff6b3d" }}>fragiq.buildlabs.com.br</div>
      </div>
    ),
    { ...TAMANHO_OG },
  );
}
