import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * A rota `GET /api/buildlabs/indicadores`: autenticação (503, 401, 200) e a
 * resposta cabendo no contrato do painel. O banco é trocado por uma fonte
 * em memória; o SSM, por um cliente de mentira.
 */
const fontesFalsas = vi.hoisted(() => ({
  pendencias: vi.fn(async () => ({ partidasSemSessao: 0, partidaMaisAntigaMs: null, analisesSemResposta: 0, capturasVencidas: 0 })),
  bot: vi.fn(async () => ({ tickHaMs: 30_000, logado: true, desconectadoDesde: null, ultimoTickEm: new Date() })),
  coletaHaH: vi.fn(async () => 3),
  uso: vi.fn(async () => ({ usuarios: 5, novos7d: 1, snapshots24h: 2, partidas24h: 1, sessoes24h: 1 })),
  integridade: vi.fn(async () => ({
    sessoesComRegraAtrasada: 0,
    insightsComRegraAtrasada: 0,
    sessoesComPartidaInexistente: 0,
    observacoesSemPonto: 0,
  })),
  filas: vi.fn(async () => ({ botErros24h: 0, mensagensSteamFalhas24h: 0, partidasGcPendentes: 0 })),
}));
vi.mock("@/lib/indicadores-fonte", () => ({ fontesDoBanco: () => fontesFalsas }));

import { GET } from "@/app/api/buildlabs/indicadores/route";
import { definirClienteSsmDoToken } from "@/lib/indicadores-token";

const Resposta = z.object({
  versao: z.literal(1),
  projeto: z.literal("fragiq"),
  geradoEm: z.iso.datetime({ offset: true }),
  indicadores: z
    .array(
      z
        .object({
          id: z.string().regex(/^[a-z0-9_]{1,40}$/),
          rotulo: z.string().min(1).max(60),
          valor: z.number().nullable(),
          nivel: z.enum(["ok", "info", "atencao", "critico"]),
          origem: z.string().min(1).max(160),
        })
        .passthrough(),
    )
    .max(30),
  avisos: z.array(z.object({ nivel: z.enum(["atencao", "critico"]), titulo: z.string() }).passthrough()).max(20),
});

const chamar = (cabecalho?: string) =>
  GET(new Request("http://x/api/buildlabs/indicadores", { headers: cabecalho ? { authorization: cabecalho } : {} }) as never);

beforeEach(() => {
  delete process.env.INDICADORES_TOKEN;
  delete process.env.PARAMETRO_INDICADORES;
  definirClienteSsmDoToken(null);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  delete process.env.INDICADORES_TOKEN;
  delete process.env.PARAMETRO_INDICADORES;
  definirClienteSsmDoToken(null);
});

describe("GET /api/buildlabs/indicadores", () => {
  it("503 sem token configurado, mesmo com o Bearer enviado, e sem tocar o banco", async () => {
    const res = await chamar("Bearer qualquer");
    expect(res.status).toBe(503);
    expect(fontesFalsas.pendencias).not.toHaveBeenCalled();
  });

  it("401 sem Authorization e com token errado, sem tocar o banco", async () => {
    process.env.INDICADORES_TOKEN = "token-certo";
    expect((await chamar()).status).toBe(401);
    expect((await chamar("Bearer token-errado")).status).toBe(401);
    expect((await chamar("token-certo")).status).toBe(401);
    expect(fontesFalsas.pendencias).not.toHaveBeenCalled();
  });

  it("200 com o token do ambiente: JSON dentro do contrato, sem cache", async () => {
    process.env.INDICADORES_TOKEN = "token-certo";
    const res = await chamar("Bearer token-certo");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const corpo = Resposta.parse(await res.json());
    expect(corpo.indicadores.some((i) => i.id === "partidas_sem_sessao")).toBe(true);
  });

  it("200 com o token lido do SSM (nome do parâmetro, com decriptação) e guardado na memória", async () => {
    process.env.PARAMETRO_INDICADORES = "/infra-compartilhada/prod/indicadores-token";
    const send = vi.fn(async (...args: unknown[]) => ({ args, Parameter: { Value: "token-do-ssm\n" } }));
    definirClienteSsmDoToken({ send } as never);

    expect((await chamar("Bearer token-do-ssm")).status).toBe(200);
    expect((await chamar("Bearer errado")).status).toBe(401);
    expect(send).toHaveBeenCalledTimes(1);
    const comando = send.mock.calls[0][0] as { input: { Name: string; WithDecryption: boolean } };
    expect(comando.input).toEqual({ Name: "/infra-compartilhada/prod/indicadores-token", WithDecryption: true });
  });

  it("503 quando o SSM nega ou falha (a role ainda sem permissão), sem vazar o erro", async () => {
    process.env.PARAMETRO_INDICADORES = "/infra-compartilhada/prod/indicadores-token";
    definirClienteSsmDoToken({
      send: vi.fn(async () => {
        throw Object.assign(new Error("not authorized to perform ssm:GetParameter on arn:aws:ssm:..."), {
          name: "AccessDeniedException",
        });
      }),
    } as never);
    const res = await chamar("Bearer qualquer");
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain("arn:");
  });

  it("uma fonte que cai não derruba a resposta: 200 com null e o motivo", async () => {
    process.env.INDICADORES_TOKEN = "token-certo";
    fontesFalsas.filas.mockRejectedValueOnce(new Error("timeout"));
    const res = await chamar("Bearer token-certo");
    expect(res.status).toBe(200);
    const corpo = await res.json();
    expect(corpo.indicadores.find((i: { id: string }) => i.id === "bot_erros_24h")).toMatchObject({ valor: null });
  });
});
