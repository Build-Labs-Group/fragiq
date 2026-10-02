import { GetParameterCommand } from "@aws-sdk/client-ssm";
import { describe, expect, it, vi } from "vitest";
import { carregarParametro } from "../../aws/iniciar.mjs";

describe("boot da Lambda (aws/iniciar.mjs)", () => {
  it("lê o parâmetro decifrado e põe todas as chaves no ambiente, inclusive DATABASE_URL", async () => {
    const send = vi.fn<(comando: unknown) => Promise<{ Parameter?: { Value?: string } }>>(async () => ({
      Parameter: {
        Value: JSON.stringify({
          DATABASE_URL: "postgresql://u:p@h/db",
          AUTH_SECRET: " s ",
          CRON_SECRET: "c",
          VAZIO: "",
          NUMERO: 3,
        }),
      },
    }));
    const env: Record<string, string> = { AUTH_SECRET: "antigo" };
    const log = vi.fn();

    const chaves = await carregarParametro({ nome: "/fragiq/prod/site", ssm: { send }, GetParameterCommand, env, log });

    const comando = send.mock.calls[0][0] as unknown as GetParameterCommand;
    expect(comando.input).toEqual({ Name: "/fragiq/prod/site", WithDecryption: true });
    expect(chaves).toEqual(["DATABASE_URL", "AUTH_SECRET", "CRON_SECRET"]);
    expect(env).toMatchObject({
      DATABASE_URL: "postgresql://u:p@h/db",
      AUTH_SECRET: "s", // o segredo vence a variável
      CRON_SECRET: "c",
      FRAGIQ_SEGREDOS_CARREGADOS: "/fragiq/prod/site",
    });
    expect(env).not.toHaveProperty("VAZIO");
    // O log diz de onde veio e quantas chaves, nunca o valor.
    const texto = log.mock.calls.flat().join(" ");
    expect(texto).toContain("/fragiq/prod/site");
    expect(texto).not.toContain("postgresql://");
  });

  it("um erro do SSM sobe, para a Lambda falhar o init em vez de subir sem segredo", async () => {
    const send = vi.fn<(comando: unknown) => Promise<{ Parameter?: { Value?: string } }>>(async () => {
      throw Object.assign(new Error("negado"), { name: "AccessDeniedException" });
    });
    const env: Record<string, string> = {};
    await expect(
      carregarParametro({ nome: "/fragiq/prod/site", ssm: { send }, GetParameterCommand, env, log: () => {} }),
    ).rejects.toThrow("negado");
    expect(env).not.toHaveProperty("FRAGIQ_SEGREDOS_CARREGADOS");
  });
});
