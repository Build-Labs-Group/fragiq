import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashDaJanela, janelaDaSessao } from "@/lib/analise-sessao";
import { idDaResposta, mensagensDaPergunta } from "@/lib/resposta-do-analista";
import { normal, serie } from "./fixtures";

/**
 * Banco → tela: o que `listarAnalises` entrega ao cartão a partir das linhas
 * gravadas (`analyses`, `sessions`, `insights`), e o que `pedirDeNovo` grava.
 * Prisma é mockado com as linhas na forma de produção; a regra da casa é
 * que o dado gravado manda, e a tela só repete o que ele diz.
 */
const prisma = {
  analysis: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), count: vi.fn() },
  session: { findMany: vi.fn(), findUnique: vi.fn() },
  insight: { findMany: vi.fn() },
};
const enviarPergunta = vi.fn(async () => {});

vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/lib/env", () => ({ cogniflow: async () => ({ clientId: "c", webhookUrl: "http://x", signingSecret: "s" }) }));
vi.mock("@/lib/cogniflow", () => ({ enviarPergunta }));

// A série: seis sessões normais e duas que importam (penúltima K/D 1,50; última com 1 round e 4.364 de dano).
const rows = serie([...Array.from({ length: 6 }, () => normal()), normal({ kills: 45 }), { rounds: 1, kills: 3, deaths: 1, dano: 4364 }]);
const id = (i: number) => rows[i].id!;
const n = rows.length;

const sessaoBoa = {
  id: "sess-boa",
  deSnapshotId: id(n - 3),
  ateSnapshotId: id(n - 2),
  ate: rows[n - 2].capturedAt,
  minutos: 40,
  rounds: 30,
  partidas: 1,
  kills: 45,
  deaths: 30,
  dano: 2250,
  headshots: 12,
  modo: null,
  modoConfianca: "MISTA" as const,
  mapa: null,
  placar: null,
};
const sessaoDeUmRound = {
  ...sessaoBoa,
  id: "sess-1r",
  deSnapshotId: id(n - 2),
  ateSnapshotId: id(n - 1),
  ate: rows[n - 1].capturedAt,
  rounds: 1,
  kills: 3,
  deaths: 1,
  dano: 4364,
  headshots: 1,
};

const insightKd = {
  escopoId: "sess-boa",
  regra: "kd.vs.normal",
  valor: 1.5,
  referencia: 0.6466,
  referenciaTipo: "vitalicio",
  base: { rounds: 30 },
  dados: { delta: { estado: "ok", valor: 132, unidade: "%", direcao: "sobe", valencia: "good", fraco: false } },
};

const analise = (o: Record<string, unknown>) => ({
  id: "a1",
  kind: "SESSION",
  answer: null,
  status: "ANSWERED",
  createdAt: new Date(),
  answeredAt: new Date(),
  pedidaEm: null,
  snapshotId: sessaoBoa.ateSnapshotId,
  janelaHash: null,
  historico: null,
  snapshot: { capturedAt: sessaoBoa.ate },
  ...o,
});

const RESPOSTA_DESTA = JSON.stringify({
  manchete: "Noite de 30 rounds no Competitivo em Mirage",
  achados: [
    { rotulo: "K/D", valor: 1.5, referencia: 0.71, melhorQuando: "sobe" },
    { rotulo: "Kills por round", valor: 1.5, referencia: 1, melhorQuando: "desce", nota: "subiu" },
  ],
  causa: "Mais kills por round",
  acao: "Repita a postura agressiva",
});

beforeEach(() => {
  vi.clearAllMocks();
  prisma.session.findMany.mockResolvedValue([sessaoBoa, sessaoDeUmRound]);
  prisma.insight.findMany.mockResolvedValue([insightKd]);
});

