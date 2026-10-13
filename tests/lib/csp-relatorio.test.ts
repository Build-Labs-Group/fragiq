import { beforeEach, describe, expect, it, vi } from "vitest";
import { aRegistrar, limparUrl, violacoesDoCorpo, zerarJanela } from "@/lib/csp-relatorio";

beforeEach(() => zerarJanela());

const antigo = {
  "csp-report": {
    "document-uri": "https://fragiq.buildlabs.com.br/p/76561198000000001?q=segredo#x",
    "violated-directive": "img-src",
    "effective-directive": "img-src",
    "blocked-uri": "https://cdn.exemplo.com/a.png?token=abc",
  },
};

const novo = [
  {
    type: "csp-violation",
    body: { documentURL: "https://fragiq.buildlabs.com.br/", effectiveDirective: "script-src-elem", blockedURL: "inline" },
  },
  { type: "network-error", body: { phase: "dns" } },
];

describe("limparUrl", () => {
  it("tira query e hash e mantém origem e caminho", () => {
    expect(limparUrl("https://x.com/a/b?token=1#h")).toBe("https://x.com/a/b");
  });
  it("deixa passar os valores sem URL (inline, eval, data)", () => {
    expect(limparUrl("inline")).toBe("inline");
    expect(limparUrl("eval")).toBe("eval");
  });
  it("ignora o que não é texto", () => {
    expect(limparUrl(42)).toBe("");
    expect(limparUrl(undefined)).toBe("");
  });
});

describe("violacoesDoCorpo", () => {
  it("lê o formato antigo (report-uri) sem a query do documento nem do bloqueado", () => {
    expect(violacoesDoCorpo(antigo)).toEqual([
      { diretiva: "img-src", bloqueado: "https://cdn.exemplo.com/a.png", documento: "https://fragiq.buildlabs.com.br/p/76561198000000001" },
    ]);
  });
  it("lê o formato novo (report-to) e descarta relatórios que não são de CSP", () => {
    expect(violacoesDoCorpo(novo)).toEqual([
      { diretiva: "script-src-elem", bloqueado: "inline", documento: "https://fragiq.buildlabs.com.br/" },
    ]);
  });
  it("lixo vira lista vazia, e a lista tem teto", () => {
    expect(violacoesDoCorpo(null)).toEqual([]);
    expect(violacoesDoCorpo("texto")).toEqual([]);
    expect(violacoesDoCorpo({})).toEqual([]);
    const muitos = Array.from({ length: 50 }, () => novo[0]);
    expect(violacoesDoCorpo(muitos)).toHaveLength(20);
  });
});

describe("aRegistrar", () => {
  const v = { diretiva: "img-src", bloqueado: "https://a.com/x", documento: "https://f/" };

  it("registra a primeira e suprime as iguais dentro da janela, contando", () => {
    expect(aRegistrar([v], 1_000)).toEqual([{ violacao: v, suprimidas: 0 }]);
    expect(aRegistrar([v, v], 2_000)).toEqual([]);
    expect(aRegistrar([v], 11 * 60_000)).toEqual([{ violacao: v, suprimidas: 2 }]);
  });
  it("violações diferentes não se suprimem", () => {
    const outra = { ...v, bloqueado: "https://b.com/y" };
    expect(aRegistrar([v, outra], 1_000)).toHaveLength(2);
  });
});

describe("POST /api/csp-report", () => {
  async function enviar(corpo: string) {
    const { POST } = await import("@/app/api/csp-report/route");
    return POST(new Request("http://x/api/csp-report", { method: "POST", headers: { "content-type": "application/csp-report" }, body: corpo }));
  }

  it("responde 204 e deixa uma linha [csp] sem query string", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await enviar(JSON.stringify(antigo));
    expect(res.status).toBe(204);
    expect(aviso).toHaveBeenCalledTimes(1);
    const linha = String(aviso.mock.calls[0][0]);
    expect(linha).toContain("[csp]");
    expect(linha).toContain("img-src");
    expect(linha).not.toContain("segredo");
    expect(linha).not.toContain("token");
    aviso.mockRestore();
  });

  it("JSON inválido e corpo gigante também dão 204, sem log", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await enviar("{nao e json")).status).toBe(204);
    expect((await enviar(JSON.stringify({ "csp-report": { "violated-directive": "x".repeat(20_000) } }))).status).toBe(204);
    expect(aviso).not.toHaveBeenCalled();
    aviso.mockRestore();
  });
});
