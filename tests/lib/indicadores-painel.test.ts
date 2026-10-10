import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  COLETA_VENCE_EM_H,
  criarIndicadores,
  type FontesDeIndicadores,
  tokenConfere,
} from "@/lib/indicadores-painel";

/**
 * O esquema do contrato do painel (`painel/src/contrato/indicadores.ts`),
 * replicado só aqui: a produção não importa o contrato, quem o conhece é o
 * teste que prova que a resposta cabe nele.
 */
const Indicador = z.object({
  id: z.string().regex(/^[a-z0-9_]{1,40}$/),
  rotulo: z.string().min(1).max(60),
  valor: z.number().nullable(),
  unidade: z.string().max(20).optional(),
  periodo: z.enum(["agora", "24h", "7d", "30d", "mes"]).optional(),
  nivel: z.enum(["ok", "info", "atencao", "critico"]).default("info"),
  detalhe: z.string().max(200).optional(),
  origem: z.string().min(1).max(160),
});
const Aviso = z.object({
  nivel: z.enum(["atencao", "critico"]),
  titulo: z.string().min(1).max(120),
  detalhe: z.string().max(300).optional(),
  desde: z.iso.datetime({ offset: true }).optional(),
});
const Resposta = z.object({
  versao: z.literal(1),
  projeto: z.string().regex(/^[a-z][a-z0-9-]*$/),
  geradoEm: z.iso.datetime({ offset: true }),
  indicadores: z.array(Indicador).max(30),
  avisos: z.array(Aviso).max(20).default([]),
});

const AGORA = new Date("2026-10-10T12:00:00Z");

/** Tudo saudável; cada teste troca o que quer provar. */
function fontes(sobre: Partial<FontesDeIndicadores> = {}): FontesDeIndicadores {
  return {
    pendencias: async () => ({ partidasSemSessao: 0, partidaMaisAntigaMs: null, analisesSemResposta: 0, capturasVencidas: 0 }),
    bot: async () => ({
      tickHaMs: 60_000,
      logado: true,
      desconectadoDesde: null,
      ultimoTickEm: new Date(AGORA.getTime() - 60_000),
    }),
    coletaHaH: async () => 5,
    uso: async () => ({ usuarios: 12, novos7d: 2, snapshots24h: 9, partidas24h: 4, sessoes24h: 3 }),
    integridade: async () => ({
      sessoesComRegraAtrasada: 0,
      insightsComRegraAtrasada: 0,
      sessoesComPartidaInexistente: 0,
      observacoesSemPonto: 0,
    }),
    filas: async () => ({ botErros24h: 0, mensagensSteamFalhas24h: 0, partidasGcPendentes: 0 }),
    ...sobre,
  };
}

async function medir(sobre: Partial<FontesDeIndicadores> = {}, extra: { limiteMs?: number } = {}) {
  const log = vi.fn();
  const r = await criarIndicadores({ fontes: fontes(sobre), log, agora: () => AGORA, ...extra }).medir();
  return { r, log, por: (id: string) => r.indicadores.find((i) => i.id === id)! };
}

describe("indicadores do painel: formato", () => {
  it("a resposta saudável cabe no esquema do contrato e traz só ok e info", async () => {
    const { r } = await medir();
    const lida = Resposta.parse(r);
    expect(lida.projeto).toBe("fragiq");
    expect(lida.geradoEm).toBe("2026-10-10T12:00:00.000Z");
    expect(lida.indicadores.length).toBeLessThanOrEqual(30);
    expect(lida.indicadores.every((i) => ["ok", "info"].includes(i.nivel))).toBe(true);
    expect(lida.avisos).toEqual([]);
  });

  it("todo indicador diz a origem, tem id único e valor numérico quando medido", async () => {
    const { r } = await medir();
    const ids = r.indicadores.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const i of r.indicadores) {
      expect(i.origem.length).toBeGreaterThan(0);
      expect(typeof i.valor).toBe("number");
    }
  });

  it("com tudo quebrado ainda cabe no esquema e o motivo vai em detalhe", async () => {
    const falha = async () => {
      throw new Error("senha do banco: hunter2 em 76561198000000001");
    };
    const { r, log } = await medir({
      pendencias: falha,
      bot: falha,
      coletaHaH: falha,
      uso: falha,
      integridade: falha,
      filas: falha,
    });
    const lida = Resposta.parse(r);
    expect(lida.indicadores.length).toBeGreaterThanOrEqual(14);
    for (const i of lida.indicadores) {
      expect(i.valor).toBeNull();
      expect(i.detalhe).toMatch(/indisponível/);
      // O erro bruto fica no log do servidor, nunca na resposta.
      expect(JSON.stringify(i)).not.toContain("hunter2");
      expect(JSON.stringify(i)).not.toContain("76561198000000001");
    }
    expect(log).toHaveBeenCalled();
  });
});

