import { beforeEach, describe, expect, it, vi } from "vitest";
import { donaDaResposta, idDaResposta, uuid5 } from "@/lib/resposta-do-analista";

/**
 * A resposta do analista cai na pergunta que a pediu, nunca na vizinha.
 *
 * O bug de 02/10/2026: um turno sem resposta deixou uma pergunta aberta, e a
 * regra "a mais antiga em aberto é a dona" passou a gravar cada resposta na
 * pergunta anterior à dela. A sessão das 16:13 mostrava a análise da sessão
 * das 20:56, e a última sessão ficava sempre sem análise.
 */

const CONEXAO = { tenantId: "fragiq", connectionId: "web" };
const CONVERSA = "usuario-teste:730";

describe("idDaResposta: o id que o cogniflow dá à resposta", () => {
  it("uuid5 é o mesmo do Python (vetor da documentação do módulo uuid)", () => {
    // uuid.uuid5(uuid.NAMESPACE_DNS, "python.org")
    expect(uuid5("6ba7b810-9dad-11d1-80b4-00c04fd430c8", "python.org")).toBe("886313e1-3b8a-5372-9b90-0c9aee199e5d");
  });

  it("deriva do id da pergunta, da conversa e da conexão", () => {
    // Fixado para pegar mudança acidental na montagem do nome. A derivação
    // foi conferida contra 25 respostas reais de produção em 03/10/2026.
    expect(idDaResposta(CONEXAO, CONVERSA, "pergunta-b")).toBe("1c96dcf0-8482-5c6c-bf6b-61522bf5ab42");
    expect(idDaResposta(CONEXAO, CONVERSA, "pergunta-a")).not.toBe(idDaResposta(CONEXAO, CONVERSA, "pergunta-b"));
    expect(idDaResposta(CONEXAO, "outro:730", "pergunta-b")).not.toBe(idDaResposta(CONEXAO, CONVERSA, "pergunta-b"));
  });
});

describe("donaDaResposta", () => {
  const abertas = [
    { id: "pergunta-b", aberta: true },
    { id: "pergunta-a", aberta: true },
  ];

  it("com duas abertas, o id derivado escolhe a certa (a regra antiga escolhia a mais antiga)", () => {
    const id = idDaResposta(CONEXAO, CONVERSA, "pergunta-b");
    expect(donaDaResposta({ id }, CONVERSA, abertas, CONEXAO)).toEqual({ perguntaId: "pergunta-b", prova: "id_derivado" });
  });

  it("uma resposta atrasada acha a dona mesmo fechada, e não a pergunta seguinte", () => {
    const perguntas = [
      { id: "pergunta-b", aberta: true },
      { id: "pergunta-a", aberta: false },
    ];
    const id = idDaResposta(CONEXAO, CONVERSA, "pergunta-a");
    expect(donaDaResposta({ id }, CONVERSA, perguntas, CONEXAO)).toEqual({ perguntaId: "pergunta-a", prova: "id_derivado" });
  });

  it("reply_to_message_id vale mais que tudo", () => {
    const id = idDaResposta(CONEXAO, CONVERSA, "pergunta-b");
    expect(donaDaResposta({ id, replyToMessageId: "pergunta-a" }, CONVERSA, abertas, CONEXAO)).toEqual({
      perguntaId: "pergunta-a",
      prova: "reply_to",
    });
  });

  it("id desconhecido com uma só aberta: é ela", () => {
    expect(donaDaResposta({ id: "outro" }, CONVERSA, [{ id: "pergunta-a", aberta: true }], CONEXAO)).toEqual({
      perguntaId: "pergunta-a",
      prova: "unica_aberta",
    });
  });

  it("id desconhecido com duas abertas: ninguém (gravar na errada é pior que não gravar)", () => {
    expect(donaDaResposta({ id: "outro" }, CONVERSA, abertas, CONEXAO)).toEqual({ perguntaId: null, motivo: "ambigua" });
  });

  it("sem conexão configurada, cai na regra da única aberta", () => {
    const id = idDaResposta(CONEXAO, CONVERSA, "pergunta-b");
    expect(donaDaResposta({ id }, CONVERSA, abertas, null)).toEqual({ perguntaId: null, motivo: "ambigua" });
  });
});

/* ------------------------------ a rota inteira ----------------------------- */

