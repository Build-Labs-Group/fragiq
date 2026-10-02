import { GetParameterCommand } from "@aws-sdk/client-ssm";
import { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { definirFontesDeSegredo, segredo, segredoOpcional } from "@/lib/segredos";

/**
 * A ordem das fontes (docs/migracao-site-build-labs.md): SSM da Build Labs
 * primeiro, Secrets Manager da conta pessoal como volta, `.env` por último.
 * Nenhum teste fala com a AWS: os clientes são trocados por falsos.
 */
const VARIAVEIS = [
  "FRAGIQ_SECRET_PARAM",
  "FRAGIQ_SECRET_ID",
  "FRAGIQ_SEGREDOS_CARREGADOS",
  "AWS_ROLE_ARN",
  "AUTH_SECRET",
  "COGNIFLOW_SIGNING_SECRET",
  "BOT_WEBHOOK_SECRET",
];

function clientes(valores: { ssm?: object; sm?: object }) {
  const ssm = vi.fn(async (cmd: unknown) => {
    expect(cmd).toBeInstanceOf(GetParameterCommand);
    expect((cmd as GetParameterCommand).input.WithDecryption).toBe(true);
    return { Parameter: { Value: JSON.stringify(valores.ssm ?? {}) } };
  });
  const sm = vi.fn(async (cmd: unknown) => {
    expect(cmd).toBeInstanceOf(GetSecretValueCommand);
    return { SecretString: JSON.stringify(valores.sm ?? {}) };
  });
  definirFontesDeSegredo({ ssm: () => ({ send: ssm }) as never, secretsManager: () => ({ send: sm }) as never });
  return { ssm, sm };
}

let guardado: Record<string, string | undefined>;

beforeEach(() => {
  guardado = Object.fromEntries(VARIAVEIS.map((v) => [v, process.env[v]]));
  for (const v of VARIAVEIS) delete process.env[v];
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  for (const [v, valor] of Object.entries(guardado)) {
    if (valor === undefined) delete process.env[v];
    else process.env[v] = valor;
  }
  definirFontesDeSegredo(null);
  vi.restoreAllMocks();
});

describe("segredos", () => {
  it("com FRAGIQ_SECRET_PARAM lê do SSM, decifrado, e não toca o Secrets Manager", async () => {
    process.env.FRAGIQ_SECRET_PARAM = "/fragiq/prod/site";
    process.env.FRAGIQ_SECRET_ID = "cogniflow/tenants/fragiq";
    const { ssm, sm } = clientes({ ssm: { AUTH_SECRET: "do-ssm" }, sm: { AUTH_SECRET: "do-secrets-manager" } });

    expect(await segredo("AUTH_SECRET")).toBe("do-ssm");
    expect(ssm).toHaveBeenCalledTimes(1);
    expect((ssm.mock.calls[0][0] as GetParameterCommand).input.Name).toBe("/fragiq/prod/site");
    expect(sm).not.toHaveBeenCalled();
  });

  it("sem o parâmetro cai no Secrets Manager, o caminho atual da Vercel", async () => {
    process.env.FRAGIQ_SECRET_ID = "cogniflow/tenants/fragiq";
    const { ssm, sm } = clientes({ sm: { BOT_WEBHOOK_SECRET: "do-secrets-manager" } });

    expect(await segredo("BOT_WEBHOOK_SECRET")).toBe("do-secrets-manager");
    expect(sm).toHaveBeenCalledTimes(1);
    expect(ssm).not.toHaveBeenCalled();
  });

  it("chave que falta na fonte usa o ambiente e avisa só o nome, nunca o valor", async () => {
    process.env.FRAGIQ_SECRET_PARAM = "/fragiq/prod/site";
    process.env.COGNIFLOW_SIGNING_SECRET = "do-ambiente";
    clientes({ ssm: { AUTH_SECRET: "x".repeat(40) } });

    expect(await segredoOpcional("COGNIFLOW_SIGNING_SECRET")).toBe("do-ambiente");
    expect(await segredoOpcional("BOT_WEBHOOK_SECRET")).toBeNull();
    const avisos = vi.mocked(console.warn).mock.calls.flat().join(" ");
    expect(avisos).toContain("BOT_WEBHOOK_SECRET");
    expect(avisos).not.toContain("x".repeat(40));
  });

  it("se o boot da Lambda já carregou, não lê de novo", async () => {
    process.env.FRAGIQ_SECRET_PARAM = "/fragiq/prod/site";
    process.env.FRAGIQ_SEGREDOS_CARREGADOS = "/fragiq/prod/site";
    process.env.AUTH_SECRET = "posto-pelo-boot";
    const { ssm } = clientes({ ssm: { AUTH_SECRET: "outro" } });

    expect(await segredo("AUTH_SECRET")).toBe("posto-pelo-boot");
    expect(ssm).not.toHaveBeenCalled();
  });

  it("uma falha não fica em cache: a próxima leitura tenta de novo", async () => {
    process.env.FRAGIQ_SECRET_PARAM = "/fragiq/prod/site";
    let vez = 0;
    const send = vi.fn(async () => {
      vez++;
      if (vez === 1) throw new Error("ThrottlingException");
      return { Parameter: { Value: JSON.stringify({ AUTH_SECRET: "segunda" }) } };
    });
    definirFontesDeSegredo({ ssm: () => ({ send }) as never, secretsManager: () => ({ send }) as never });

    await expect(segredo("AUTH_SECRET")).rejects.toThrow("ThrottlingException");
    expect(await segredo("AUTH_SECRET")).toBe("segunda");
  });

  it("sem fonte nenhuma, vale o .env (modo dev)", async () => {
    process.env.AUTH_SECRET = "do-env";
    const { ssm, sm } = clientes({});
    expect(await segredo("AUTH_SECRET")).toBe("do-env");
    expect(ssm).not.toHaveBeenCalled();
    expect(sm).not.toHaveBeenCalled();
    await expect(segredo("BOT_WEBHOOK_SECRET")).rejects.toThrow(/não está em/);
  });
});
