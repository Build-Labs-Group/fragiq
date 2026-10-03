import { defineConfig, devices } from "@playwright/test";

/**
 * E2E contra o app local: banco com `npm run seed`, login por
 * `/api/auth/dev-login` e sem as variáveis `COGNIFLOW_*` (então toda
 * leitura da Steam falha, que é o cenário que estes testes cobrem).
 * `E2E_BASE_URL` aponta para um servidor já de pé; sem ela, sobe o `next dev`.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
    { name: "celular", use: { ...devices["iPhone 13"], browserName: "chromium", viewport: { width: 390, height: 844 } } },
  ],
  webServer: process.env.E2E_BASE_URL ? undefined : { command: "npm run dev", url: baseURL, reuseExistingServer: true, timeout: 120_000 },
});