const prisma = {
  // `findFirst` é o que a regra antiga usava ("a mais antiga em aberto").
  analysis: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
};
const registrar = vi.fn();
const enfileirarAnaliseNoSteam = vi.fn(async () => true);

vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/lib/eventos", () => ({ registrar, reportarErro: vi.fn() }));
vi.mock("@/lib/mensagem-steam", () => ({ enfileirarAnaliseNoSteam }));
vi.mock("@/lib/cogniflow", () => ({
  lerCorpoAssinado: vi.fn(async (req: Request) => ({ ok: true, body: await req.json() })),
  parseConversationId: (v: string) => {
    const [userId, appId] = v.split(":");
    return userId && appId ? { userId, appId: Number(appId) } : null;
  },
}));

function resposta(id: string, extra: Record<string, unknown> = {}) {
  return new Request("http://x/api/cogniflow/callback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "message", id, conversation_id: CONVERSA, text: "análise", ...extra }),
  });
}

describe("POST /api/cogniflow/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.COGNIFLOW_TENANT_ID = "fragiq";
    process.env.COGNIFLOW_CONNECTION_ID = "web";
    prisma.analysis.findUnique.mockResolvedValue(null);
    prisma.analysis.findFirst.mockResolvedValue({ id: "pergunta-a" });
  });

  it("a pergunta perdida não rouba a resposta da pergunta nova", async () => {
    // A ordem do banco é da mais recente para a mais antiga: a perdida é a
    // mais antiga em aberto, e era ela que recebia a resposta.
    prisma.analysis.findMany.mockResolvedValue([
      { id: "pergunta-b", status: "ACKNOWLEDGED" },
      { id: "pergunta-a", status: "ACKNOWLEDGED" },
    ]);
    const { POST } = await import("@/app/api/cogniflow/callback/route");
    const res = await POST(resposta(idDaResposta(CONEXAO, CONVERSA, "pergunta-b")) as never);

    expect(res.status).toBe(200);
    expect(prisma.analysis.update).toHaveBeenCalledTimes(1);
    expect(prisma.analysis.update.mock.calls[0][0].where).toEqual({ id: "pergunta-b" });
    expect(prisma.analysis.update.mock.calls[0][0].data).toMatchObject({ status: "ANSWERED", answer: "análise" });
    expect(enfileirarAnaliseNoSteam).toHaveBeenCalledWith("pergunta-b");
  }, 30_000);

  it("sem dona provada, não grava e deixa no diário", async () => {
    prisma.analysis.findMany.mockResolvedValue([
      { id: "pergunta-b", status: "ACKNOWLEDGED" },
      { id: "pergunta-a", status: "ACKNOWLEDGED" },
    ]);
    const { POST } = await import("@/app/api/cogniflow/callback/route");
    const res = await POST(resposta("id-que-ninguem-gerou") as never);

    expect(await res.json()).toMatchObject({ ok: true, orphan: true });
    expect(prisma.analysis.update).not.toHaveBeenCalled();
    expect(registrar).toHaveBeenCalledWith("analise.resposta_sem_dona", expect.objectContaining({ userId: "usuario-teste" }));
  }, 30_000);

  it("não sobrescreve uma pergunta que já tem resposta", async () => {
    prisma.analysis.findMany.mockResolvedValue([{ id: "pergunta-a", status: "ANSWERED" }]);
    const { POST } = await import("@/app/api/cogniflow/callback/route");
    const res = await POST(resposta(idDaResposta(CONEXAO, CONVERSA, "pergunta-a")) as never);

    expect(await res.json()).toMatchObject({ conflict: true });
    expect(prisma.analysis.update).not.toHaveBeenCalled();
    expect(registrar).toHaveBeenCalledWith("analise.resposta_conflito", expect.anything());
  }, 30_000);

  it("resposta repetida (mesmo id) não escreve de novo", async () => {
    prisma.analysis.findUnique.mockResolvedValue({ id: "pergunta-a" });
    const { POST } = await import("@/app/api/cogniflow/callback/route");
    const res = await POST(resposta("ja-gravada") as never);

    expect(await res.json()).toMatchObject({ duplicate: true });
    expect(prisma.analysis.findMany).not.toHaveBeenCalled();
  }, 30_000);
});
