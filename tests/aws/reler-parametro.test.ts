import { GetParameterCommand } from "@aws-sdk/client-ssm";
import { describe, expect, it, vi } from "vitest";
import { carregarParametro } from "../../aws/iniciar.mjs";
import { comReleitura } from "../../scripts/aws/reler-parametro.mjs";

describe("troca do banco pelo parâmetro (docs/migracao-banco-aws.md)", () => {
  it("reler-parametro mantém as variáveis da função e só troca a marca SEGREDO_RELIDO", () => {
    const antes = { FRAGIQ_SECRET_PARAM: "/fragiq/prod/site", APP_URL: "https://fragiq.buildlabs.com.br", SEGREDO_RELIDO: "velho" };
    expect(comReleitura(antes, new Date("2026-10-11T15:30:12.345Z"))).toEqual({
      FRAGIQ_SECRET_PARAM: "/fragiq/prod/site",
      APP_URL: "https://fragiq.buildlabs.com.br",
      SEGREDO_RELIDO: "2026-10-11T15:30:12Z",
    });
    expect(antes.SEGREDO_RELIDO).toBe("velho");
  });

  it("o boot leva a CA do servidor (PEM de várias linhas) do parâmetro para o ambiente, inteira", async () => {
    const ca = "-----BEGIN CERTIFICATE-----\nMIIB\nAAA=\n-----END CERTIFICATE-----\n";
    const send = vi.fn(async () => ({
      Parameter: { Value: JSON.stringify({ DATABASE_URL: "postgresql://fragiq:s@10.42.2.10:6432/fragiq?sslmode=require&pgbouncer=true", DATABASE_SSL_CA: ca }) },
    }));
    const env: Record<string, string> = {};
    await carregarParametro({ nome: "/fragiq/prod/site", ssm: { send }, GetParameterCommand, env, log: () => {} });
    expect(env.DATABASE_SSL_CA).toBe(ca.trim());
    expect(env.DATABASE_SSL_CA.split("\n")).toHaveLength(4);
  });
});
