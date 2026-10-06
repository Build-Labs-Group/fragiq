import { describe, expect, it } from "vitest";
import { lerAnalise, lerAnaliseEstruturada, lerResposta } from "@/lib/analise-texto";

describe("lerAnalise", () => {
  it("reconhece a forma fixa: manchete em negrito, parágrafos, ação", () => {
    const lida = lerAnalise(
      "**Sua melhor noite de AWP em duas semanas.**\n\nA precisão subiu para **41 %**.\n\nAmostra de 28 rounds: indício.\n\n→ Na próxima, mantenha a AWP no CT.",
    );
    expect(lida.manchete).toBe("Sua melhor noite de AWP em duas semanas.");
    expect(lida.paragrafos).toHaveLength(2);
    expect(lida.acao).toBe("Na próxima, mantenha a AWP no CT.");
  });

  it("um primeiro parágrafo curto sem marcação não vira manchete", () => {
    const lida = lerAnalise("Foi uma noite comum.\n\nNada mudou de verdade.\n\n→ Jogue mais.");
    expect(lida.manchete).toBeNull();
    expect(lida.paragrafos[0]).toBe("Foi uma noite comum.");
  });

  it("manchete terminada em dois-pontos ou longa demais é corpo", () => {
    expect(lerAnalise("**Resumo:**\n\ncorpo").manchete).toBeNull();
    expect(lerAnalise(`**${"x".repeat(91)}**\n\ncorpo`).manchete).toBeNull();
  });

  it("a ação colada no último parágrafo ainda é a ação", () => {
    const lida = lerAnalise("**Manchete curta.**\n\nCorpo.\n→ Faça isto.");
    expect(lida.paragrafos).toEqual(["Corpo."]);
    expect(lida.acao).toBe("Faça isto.");
  });
});

describe("lerAnaliseEstruturada (prompt v4)", () => {
  it("lê o JSON do agente, com defaults para o que faltar", () => {
    const r = lerAnaliseEstruturada(
      '```json\n{"manchete":"Noite de AK, não de AWP.","achados":[{"rotulo":"Precisão AK-47","valor":20.1,"referencia":7.8,"unidade":"%"},{"rotulo":"K/D","valor":0.59,"referencia":0.7}],"causa":"Kills de AK subiram e os de AWP caíram","acao":"Segure a AK nos rounds de eco"}\n```',
    );
    expect(r?.manchete).toBe("Noite de AK, não de AWP.");
    expect(r?.achados).toHaveLength(2);
    expect(r?.achados[0]).toMatchObject({ rotulo: "Precisão AK-47", valor: 20.1, referencia: 7.8, unidade: "%", nota: null });
    // A direção nunca vem do modelo (lib/direcao.ts): o achado lido nem a carrega.
    expect(r?.achados[0]).not.toHaveProperty("melhorQuando");
    expect(r?.acao).toBe("Segure a AK nos rounds de eco");
  });

  it("prosa não é estruturada; JSON sem manchete também não", () => {
    expect(lerAnaliseEstruturada("**Manchete.**\n\nCorpo.")).toBeNull();
    expect(lerAnaliseEstruturada(JSON.stringify({ achados: [] }))).toBeNull();
    expect(lerAnaliseEstruturada("{oops")).toBeNull();
  });
});

/**
 * As respostas de produção que apareceram como JSON cru na tela (05/10/2026):
 * o schema rígido recusava nota longa, e um JSON quebrado pelo modelo caía
 * na leitura em prosa, que mostrava o objeto inteiro com "ler ▾".
 */
describe("lerResposta: o usuário nunca vê JSON", () => {
  // Cache, 01/10 01:23 — nota com mais de 48 caracteres, que o schema antigo recusava.
  const CACHE =
    '{"manchete":"Análise da sessão de 01 de outubro no Competitivo","achados":[{"rotulo":"K/D na nova sessão","valor":0.79,"referencia":0.707,"unidade":"","melhorQuando":"sobe","nota":"K/D superior ao vitalício, mas com amostra fraca."},{"rotulo":"Precisão M4A1","valor":18.182,"referencia":9.994,"unidade":"%","melhorQuando":"sobe","nota":"Melhor precisão já registrada com M4A1, mesmo com amostra curta de tiros."}],"causa":"Precisão de M4A1 acima do normal","acao":"Continue com a M4A1 nos rounds de compra cheia."}';
  // AVELLARTS, 01/10 15:05 — o modelo escreveu `"unidade:@"%"`: JSON inválido.
  const QUEBRADO =
    '{"manchete":"Desempenho abaixo do normal em nova sessão","achados":[{"rotulo":"K/D na sessão","valor":0.364,"referencia":0.474,"unidade":"","melhorQuando":"sobe","nota":"9 rounds, amostra curta"},{"rotulo":"Precisão com M4A1","valor":35.7,"referencia":24.884,"unidade:@"%","melhorQuando":"sobe","nota":"arma acima do normal"}],"causa":"K/D caiu em amostra curta de 9 rounds","acao":"Focar em aumentar a K/D na próxima sessão"}';

  it("nota longa é cortada, não recusada", () => {
    const r = lerResposta(CACHE);
    expect(r.forma).toBe("estruturada");
    if (r.forma !== "estruturada") return;
    expect(r.reparada).toBe(false);
    expect(r.analise.achados).toHaveLength(2);
    expect(r.analise.achados[1].nota!.length).toBeLessThanOrEqual(64);
    expect(r.analise.achados[1].nota!.endsWith("…")).toBe(true);
  });

  it("JSON quebrado é lido campo a campo", () => {
    const r = lerResposta(QUEBRADO);
    expect(r.forma).toBe("estruturada");
    if (r.forma !== "estruturada") return;
    expect(r.reparada).toBe(true);
    expect(r.analise.manchete).toBe("Desempenho abaixo do normal em nova sessão");
    expect(r.analise.achados.map((a) => [a.rotulo, a.valor])).toEqual([
      ["K/D na sessão", 0.364],
      ["Precisão com M4A1", 35.7],
    ]);
    // A unidade ilegível é deduzida do rótulo.
    expect(r.analise.achados[1].unidade).toBe("%");
    expect(r.analise.acao).toBe("Focar em aumentar a K/D na próxima sessão");
  });

  it("objeto com texto em volta ou cerca de código também é estruturado", () => {
    const r = lerResposta("Aqui está a análise:\n\n```json\n" + CACHE + "\n```\nQualquer dúvida, pergunte.");
    expect(r.forma).toBe("estruturada");
  });

  it("o que nem campo a campo se lê é ilegível — nunca prosa com chaves dentro", () => {
    expect(lerResposta('{"achados": [1, 2').forma).toBe("ilegivel");
    expect(lerResposta("").forma).toBe("ilegivel");
  });

  it("prosa continua prosa", () => {
    expect(lerResposta("**Boa noite de AK.**\n\nSubiu.\n\n→ Repita.").forma).toBe("prosa");
  });

  it("nenhuma resposta de produção chega lida com chaves de JSON", () => {
    for (const texto of [CACHE, QUEBRADO]) {
      const lida = JSON.stringify(lerResposta(texto));
      expect(lida).not.toContain('\\"manchete\\"');
      expect(lida).not.toContain('{\\"');
    }
  });
});
