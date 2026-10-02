import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * O build da AWS (`FRAGIQ_ALVO=aws`) muda o pacote, não o site: servidor
 * standalone, imagens sem otimizador e o HSTS que a Vercel punha. Sem a
 * variável — o build da Vercel — nada disso aparece.
 */
async function configCom(alvo: string | undefined) {
  vi.resetModules();
  if (alvo === undefined) vi.stubEnv("FRAGIQ_ALVO", "");
  else vi.stubEnv("FRAGIQ_ALVO", alvo);
  return (await import("../../next.config")).default;
}

async function cabecalhos(config: Awaited<ReturnType<typeof configCom>>) {
  const regras = (await config.headers?.()) ?? [];
  return new Map(regras.flatMap((r) => r.headers.map((h) => [h.key.toLowerCase(), h.value] as const)));
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("build para a AWS", () => {
  it("na Vercel (sem FRAGIQ_ALVO) o next.config é o de antes", async () => {
    const config = await configCom(undefined);
    expect(config.output).toBeUndefined();
    expect(config.images).toBeUndefined();
    // Sem FRAGIQ_ALVO no build, o layout mantém o Analytics e o Speed Insights da Vercel.
    expect(config.env).toBeUndefined();
    expect((await cabecalhos(config)).has("strict-transport-security")).toBe(false);
  });

  it("com FRAGIQ_ALVO=aws gera standalone, sem otimizador de imagem e com HSTS", async () => {
    const config = await configCom("aws");
    expect(config.output).toBe("standalone");
    expect(config.images?.unoptimized).toBe(true);
    expect(config.env?.FRAGIQ_ALVO).toBe("aws");
    const h = await cabecalhos(config);
    expect(h.get("strict-transport-security")).toBe("max-age=63072000");
    // Os outros cabeçalhos de segurança continuam iguais.
    expect(h.get("x-frame-options")).toBe("DENY");
  });
});