describe("indicadores do painel: níveis", () => {
  it("partida sem sessão e captura vencida são críticas; análise sem resposta pede atenção", async () => {
    const { por } = await medir({
      pendencias: async () => ({
        partidasSemSessao: 2,
        partidaMaisAntigaMs: 5 * 3_600_000,
        analisesSemResposta: 1,
        capturasVencidas: 1,
      }),
    });
    expect(por("partidas_sem_sessao")).toMatchObject({ valor: 2, nivel: "critico", detalhe: "a mais antiga terminou há 5 h" });
    expect(por("analises_sem_resposta")).toMatchObject({ valor: 1, nivel: "atencao" });
    expect(por("capturas_vencidas")).toMatchObject({ valor: 1, nivel: "critico" });
  });

  it("zero pendência é ok", async () => {
    const { por } = await medir();
    for (const id of ["partidas_sem_sessao", "analises_sem_resposta", "capturas_vencidas"]) expect(por(id).nivel).toBe("ok");
  });

  it("o estado do bot decide o nível e o parado vira aviso crítico com o desde", async () => {
    const tick = new Date(AGORA.getTime() - 50 * 60_000);
    const { por, r } = await medir({
      bot: async () => ({ tickHaMs: 50 * 60_000, logado: true, desconectadoDesde: null, ultimoTickEm: tick }),
    });
    expect(por("bot_ultimo_tick_min")).toMatchObject({ valor: 50, nivel: "critico", unidade: "min" });
    expect(r.avisos).toEqual([expect.objectContaining({ nivel: "critico", desde: tick.toISOString() })]);
    Resposta.parse(r);
  });

  it("bot em repouso (10 min sem tick) é normal, não alerta", async () => {
    const { por, r } = await medir({
      bot: async () => ({ tickHaMs: 10 * 60_000, logado: true, desconectadoDesde: null, ultimoTickEm: AGORA }),
    });
    expect(por("bot_ultimo_tick_min")).toMatchObject({ valor: 10, nivel: "ok" });
    expect(r.avisos).toEqual([]);
  });

  it("bot deslogado pede atenção e o aviso carrega o desde da Steam", async () => {
    const desde = new Date("2026-10-10T10:00:00Z");
    const { por, r } = await medir({
      bot: async () => ({ tickHaMs: 30_000, logado: false, desconectadoDesde: desde, ultimoTickEm: AGORA }),
    });
    expect(por("bot_ultimo_tick_min").nivel).toBe("atencao");
    expect(r.avisos[0]).toMatchObject({ nivel: "atencao", desde: desde.toISOString() });
  });

  it("bot que nunca bateu o tick: valor null, atenção", async () => {
    const { por } = await medir({ bot: async () => null });
    expect(por("bot_ultimo_tick_min")).toMatchObject({ valor: null, nivel: "atencao" });
  });

  it("coleta diária: dentro do limite é ok; passando dele é crítica e vira aviso", async () => {
    const ok = await medir({ coletaHaH: async () => COLETA_VENCE_EM_H });
    expect(ok.por("coleta_diaria_idade_h")).toMatchObject({ valor: 26, nivel: "ok" });
    const vencida = await medir({ coletaHaH: async () => COLETA_VENCE_EM_H + 4.04 });
    expect(vencida.por("coleta_diaria_idade_h")).toMatchObject({ valor: 30, nivel: "critico" });
    expect(vencida.r.avisos[0]).toMatchObject({ nivel: "critico", titulo: "Coleta diária parada há 30 h" });
    Resposta.parse(vencida.r);
  });

  it("sem nenhuma coleta registrada: null com o motivo, sem alarme", async () => {
    const { por, r } = await medir({ coletaHaH: async () => null });
    expect(por("coleta_diaria_idade_h")).toMatchObject({ valor: null, nivel: "info" });
    expect(por("coleta_diaria_idade_h").detalhe).toMatch(/nenhuma coleta/);
    expect(r.avisos).toEqual([]);
  });

  it("integridade: regra atrasada pede atenção; partida inexistente é crítica; observação sem ponto só informa", async () => {
    const { por } = await medir({
      integridade: async () => ({
        sessoesComRegraAtrasada: 3,
        insightsComRegraAtrasada: 7,
        sessoesComPartidaInexistente: 1,
        observacoesSemPonto: 4,
      }),
    });
    expect(por("sessoes_regra_atrasada")).toMatchObject({ valor: 3, nivel: "atencao" });
    expect(por("insights_regra_atrasada")).toMatchObject({ valor: 7, nivel: "atencao" });
    expect(por("sessoes_partida_inexistente")).toMatchObject({ valor: 1, nivel: "critico" });
    expect(por("observacoes_sem_ponto")).toMatchObject({ valor: 4, nivel: "info" });
  });

  it("erros do bot e mensagens falhas: ok em 0, info abaixo do limite, atenção a partir dele", async () => {
    const zero = await medir();
    expect(zero.por("bot_erros_24h").nivel).toBe("ok");
    const pouco = await medir({ filas: async () => ({ botErros24h: 3, mensagensSteamFalhas24h: 2, partidasGcPendentes: 0 }) });
    expect(pouco.por("bot_erros_24h").nivel).toBe("info");
    expect(pouco.por("mensagens_steam_falhas_24h").nivel).toBe("info");
    const muito = await medir({ filas: async () => ({ botErros24h: 10, mensagensSteamFalhas24h: 5, partidasGcPendentes: 2 }) });
    expect(muito.por("bot_erros_24h").nivel).toBe("atencao");
    expect(muito.por("mensagens_steam_falhas_24h").nivel).toBe("atencao");
    expect(muito.por("partidas_gc_pendentes")).toMatchObject({ valor: 2, nivel: "atencao" });
  });

  it("o uso é informativo", async () => {
    const { por } = await medir();
    expect(por("usuarios_total")).toMatchObject({ valor: 12, nivel: "info", detalhe: "2 novos nos últimos 7 dias" });
    for (const id of ["snapshots_24h", "partidas_24h", "sessoes_24h"]) expect(por(id).nivel).toBe("info");
  });
});

