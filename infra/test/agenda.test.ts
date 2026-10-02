import { InvokeCommand } from "@aws-sdk/client-lambda";
import { describe, expect, it, vi } from "vitest";
import { eventoDoCron, rodarAgenda } from "../lambdas/agenda.ts";

const SEGREDO = "segredo-do-cron-de-teste";

function deps(resposta: { statusCode: number; body: string } | { erro: string }) {
  const ssm = { send: vi.fn(async () => ({ Parameter: { Value: JSON.stringify({ CRON_SECRET: SEGREDO, AUTH_SECRET: "x" }) } })) };
  const lambda = {
    send: vi.fn(async (_c: unknown) =>
      "erro" in resposta
        ? { FunctionError: "Unhandled", Payload: new TextEncoder().encode(JSON.stringify({ errorMessage: resposta.erro })) }
        : { Payload: new TextEncoder().encode(JSON.stringify(resposta)) },
    ),
  };
  const log = vi.fn();
  return {
    ssm,
    lambda,
    log,
    d: {
      ssm,
      lambda,
      log,
      funcaoDoSite: "fragiq-site",
      parametro: "/fragiq/prod/site",
      dominio: "fragiq.buildlabs.com.br",
      agora: () => new Date("2026-10-02T05:00:00Z"),
    } as never,
  };
}

describe("agenda diária", () => {
  it("invoca o site direto com GET /api/cron/sync e o Bearer do parâmetro", async () => {
    const corpo = JSON.stringify({ runId: "r1", candidates: 3, synced: 3, failed: 0, skipped: 0, snapshots: 2 });
    const { d, lambda, log } = deps({ statusCode: 200, body: corpo });

    expect(await rodarAgenda(d)).toMatchObject({ runId: "r1", synced: 3 });

    const comando = lambda.send.mock.calls[0]![0] as InvokeCommand;
    expect(comando.input.FunctionName).toBe("fragiq-site");
    const evento = JSON.parse(new TextDecoder().decode(comando.input.Payload as Uint8Array));
    expect(evento).toMatchObject({
      version: "2.0",
      rawPath: "/api/cron/sync",
      headers: { authorization: `Bearer ${SEGREDO}`, host: "fragiq.buildlabs.com.br" },
      requestContext: { http: { method: "GET", path: "/api/cron/sync" } },
    });
    // O log leva a resposta (contagens), nunca o segredo.
    const texto = JSON.stringify(log.mock.calls);
    expect(texto).toContain("r1");
    expect(texto).not.toContain(SEGREDO);
  });

  it("resposta que não é 200 vira erro, para o Scheduler e o alarme verem", async () => {
    const { d } = deps({ statusCode: 401, body: JSON.stringify({ error: "Não autorizado." }) });
    await expect(rodarAgenda(d)).rejects.toThrow(/respondeu 401/);
  });

  it("falha da Lambda do site vira erro com o motivo", async () => {
    const { d } = deps({ erro: "Task timed out after 300.00 seconds" });
    await expect(rodarAgenda(d)).rejects.toThrow(/timed out/);
  });

  it("o evento tem o formato da HTTP API (payload 2.0) que o Web Adapter entende", () => {
    const e = eventoDoCron("s", "fragiq-aws.buildlabs.com.br", new Date("2026-10-02T05:00:00Z"));
    expect(e.requestContext).toMatchObject({ domainName: "fragiq-aws.buildlabs.com.br", stage: "$default", timeEpoch: 1790917200000 });
    expect(e.isBase64Encoded).toBe(false);
  });
});
