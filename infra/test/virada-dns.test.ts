import { describe, expect, it } from "vitest";
import { planejar, REGISTRO_DA_VERCEL } from "../scripts/virada-dns.ts";

const NOME = "fragiq.buildlabs.com.br";
const ALVO = "d-abc123.execute-api.us-east-2.amazonaws.com";

describe("virada do DNS", () => {
  it("ir: apaga o A da Vercel e cria o CNAME da HTTP API, com proxy", () => {
    const acoes = planejar(NOME, [{ id: "r1", type: "A", name: NOME, content: "76.76.21.21", proxied: true }], { type: "CNAME", content: ALVO, proxied: true }, "virada");
    expect(acoes).toEqual([
      { tipo: "apagar", registro: expect.objectContaining({ id: "r1", type: "A" }) },
      { tipo: "criar", corpo: { type: "CNAME", name: NOME, content: ALVO, proxied: true, ttl: 1, comment: "virada" } },
    ]);
  });

  it("voltar: apaga o CNAME e recria o A da Vercel como estava", () => {
    const acoes = planejar(NOME, [{ id: "c1", type: "CNAME", name: NOME, content: ALVO, proxied: true }], { ...REGISTRO_DA_VERCEL }, "volta");
    expect(acoes.map((a) => a.tipo)).toEqual(["apagar", "criar"]);
    expect(acoes[1]).toMatchObject({ corpo: { type: "A", content: "76.76.21.21", proxied: true } });
  });

  it("já no destino: nada a fazer; outros tipos (TXT, MX) nunca são tocados", () => {
    const atuais = [
      { id: "c1", type: "CNAME", name: NOME, content: ALVO, proxied: true },
      { id: "t1", type: "TXT", name: NOME, content: "v=spf1 -all" },
    ];
    expect(planejar(NOME, atuais, { type: "CNAME", content: ALVO, proxied: true }, "x")).toEqual([]);
    const voltar = planejar(NOME, atuais, { ...REGISTRO_DA_VERCEL }, "x");
    expect(voltar.filter((a) => a.tipo === "apagar").map((a) => (a as { registro: { id: string } }).registro.id)).toEqual(["c1"]);
  });
});