describe("listarAnalises: o cartão é o que o banco diz", () => {
  it("o chip de K/D do cartão é o do insight gravado (o mesmo da tabela de Sessões), não um recálculo", async () => {
    prisma.analysis.findMany.mockResolvedValue([analise({ answer: RESPOSTA_DESTA })]);
    const { listarAnalises } = await import("@/lib/analises");
    const [a] = await listarAnalises("u1", 730, { rows });

    const kd = a.sessao!.numeros.find((x) => x.chave === "kd")!;
    expect(kd.texto).toBe("1,50");
    expect(kd.delta).toEqual(insightKd.dados.delta);
    expect(kd.referencia).toBe("vitalício 0,65");
  });

  it("a análise certa vai para a tela limpa: sem JSON, sem modo/mapa não provados, direção da tabela", async () => {
    prisma.analysis.findMany.mockResolvedValue([analise({ answer: RESPOSTA_DESTA })]);
    const { listarAnalises } = await import("@/lib/analises");
    const [a] = await listarAnalises("u1", 730, { rows });

    expect(a.estado).toBe("ok");
    expect(a.leitura?.forma).toBe("estruturada");
    if (a.leitura?.forma !== "estruturada") return;
    expect(a.leitura.leitura.manchete).toBe("Noite de 30 rounds");
    // K/D fica no cartão; o achado que sobra é o de kills por round, com a cor da tabela ("sobe"), não a do modelo ("desce").
    expect(a.leitura.leitura.achados.map((x) => x.id)).toEqual(["kpr"]);
    expect(a.leitura.leitura.achados[0].delta).toMatchObject({ valencia: "good" });
    expect(JSON.stringify(a)).not.toContain('\\"manchete\\"');
  });

  it("análise com números de outra sessão não mostra texto e pode ser pedida de novo", async () => {
    const deOutra = JSON.stringify({ manchete: "Sessão boa", achados: [{ rotulo: "K/D na nova sessão", valor: 0.67 }] });
    prisma.analysis.findMany.mockResolvedValue([analise({ answer: deOutra })]);
    const { listarAnalises } = await import("@/lib/analises");
    const [a] = await listarAnalises("u1", 730, { rows });

    expect(a.estado).toBe("outra-sessao");
    expect(a.leitura).toBeNull();
    expect(a.podePedirDeNovo).toBe(true);
  });

  it("sessão reagrupada depois da pergunta: desatualizada", async () => {
    const antiga = janelaDaSessao({ ...sessaoBoa, deSnapshotId: id(n - 4), rounds: 60 });
    prisma.analysis.findMany.mockResolvedValue([analise({ answer: RESPOSTA_DESTA, janelaHash: hashDaJanela(antiga) })]);
    const { listarAnalises } = await import("@/lib/analises");
    const [a] = await listarAnalises("u1", 730, { rows });

    expect(a.estado).toBe("desatualizada");
    expect(a.leitura).toBeNull();
  });

  it("sessão de 1 round com 4.364 de dano: sem dano por round e sem texto, e não pede de novo", async () => {
    prisma.analysis.findMany.mockResolvedValue([analise({ id: "a2", snapshotId: sessaoDeUmRound.ateSnapshotId, answer: RESPOSTA_DESTA })]);
    const { listarAnalises } = await import("@/lib/analises");
    const [a] = await listarAnalises("u1", 730, { rows });

    expect(a.estado).toBe("incompleta");
    expect(a.podePedirDeNovo).toBe(false);
    const adr = a.sessao!.numeros.find((x) => x.chave === "adr")!;
    expect(adr.valor).toBeNull();
    expect(adr.texto).toBe("—");
    expect(adr.motivo).toMatch(/contadores incompletos/);
  });
});

describe("pedirDeNovo: o que fica gravado", () => {
  const linha = {
    id: "a1",
    status: "ANSWERED",
    answer: "texto antigo",
    createdAt: new Date(Date.now() - 86_400_000),
    pedidaEm: null,
    snapshotId: sessaoBoa.ateSnapshotId,
    historico: null,
    user: { personaName: "Jogador" },
  };

  it("regrava a janela, guarda o texto anterior no histórico e manda com id de mensagem novo", async () => {
    prisma.analysis.findFirst.mockResolvedValue(linha);
    prisma.session.findUnique.mockResolvedValue(sessaoBoa);
    prisma.analysis.count.mockResolvedValue(0);
    const { pedirDeNovo } = await import("@/lib/analises");

    expect(await pedirDeNovo("u1", 730, "a1", "outra-sessao")).toEqual({ pedida: true, id: "a1" });
    const data = prisma.analysis.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: "PENDING", answer: null, replyId: null, janelaHash: hashDaJanela(janelaDaSessao(sessaoBoa)) });
    expect(data.historico).toEqual([{ em: expect.any(String), motivo: "outra-sessao", respostaAnterior: "texto antigo" }]);
    expect(enviarPergunta).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: "a1.1", sessao: { ate: sessaoBoa.ateSnapshotId, modo: null } }));
    // O callback acha a dona pela mensagem nova (`<id>.1`).
    expect(mensagensDaPergunta({ id: "a1", repedidos: data.historico.length })).toContain("a1.1");
    expect(idDaResposta({ tenantId: "t", connectionId: "c" }, "u1:730", "a1.1")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("não pede com outra pergunta em aberto na conversa, nem passa do limite", async () => {
    prisma.analysis.findFirst.mockResolvedValue(linha);
    prisma.session.findUnique.mockResolvedValue(sessaoBoa);
    prisma.analysis.count.mockResolvedValue(1);
    const { pedirDeNovo, MAX_REPEDIDOS } = await import("@/lib/analises");
    expect(await pedirDeNovo("u1", 730, "a1", "x")).toEqual({ pedida: false, motivo: "outra-em-aberto" });

    prisma.analysis.findFirst.mockResolvedValue({ ...linha, historico: Array.from({ length: MAX_REPEDIDOS }, () => ({})) });
    expect(await pedirDeNovo("u1", 730, "a1", "x")).toEqual({ pedida: false, motivo: "limite" });
    expect(prisma.analysis.update).not.toHaveBeenCalled();
    expect(enviarPergunta).not.toHaveBeenCalled();
  });
});
