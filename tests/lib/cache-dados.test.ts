import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O cache por versão (src/lib/cache-dados.ts): a chave carrega a versão dos
 * dados, o JSON do cache devolve as datas como `Date`, e fora do Next a
 * leitura vai direto ao banco.
 *
 * O `unstable_cache` é trocado por um mapa em memória com a mesma semântica
 * que importa aqui: chave = partes, valor passa por JSON.
 */
const memoria = new Map<string, string>();
let semNext = false;

vi.mock("next/cache", () => ({
  unstable_cache: (ler: () => Promise<unknown>, partes: string[]) => async () => {
    if (semNext) throw new Error("Invariant: incrementalCache missing in unstable_cache () => {}");
    const k = JSON.stringify(partes);
    if (!memoria.has(k)) memoria.set(k, JSON.stringify(await ler()));
    return JSON.parse(memoria.get(k)!);
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { lerComVersao, reviverDatas } = await import("@/lib/cache-dados");

describe("cache por versão dos dados", () => {
  beforeEach(() => {
    memoria.clear();
    semNext = false;
  });

  it("mesma versão não relê; versão nova relê", async () => {
    const ler = vi.fn(async () => ({ total: ler.mock.calls.length }));
    const a = await lerComVersao({ nome: "t", chave: ["u1"], versao: "v1", ler });
    const b = await lerComVersao({ nome: "t", chave: ["u1"], versao: "v1", ler });
    expect(ler).toHaveBeenCalledTimes(1);
    expect(b).toEqual(a);

    await lerComVersao({ nome: "t", chave: ["u1"], versao: "v2", ler });
    expect(ler).toHaveBeenCalledTimes(2);
  });

  it("jogadores diferentes nunca dividem a entrada", async () => {
    const ler1 = vi.fn(async () => "do u1");
    const ler2 = vi.fn(async () => "do u2");
    expect(await lerComVersao({ nome: "t", chave: ["u1"], versao: "v1", ler: ler1 })).toBe("do u1");
    expect(await lerComVersao({ nome: "t", chave: ["u2"], versao: "v1", ler: ler2 })).toBe("do u2");
  });

  it("as datas voltam como Date, iguais às gravadas", async () => {
    const quando = new Date("2026-10-04T22:53:00Z");
    const ler = async () => [{ id: "s1", capturedAt: quando }];
    const linhas = await lerComVersao({ nome: "t", chave: ["u1"], versao: "v1", ler, reviver: (ls) => ls.map((l) => reviverDatas(l, ["capturedAt"])) });
    expect(linhas[0].capturedAt).toBeInstanceOf(Date);
    expect(linhas[0].capturedAt.getTime()).toBe(quando.getTime());
  });

  it("fora do Next (script, teste) lê direto, sem quebrar", async () => {
    semNext = true;
    const ler = vi.fn(async () => 42);
    expect(await lerComVersao({ nome: "t", chave: ["u1"], versao: "v1", ler })).toBe(42);
  });

  it("erro da leitura não é engolido", async () => {
    await expect(lerComVersao({ nome: "t", chave: ["u1"], versao: "v1", ler: async () => Promise.reject(new Error("banco caiu")) })).rejects.toThrow("banco caiu");
  });
});
