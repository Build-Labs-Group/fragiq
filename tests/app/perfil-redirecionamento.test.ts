import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Na Lambda, `request.url` chega com o host interno do adaptador
 * (`https://localhost:8080`). A busca da home e o "comparar com…" montavam o
 * redirecionamento em cima dele e mandavam a pessoa para localhost; o login e o
 * logout já usavam `appUrl()`. O teste simula esse host e exige o domínio público.
 */
const resolverEntrada = vi.fn();
vi.mock("@/lib/perfil-publico", async () => ({
  resolverEntrada,
  pareceSteamId: (v: string) => /^7656119\d{10}$/.test(v),
}));

const A = "76561198000000001";
const B = "76561198000000002";
const HOST_INTERNO = "https://localhost:8080";

beforeEach(() => {
  process.env.APP_URL = "https://fragiq.buildlabs.com.br";
  resolverEntrada.mockReset();
});
afterEach(() => {
  delete process.env.APP_URL;
});

describe("redirecionamentos do perfil saem no domínio público", () => {
  it("buscar: perfil achado", async () => {
    resolverEntrada.mockResolvedValue(B);
    const { GET } = await import("@/app/api/perfil/buscar/route");
    const res = await GET(new NextRequest(`${HOST_INTERNO}/api/perfil/buscar?q=algo`));
    expect(res.headers.get("location")).toBe(`https://fragiq.buildlabs.com.br/p/${B}`);
  });

  it("buscar: não achado volta para a home com o aviso", async () => {
    resolverEntrada.mockResolvedValue(null);
    const { GET } = await import("@/app/api/perfil/buscar/route");
    const res = await GET(new NextRequest(`${HOST_INTERNO}/api/perfil/buscar?q=ninguem`));
    const destino = new URL(res.headers.get("location") ?? "");
    expect(destino.origin).toBe("https://fragiq.buildlabs.com.br");
    expect(destino.pathname).toBe("/");
    expect(destino.searchParams.get("erro")).toContain("Não achei esse perfil");
  });

  it("comparar: dois perfis levam à comparação", async () => {
    resolverEntrada.mockResolvedValue(B);
    const { GET } = await import("@/app/api/perfil/comparar/route");
    const res = await GET(new NextRequest(`${HOST_INTERNO}/api/perfil/comparar?a=${A}&q=algo`));
    expect(res.headers.get("location")).toBe(`https://fragiq.buildlabs.com.br/p/${A}/vs/${B}`);
  });

  it("comparar: sem o segundo perfil volta ao primeiro com o aviso", async () => {
    resolverEntrada.mockResolvedValue(null);
    const { GET } = await import("@/app/api/perfil/comparar/route");
    const res = await GET(new NextRequest(`${HOST_INTERNO}/api/perfil/comparar?a=${A}&q=ninguem`));
    const destino = new URL(res.headers.get("location") ?? "");
    expect(destino.origin).toBe("https://fragiq.buildlabs.com.br");
    expect(destino.pathname).toBe(`/p/${A}`);
  });
});
