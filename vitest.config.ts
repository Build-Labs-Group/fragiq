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
    // O primeiro `import()` de uma rota (Prisma gerado, zod, Next) leva
    // mais de 5 s no Windows com a suíte inteira rodando em paralelo; sem
    // folga, o teste caía por tempo e o seguinte herdava os mocks dele.
    testTimeout: 20_000,
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