describe("indicadores do painel: fonte que falha", () => {
  it("só os indicadores da fonte viram null; o resto continua medido", async () => {
    const { por, log } = await medir({
      uso: async () => {
        throw new Error("connection refused");
      },
    });
    for (const id of ["usuarios_total", "snapshots_24h", "partidas_24h", "sessoes_24h"]) {
      expect(por(id)).toMatchObject({ valor: null, nivel: "info", detalhe: "banco (uso) indisponível" });
    }
    expect(por("capturas_vencidas").valor).toBe(0);
    expect(log).toHaveBeenCalledWith("indicadores: fonte falhou", { fonte: "banco (uso)", erro: "connection refused" });
  });

  it("fonte que passa do limite de tempo vira null com o motivo", async () => {
    const { por } = await medir({ filas: () => new Promise(() => {}) }, { limiteMs: 2_000 });
    expect(por("bot_erros_24h")).toMatchObject({ valor: null, detalhe: "banco (filas) demorou mais de 2 s" });
  });

  it("contagem que não é número vira null na resposta, nunca zero", async () => {
    const { por } = await medir({
      pendencias: async () => ({
        partidasSemSessao: Number.NaN,
        partidaMaisAntigaMs: null,
        analisesSemResposta: 0,
        capturasVencidas: 0,
      }),
    });
    // A fonte inteira conta como falha: nenhum dos três vira 0.
    for (const id of ["partidas_sem_sessao", "analises_sem_resposta", "capturas_vencidas"]) {
      expect(por(id)).toMatchObject({ valor: null, detalhe: "banco (pendências) indisponível" });
    }
  });
});

describe("indicadores do painel: sem dado pessoal", () => {
  it("a resposta não tem SteamID, e-mail, nome nem id de linha, mesmo com a fonte cheia", async () => {
    const { r } = await medir({
      pendencias: async () => ({ partidasSemSessao: 1, partidaMaisAntigaMs: 3_600_000, analisesSemResposta: 1, capturasVencidas: 1 }),
      bot: async () => ({ tickHaMs: 50 * 60_000, logado: true, desconectadoDesde: null, ultimoTickEm: AGORA }),
    });
    const texto = JSON.stringify(r);
    expect(texto).not.toMatch(/\b7656119\d{10}\b/);
    expect(texto).not.toMatch(/@/);
    expect(texto).not.toMatch(/\bc[a-z0-9]{24}\b/); // cuid
    for (const chave of ["steamId", "personaName", "email", "userId"]) expect(texto).not.toContain(chave);
  });
});

describe("tokenConfere", () => {
  it("aceita só o Bearer igual ao esperado", () => {
    expect(tokenConfere("segredo", "Bearer segredo")).toBe(true);
    expect(tokenConfere("segredo", "bearer  segredo ")).toBe(true);
    expect(tokenConfere("segredo", "Bearer outro")).toBe(false);
    expect(tokenConfere("segredo", "segredo")).toBe(false);
    expect(tokenConfere("segredo", "Bearer ")).toBe(false);
    expect(tokenConfere("segredo", null)).toBe(false);
    expect(tokenConfere("segredo", undefined)).toBe(false);
  });
});
