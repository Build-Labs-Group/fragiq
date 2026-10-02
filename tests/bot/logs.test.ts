import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O log do bot com o ritmo: em repouso, o envio periódico espera o turno
 * (`podeEnviar`), e o lote cheio e a despedida saem na hora.
 */
describe("logs do bot no repouso", () => {
  const originais = { log: console.log, warn: console.warn, error: console.error };
  let lotes: { linhas: { mensagem: string }[] }[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    // logs.ts guarda o console da importação: silencioso aqui, para o teste não imprimir as linhas.
    console.log = vi.fn();
    console.warn = vi.fn();
    console.error = vi.fn();
    lotes = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        lotes.push(JSON.parse(init.body));
        return new Response("{}", { status: 200 });
      }),
    );
  });

  afterEach(() => {
    Object.assign(console, originais);
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("o envio periódico só sai quando o ritmo deixa, e não gasta o turno com a fila vazia", async () => {
    const logs = await import("../../bot/src/logs");
    let pode = false;
    const podeEnviar = vi.fn(() => pode);
    logs.ligarLogs({ url: "https://site.test/api/bot/logs", secret: "s", podeEnviar });

    await logs.enviar(false);
    expect(podeEnviar).not.toHaveBeenCalled();

    logs.logar("INFO", "uma linha");
    await logs.enviar(false);
    expect(lotes).toHaveLength(0);

    pode = true;
    await logs.enviar(false);
    expect(lotes.map((l) => l.linhas.map((x) => x.mensagem))).toEqual([["uma linha"]]);
  });

  it("lote cheio sai na hora, mesmo em repouso", async () => {
    const logs = await import("../../bot/src/logs");
    logs.ligarLogs({ url: "https://site.test/api/bot/logs", secret: "s", podeEnviar: () => false });
    for (let i = 0; i < 50; i++) logs.logar("INFO", `linha ${i}`);
    await vi.waitFor(() => expect(lotes).toHaveLength(1));
    expect(lotes[0]!.linhas).toHaveLength(50);
  });

  it("a despedida manda o que sobrou, mesmo em repouso", async () => {
    const logs = await import("../../bot/src/logs");
    logs.ligarLogs({ url: "https://site.test/api/bot/logs", secret: "s", podeEnviar: () => false });
    logs.logar("WARN", "Encerrando…");
    await logs.despedirLogs();
    expect(lotes.map((l) => l.linhas.map((x) => x.mensagem))).toEqual([["Encerrando…"]]);
  });
});
