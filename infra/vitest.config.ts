import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Os testes da pilha empacotam as Lambdas com esbuild; no Windows isso passa de 5 s.
    testTimeout: 120_000,
  },
});
