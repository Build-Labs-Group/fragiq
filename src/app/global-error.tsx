"use client";

/**
 * Último recurso: o próprio layout raiz quebrou. Não há CSS do site aqui
 * (o layout é que o carrega), então o estilo vai inline, nas cores do tema
 * escuro.
 */
export default function ErroGlobal({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#0b0d10", color: "#eef0f3", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ textAlign: "center", padding: 24 }}>
          <p style={{ fontSize: 18, fontWeight: 600 }}>O FragIQ não conseguiu carregar.</p>
          <p style={{ color: "#a3a9b3", fontSize: 14 }}>Tente de novo em alguns segundos.</p>
          <button onClick={reset} style={{ marginTop: 16, padding: "8px 16px", borderRadius: 8, border: 0, background: "#ff6b3d", color: "#0b0d10", fontWeight: 600, cursor: "pointer" }}>
            Tentar de novo
          </button>
          {error.digest && <p style={{ marginTop: 20, fontSize: 12, color: "#7d8590" }}>código {error.digest}</p>}
        </div>
      </body>
    </html>
  );
}
