import { describe, expect, it } from "vitest";
import { achadosDaTela, conferirAnalise, leituraDaTela, limparFrase, resolverMetrica } from "@/lib/achados";
import { lerJanela } from "@/lib/analise-sessao";
import { direcaoDoContador, direcaoDoPainel } from "@/lib/direcao";
import type { Achado, AnaliseEstruturada } from "@/lib/analise-texto";
import { normal, serie } from "./fixtures";

/**
 * Os achados do analista com números nossos: o modelo escolhe do que falar,
 * a sessão diz quanto foi, a tabela do código diz para que lado é melhor.
 * Os casos são os que apareceram em produção em 05/10/2026.
 */

const achado = (rotulo: string, valor: number, extra: Partial<Achado> = {}): Achado => ({
  rotulo,
  valor,
  referencia: null,
  unidade: "",
  nota: null,
  ...extra,
});

// Seis sessões normais (K/D 1,0, 1 kill/round, AK a 30%) e a sessão lida:
// 30 rounds, 45 kills, 30 mortes, AK a 50%.
const rows = serie([...Array.from({ length: 6 }, () => normal()), normal({ kills: 45, ak: { tiros: 100, acertos: 50 } })]);
const janela = lerJanela(rows, rows[rows.length - 1].id!, { modo: null, mapa: null })!;

describe("resolverMetrica: do rótulo livre para uma métrica que sabemos calcular", () => {
  it.each([
    ["K/D na nova sessão", { tipo: "painel", chave: "kd" }],
    ["Dano por round", { tipo: "painel", chave: "adr" }],
    ["Headshot %", { tipo: "painel", chave: "hs" }],
    ["Kills por round", { tipo: "painel", chave: "kpr" }],
    ["Rounds por partida", { tipo: "painel", chave: "rounds" }],
    ["Precisão com USP-S / P2000", { tipo: "precisao", arma: "hkp2000" }],
    ["precision com Galil", { tipo: "precisao", arma: "galilar" }],
    ["Precisão M4A1", { tipo: "precisao", arma: "m4a1" }],
  ])("%s", (rotulo, esperado) => {
    expect(resolverMetrica(rotulo)).toEqual(esperado);
  });

  it("o que não sabemos calcular não vira achado", () => {
    expect(resolverMetrica("Taxa de sobrevivência")).toBeNull();
    expect(resolverMetrica("Precisão geral")).toBeNull();
  });
});

describe("direção: tabela do código, nunca o modelo", () => {
  it("dano por round é melhor quando sobe (o modelo escreveu 'desce' em produção)", () => {
    expect(direcaoDoPainel("adr")).toBe("sobe");
    expect(direcaoDoContador("total_damage_done")).toBe("sobe");
  });

  it("mortes descem; volume (rounds, tiros, partidas) não tem lado", () => {
    expect(direcaoDoContador("total_deaths")).toBe("desce");
    expect(direcaoDoContador("total_rounds_played")).toBe("nenhuma");
    expect(direcaoDoContador("total_shots_ak47")).toBe("nenhuma");
    expect(direcaoDoContador("last_match_kills")).toBe("nenhuma");
    expect(direcaoDoContador("total_kills_ak47")).toBe("sobe");
  });

  it("contador desconhecido é 'nenhuma' — chip cinza, sem inventar valência", () => {
    expect(direcaoDoContador("algo_novo_da_valve")).toBe("nenhuma");
  });
});

