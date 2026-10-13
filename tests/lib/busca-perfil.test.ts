import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A busca da home (`/api/perfil/buscar`) é pública e sem login, e cada
 * apelido novo é uma ida ao cogniflow e à Steam. Aqui: o cache de apelidos
 * e a diferença entre "perfil não existe" e "a Steam não respondeu".
 */
const resolveVanityUrl = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/eventos", () => ({ registrar: vi.fn(), reportarErro: vi.fn() }));
vi.mock("@/lib/steam/api", () => ({ resolveVanityUrl, getPlayerSummary: vi.fn(), getUserStatsForGame: vi.fn() }));

const STEAM_ID = "76561198000000001";

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-13T12:00:00Z"));
  resolveVanityUrl.mockReset();
  (await import("@/lib/perfil-publico")).zerarApelidos();
});
afterEach(() => vi.useRealTimers());

describe("resolverEntrada: cache de apelidos", () => {
  it("o mesmo apelido (qualquer caixa, ou como link) vai à Steam uma vez só", async () => {
    resolveVanityUrl.mockResolvedValue(STEAM_ID);
    const { resolverEntrada } = await import("@/lib/perfil-publico");
    expect(await resolverEntrada("Merudox")).toBe(STEAM_ID);
    expect(await resolverEntrada("merudox")).toBe(STEAM_ID);
    expect(await resolverEntrada("https://steamcommunity.com/id/MERUDOX/")).toBe(STEAM_ID);
    expect(resolveVanityUrl).toHaveBeenCalledTimes(1);
  });

  it("o que existe vale por uma hora; depois pergunta de novo", async () => {
    resolveVanityUrl.mockResolvedValue(STEAM_ID);
    const { resolverEntrada } = await import("@/lib/perfil-publico");
    await resolverEntrada("merudox");
    vi.advanceTimersByTime(59 * 60_000);
    await resolverEntrada("merudox");
    expect(resolveVanityUrl).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2 * 60_000);
    await resolverEntrada("merudox");
    expect(resolveVanityUrl).toHaveBeenCalledTimes(2);
  });

  it("o que não existe vale só 5 minutos, para quem acabou de criar o perfil", async () => {
    resolveVanityUrl.mockResolvedValue(null);
    const { resolverEntrada } = await import("@/lib/perfil-publico");
    expect(await resolverEntrada("ninguem")).toBeNull();
    expect(await resolverEntrada("ninguem")).toBeNull();
    expect(resolveVanityUrl).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(6 * 60_000);
    await resolverEntrada("ninguem");
    expect(resolveVanityUrl).toHaveBeenCalledTimes(2);
  });

  it("falha da Steam não entra no cache e é relançada", async () => {
    resolveVanityUrl.mockRejectedValueOnce(new Error("cogniflow 503")).mockResolvedValueOnce(STEAM_ID);
    const { resolverEntrada } = await import("@/lib/perfil-publico");
    await expect(resolverEntrada("merudox")).rejects.toThrow("cogniflow 503");
    expect(await resolverEntrada("merudox")).toBe(STEAM_ID);
    expect(resolveVanityUrl).toHaveBeenCalledTimes(2);
  });

  it("SteamID64 e entrada inválida não chegam à Steam", async () => {
    const { resolverEntrada } = await import("@/lib/perfil-publico");
    expect(await resolverEntrada(STEAM_ID)).toBe(STEAM_ID);
    expect(await resolverEntrada("   ")).toBeNull();
    expect(await resolverEntrada("a b!")).toBeNull();
    expect(resolveVanityUrl).not.toHaveBeenCalled();
  });
});

describe("GET /api/perfil/buscar", () => {
  async function buscar(q: string) {
    const { GET } = await import("@/app/api/perfil/buscar/route");
    const { NextRequest } = await import("next/server");
    const res = await GET(new NextRequest(`http://x/api/perfil/buscar?q=${encodeURIComponent(q)}`));
    return new URL(res.headers.get("location") ?? "").pathname + new URL(res.headers.get("location") ?? "").search;
  }

  it("achou: vai ao perfil", async () => {
    resolveVanityUrl.mockResolvedValue(STEAM_ID);
    expect(await buscar("merudox")).toBe(`/p/${STEAM_ID}`);
  });

  it("não existe: diz que não achou", async () => {
    resolveVanityUrl.mockResolvedValue(null);
    const destino = decodeURIComponent(await buscar("ninguem"));
    expect(destino).toContain("Não achei esse perfil");
  });

  it("a Steam falhou: diz que não conseguiu consultar, sem culpar o link", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    resolveVanityUrl.mockRejectedValue(new Error("cogniflow 503"));
    const destino = decodeURIComponent(await buscar("merudox"));
    expect(destino).toContain("Não consegui consultar a Steam agora");
    expect(destino).not.toContain("Não achei");
    expect(aviso).toHaveBeenCalled();
    aviso.mockRestore();
  });
});
