import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cogniflow respondendo 503 (ou caindo) não derruba a página pública: a
 * leitura ganha uma nova tentativa curta e, se falhar de novo, a tela
 * mostra o último dado guardado no banco, com a hora dele e o aviso.
 *
 * O teste passa pela cadeia inteira (`invocar` -> `steam/api` ->
 * `perfil-publico`); só a rede (fetch), o banco e o diário são trocados.
 */
const STEAM_ID = "76561198000000001";
const COLETA = new Date("2026-10-11T12:30:00.000Z");
const METRICAS = {
  total_kills: 1000,
  total_deaths: 800,
  total_kills_headshot: 450,
  total_rounds_played: 2000,
  total_damage_done: 160000,
  total_matches_played: 100,
  total_matches_won: 55,
  total_mvps: 150,
  total_time_played: 360000,
  total_shots_ak47: 1000,
  total_hits_ak47: 250,
  total_kills_ak47: 400,
  total_rounds_map_de_nuke: 300,
  total_wins_map_de_nuke: 180,
};

const usuario = {
  perfilPublico: true,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  personaName: "Guardado",
  avatarUrl: "https://exemplo.test/a.jpg",
  profileUrl: "https://steamcommunity.com/profiles/" + STEAM_ID,
  countryCode: "BR",
  games: [
    {
      _count: { snapshots: 7 },
      snapshots: [{ metrics: METRICAS, capturedAt: COLETA }],
    },
  ],
};
const findUnique = vi.fn();
const registrar = vi.fn();

vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique } } }));
vi.mock("@/lib/eventos", () => ({ registrar, reportarErro: vi.fn() }));
vi.mock("@/lib/env", () => ({
  cogniflowApi: async () => ({
    apiUrl: "https://cogniflow.test",
    tenantId: "t",
    connectionId: "c",
    signingSecret: "s",
  }),
}));

const resposta503 = () =>
  new Response(JSON.stringify({ detail: "indisponível" }), { status: 503 });
const ok = (output: unknown) =>
  new Response(
    JSON.stringify({
      invocation_id: "i",
      capability_id: "x",
      status: "completed",
      output,
    }),
    { status: 200 },
  );

let fetchMock: ReturnType<typeof vi.fn>;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  findUnique.mockResolvedValue(usuario);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  warn.mockRestore();
});

describe("perfil público com o cogniflow fora", () => {
  it("503 duas vezes: renderiza com o dado guardado, bate com o banco e avisa", async () => {
    fetchMock.mockImplementation(async () => resposta503());
    const { carregarPerfilPublico } = await import("@/lib/perfil-publico");

    const perfil = await carregarPerfilPublico(STEAM_ID);

    expect(perfil.estado).toBe("ok");
    if (perfil.estado !== "ok") return;
    // Uma tentativa e uma nova: nem mais, nem menos.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(perfil.atualizadoEm).toEqual(COLETA);
    expect(perfil.jogador.personaname).toBe("Guardado");
    // O que aparece é exatamente o que está no banco.
    const resumo = Object.fromEntries(
      perfil.resumo.map((r) => [r.rotulo, r.valor]),
    );
    expect(resumo["K/D"]).toBe("1,25"); // 1000 / 800
    expect(resumo["Kills"]).toBe("1.000");
    expect(resumo["Partidas"]).toBe("100");
    expect(perfil.horas).toBe(100); // 360000 s
    expect(perfil.armas[0]).toMatchObject({
      id: "ak47",
      kills: 400,
      tiros: 1000,
      acertos: 250,
    });
    expect(perfil.mapas[0]).toMatchObject({
      id: "de_nuke",
      rounds: 300,
      vitorias: 180,
    });
    expect(perfil.usuarioDoFragiq).toEqual({
      desde: usuario.createdAt,
      coletas: 7,
    });

    // Não esconde o erro: warn no log e uma linha contável no diário.
    expect(warn).toHaveBeenCalled();
    expect(registrar).toHaveBeenCalledWith(
      "perfil.leitura_atrasada",
      expect.objectContaining({
        dados: expect.objectContaining({
          capability: "steam.player.read",
          comDadoGuardado: true,
        }),
      }),
    );

    // O aviso que a tela mostra, com a hora da coleta guardada.
    const { AvisoAtraso } = await import("@/components/aviso-atraso");
    const html = renderToStaticMarkup(
      createElement(AvisoAtraso, { em: perfil.atualizadoEm! }),
    );
    expect(html).toContain("Atualização atrasada, tentando de novo");
    expect(html).toContain("09:30"); // 12:30 UTC em Brasília
  });

  it("503 na primeira e sucesso na nova tentativa: sem aviso, dado ao vivo", async () => {
    fetchMock
      .mockResolvedValueOnce(resposta503())
      .mockResolvedValueOnce(
        ok({
          players: [
            {
              steam_id: STEAM_ID,
              name: "Ao vivo",
              avatar_url: null,
              profile_url: null,
              country: null,
              public: true,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        ok({
          stats: {
            metrics: { ...METRICAS, total_kills: 2000 },
            achievements_unlocked: null,
            achievements_total: null,
          },
        }),
      );
    const { carregarPerfilPublico } = await import("@/lib/perfil-publico");

    const perfil = await carregarPerfilPublico(STEAM_ID);

    expect(perfil.estado).toBe("ok");
    if (perfil.estado !== "ok") return;
    expect(perfil.atualizadoEm).toBeUndefined();
    expect(perfil.jogador.personaname).toBe("Ao vivo");
    expect(perfil.resumo.find((r) => r.rotulo === "Kills")?.valor).toBe(
      "2.000",
    );
    expect(registrar).not.toHaveBeenCalledWith(
      "perfil.leitura_atrasada",
      expect.anything(),
    );
  });

  it("jogador lido ao vivo e stats em 503: nome atual, números guardados, com aviso", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).endsWith("steam.player.read")
        ? ok({
            players: [
              {
                steam_id: STEAM_ID,
                name: "Ao vivo",
                avatar_url: null,
                profile_url: null,
                country: null,
                public: true,
              },
            ],
          })
        : resposta503(),
    );
    const { carregarPerfilPublico } = await import("@/lib/perfil-publico");

    const perfil = await carregarPerfilPublico(STEAM_ID);

    expect(perfil.estado).toBe("ok");
    if (perfil.estado !== "ok") return;
    expect(perfil.jogador.personaname).toBe("Ao vivo");
    expect(perfil.atualizadoEm).toEqual(COLETA);
    expect(perfil.resumo.find((r) => r.rotulo === "Kills")?.valor).toBe(
      "1.000",
    );
  });

  it("sem dado guardado (quem nunca entrou): estado indisponível, não erro, e a falha não fica em cache", async () => {
    findUnique.mockResolvedValue(null);
    fetchMock.mockImplementation(async () => {
      throw new TypeError("fetch failed");
    });
    const { carregarPerfilPublico } = await import("@/lib/perfil-publico");

    expect(await carregarPerfilPublico(STEAM_ID)).toEqual({
      estado: "indisponivel",
    });
    expect(registrar).toHaveBeenCalledWith(
      "perfil.leitura_atrasada",
      expect.objectContaining({
        dados: expect.objectContaining({ comDadoGuardado: false }),
      }),
    );
  });

  it("recusa permanente (400) não repete: uma chamada só", async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ detail: "payload" }), { status: 400 }),
    );
    const { carregarPerfilPublico } = await import("@/lib/perfil-publico");

    await carregarPerfilPublico(STEAM_ID);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