describe("achadosDaTela: valor da sessão, normal na hora e cor da tabela", () => {
  it("recalcula o valor da sessão em vez de usar o que o modelo escreveu", () => {
    const [kpr] = achadosDaTela([achado("Kills por round", 9.99, { referencia: 0.1 })], janela);
    expect(kpr.valor).toBeCloseTo(1.5);
    expect(kpr.texto).toBe("1,50");
    expect(kpr.referencia).not.toBe(0.1);
    expect(kpr.delta).toMatchObject({ estado: "ok", direcao: "sobe", valencia: "good" });
    expect(kpr.base).toBe("30 rounds");
  });

  it("precisão por arma sai do par de coletas, com a base em tiros", () => {
    const [ak] = achadosDaTela([achado("Precisão AK-47", 12, { unidade: "%" })], janela);
    expect(ak.valor).toBeCloseTo(50);
    expect(ak.emPct).toBe(true);
    expect(ak.base).toBe("100 tiros");
    expect(ak.delta).toMatchObject({ estado: "ok", unidade: "pp", valencia: "good" });
  });

  it("K/D, dano e HS ficam nos cartões: um número, um lugar (o mesmo 1,66 não sai com dois %)", () => {
    const achados = achadosDaTela([achado("K/D", 1.66, { referencia: 0.71 }), achado("Dano por round", 100), achado("Headshot %", 26, { unidade: "%" })], janela);
    expect(achados).toEqual([]);
  });

  it("rótulo que não se resolve sai, e o mesmo achado não aparece duas vezes", () => {
    const achados = achadosDaTela([achado("Clutches ganhos", 3), achado("Kills por round", 1.5), achado("KPR", 1.5)], janela);
    expect(achados.map((a) => a.id)).toEqual(["kpr"]);
  });

  it("sessão de 1 round não vira taxa por round", () => {
    const curta = serie([...Array.from({ length: 6 }, () => normal()), { rounds: 1, kills: 39, deaths: 1, dano: 4364 }]);
    const j = lerJanela(curta, curta[curta.length - 1].id!, { modo: null, mapa: null })!;
    expect(achadosDaTela([achado("Kills por round", 39)], j)).toEqual([]);
  });
});

describe("conferirAnalise: a análise leu esta sessão?", () => {
  const analise = (achados: Achado[], nota = ""): AnaliseEstruturada => ({ manchete: "Sessão boa", achados, causa: nota || null, acao: null });

  it("números de outra sessão são divergência (K/D 1,47 numa sessão de K/D 1,50 com folga de 2%)", () => {
    const d = conferirAnalise(analise([achado("K/D na nova sessão", 0.67)]), janela);
    expect(d).toEqual([{ rotulo: "K/D na nova sessão", escrito: 0.67, daSessao: 1.5 }]);
  });

  it("rounds citados que não são os da sessão também", () => {
    const d = conferirAnalise(analise([], "Amostra curta de 19 rounds"), janela);
    expect(d).toEqual([{ rotulo: "rounds citados", escrito: 19, daSessao: 30 }]);
  });

  it("os números certos, arredondados pelo modelo, passam", () => {
    expect(conferirAnalise(analise([achado("K/D", 1.5), achado("Precisão AK-47", 0.5, { unidade: "%" })], "30 rounds"), janela)).toEqual([]);
  });
});

describe("o texto que a sessão desmente sai", () => {
  it("modo e mapa que a sessão não provou", () => {
    expect(limparFrase("Análise da nova sessão no Competitivo em Mirage", { modo: null, mapa: null })).toBe("Análise da nova sessão");
    expect(limparFrase("Boa partida em Mirage", { modo: "competitive", mapa: "de_mirage" })).toBe("Boa partida em Mirage");
    expect(limparFrase("Boa partida em Inferno", { modo: "competitive", mapa: "de_mirage" })).toBe("Boa partida");
  });

  it("inglês no meio do português", () => {
    expect(limparFrase("Melhorar a precision com Galil", { modo: null, mapa: null })).toBe("Melhorar a precisão com Galil");
  });

  it("'porque' que cita arma fora dos achados sai; ação com arma não usada na sessão também", () => {
    const leitura = leituraDaTela(
      { manchete: "Noite de AK", achados: [achado("Precisão AK-47", 50, { unidade: "%" })], causa: "A Galil errou demais", acao: "Treine a AWP" },
      janela,
    );
    expect(leitura.achados.map((a) => a.id)).toEqual(["precisao:ak47"]);
    expect(leitura.causa).toBeNull();
    expect(leitura.acao).toBeNull();
  });
});
