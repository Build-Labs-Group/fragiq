import { describe, expect, it } from "vitest";
import { avaliarResposta, hashDaJanela, janelaDaSessao, lerJanela, recortarParaSessao, sessaoIncompleta } from "@/lib/analise-sessao";
import type { Fonte } from "@/lib/analista";
import { normal, serie } from "./fixtures";

/**
 * Uma análise, uma janela: o texto só vai para a tela enquanto a sessão de
 * hoje é a que a pergunta descreveu, e enquanto os números dele batem com
 * ela. É a amarra que faltava quando a sessão de 01/10 00:22 (K/D 0,67)
 * mostrou os achados da sessão anterior (K/D 1,47).
 */

const gravada = (o: Partial<Parameters<typeof janelaDaSessao>[0]> = {}) =>
  janelaDaSessao({ deSnapshotId: "s1", ateSnapshotId: "s2", rounds: 22, partidas: 2, kills: 10, deaths: 15, dano: 1492, headshots: 0, ...o });

const rows = serie([...Array.from({ length: 6 }, () => normal()), normal({ kills: 45 })]);
const ate = rows[rows.length - 1].id!;
const janela = lerJanela(rows, ate, { modo: null, mapa: null });

const RESPOSTA_CERTA = JSON.stringify({ manchete: "Sessão de 30 rounds acima do normal", achados: [{ rotulo: "K/D", valor: 1.5 }], causa: null, acao: null });
const RESPOSTA_DE_OUTRA = JSON.stringify({ manchete: "Sessão boa", achados: [{ rotulo: "K/D na nova sessão", valor: 1.467 }], causa: null, acao: null });

describe("janela da sessão", () => {
  it("o hash muda quando a sessão é refeita (outra coleta inicial, outros totais)", () => {
    expect(hashDaJanela(gravada())).toBe(hashDaJanela(gravada()));
    expect(hashDaJanela(gravada({ deSnapshotId: "s0", rounds: 41 }))).not.toBe(hashDaJanela(gravada()));
  });

  it("sessão com contadores impossíveis é incompleta (1 round, 4.364 de dano)", () => {
    expect(sessaoIncompleta({ rounds: 1, kills: 39, dano: 4364 })).toBe(true);
    expect(sessaoIncompleta({ rounds: 0, kills: 0, dano: 0 })).toBe(true);
    expect(sessaoIncompleta({ rounds: 24, kills: 16, dano: 2140 })).toBe(false);
  });
});

describe("avaliarResposta", () => {
  const base = { janelaHashGravado: null, janelaAtual: null, janela, incompleta: false };

  it("a mesma janela e os números certos: ok, já com os achados nossos", () => {
    const r = avaliarResposta({ ...base, resposta: RESPOSTA_CERTA });
    expect(r.estado).toBe("ok");
    expect(r.leitura?.forma).toBe("estruturada");
  });

  it("sessão refeita depois da pergunta: desatualizada, sem texto", () => {
    const r = avaliarResposta({ ...base, resposta: RESPOSTA_CERTA, janelaHashGravado: hashDaJanela(gravada()), janelaAtual: gravada({ rounds: 41 }) });
    expect(r).toEqual({ estado: "desatualizada", leitura: null, divergencias: [] });
  });

  it("análise antiga (sem janela gravada) com números de outra sessão: outra-sessao, sem texto", () => {
    const r = avaliarResposta({ ...base, resposta: RESPOSTA_DE_OUTRA });
    expect(r.estado).toBe("outra-sessao");
    expect(r.leitura).toBeNull();
    expect(r.divergencias[0]).toMatchObject({ escrito: 1.467, daSessao: 1.5 });
  });

  it("sessão incompleta não mostra texto nenhum", () => {
    expect(avaliarResposta({ ...base, resposta: RESPOSTA_CERTA, incompleta: true }).estado).toBe("incompleta");
  });

  it("prosa (o modelo às vezes ignora o formato) também é conferida: rounds e K/D", () => {
    const certa = "Análise da sessão.\n\n**Situação Geral:**\n- **Período:** 30 rounds em 1 partida.\n- **K/D:** 1.50, acima do normal.\n\n→ Repita.";
    const deOutra = "Análise da sessão.\n\n- **Período:** 22 rounds em 2 partidas.\n- **K/D:** 0.67.";
    expect(avaliarResposta({ ...base, resposta: certa }).estado).toBe("ok");
    expect(avaliarResposta({ ...base, resposta: deOutra })).toMatchObject({ estado: "outra-sessao", leitura: null });
  });

  it("uma linha só não é análise ('Resumo da nova sessão no modo Competitivo em Anubis')", () => {
    expect(avaliarResposta({ ...base, resposta: "Resumo da nova sessão no modo Competitivo em Anubis, 05 de outubro." }).estado).toBe("ilegivel");
  });

  it("ilegível não vira prosa", () => {
    expect(avaliarResposta({ ...base, resposta: '{"achados":[' }).estado).toBe("ilegivel");
  });
});

describe("recortarParaSessao: o turno lê a sessão perguntada", () => {
  const fonte: Fonte = {
    appId: 730,
    gameName: "Counter-Strike 2",
    playtimeForeverMin: 0,
    rows: [...rows, ...serie([normal(), normal()]).slice(1).map((r, i) => ({ ...r, id: `depois-${i}` }))],
    catalog: [],
    partidasOficiais: [],
  };

  it("corta a série na coleta que fecha a sessão", () => {
    const r = recortarParaSessao(fonte, { ate, modo: null }, {})!;
    expect(r.fonte.rows.at(-1)!.id).toBe(ate);
    expect(r.fonte.rows).toHaveLength(rows.length);
  });

  it("sessão sem modo provado: o modo e o mapa que o modelo pedir são ignorados", () => {
    const r = recortarParaSessao(fonte, { ate, modo: null }, { modo: "competitive", mapa: "de_mirage", metrica: "x" })!;
    expect(r.params).toEqual({ metrica: "x" });
  });

  it("modo provado que a coleta carrega é forçado; o que ela não carrega fica fora (filtrar pegaria outra sessão)", () => {
    const comModo: Fonte = { ...fonte, rows: fonte.rows.map((x) => (x.id === ate ? { ...x, matchMode: "premier" } : x)) };
    expect(recortarParaSessao(comModo, { ate, modo: "premier" }, { modo: "competitive" })!.params).toEqual({ modo: "premier" });
    expect(recortarParaSessao(fonte, { ate, modo: "premier" }, { modo: "premier" })!.params).toEqual({});
  });

  it("coleta que não existe mais (sessão refeita): null", () => {
    expect(recortarParaSessao(fonte, { ate: "sumiu", modo: null }, {})).toBeNull();
  });
});
