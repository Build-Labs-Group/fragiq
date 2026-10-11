import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Só a lógica pura: series, leituras, analista, delta, analise-texto. Nada
 * aqui toca banco, Steam ou cogniflow — o que precisa deles é homologado
 * por curl assinado, como descreve docs/cogniflow-tenant.md.
 */
export default defineConfig({
  // Componentes (.tsx) renderizados em teste usam o JSX automático do Next.
  esbuild: { jsx: "automatic" },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
