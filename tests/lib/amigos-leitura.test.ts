import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A lista de amigos da Steam vem do cogniflow; quando essa leitura falha,
 * `/amigos` continua de pé com o que é só nosso (seguindo e seguidores) e
 * a falha vai para o diário.
 */
const getFriendIds = vi.fn();
const reportarErro = vi.fn();
const findMany = vi.fn();

vi.mock("@/lib/steam/api", () => ({ getFriendIds }));
vi.mock("@/lib/eventos", () => ({ reportarErro }));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findMany }, follow: { findMany: vi.fn().mockResolvedValue([]) } },
}));

beforeEach(() => vi.clearAllMocks());

describe("amigosNoFragiq", () => {
  it("falha na leitura da Steam não derruba a página: vira leituraFalhou e fica no diário", async () => {
    const { amigosNoFragiq } = await import("@/lib/social");
    const erro = new Error("cogniflow fora");
    getFriendIds.mockRejectedValueOnce(erro);

    const r = await amigosNoFragiq("user_1", "76561198000000001");

    expect(r).toEqual({ amigos: [], listaPrivada: false, leituraFalhou: true, totalAmigos: 0 });
    expect(reportarErro).toHaveBeenCalledWith("amigos.leitura", erro, "user_1");
  });

  it("a falha não fica em cache: a próxima visita tenta de novo", async () => {
    const { amigosNoFragiq } = await import("@/lib/social");
    getFriendIds.mockRejectedValueOnce(new Error("timeout"));
    await amigosNoFragiq("user_2", "76561198000000002");

    getFriendIds.mockResolvedValueOnce([]);
    const r = await amigosNoFragiq("user_2", "76561198000000002");

    expect(getFriendIds).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ listaPrivada: true, leituraFalhou: false });
  });
});
