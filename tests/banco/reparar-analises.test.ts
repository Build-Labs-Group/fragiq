import { describe, expect, it } from "vitest";
import { MOTIVO_SEM_RESPOSTA, planejarReparo, type Analise, type Mudanca } from "../../scripts/banco/reparar-analises";
import { idDaResposta } from "../../src/lib/resposta-do-analista";

/**
 * O reparo das análises deslocadas, na forma exata de produção em
 * 02–03/10/2026: uma pergunta sem resposta (turno vazio), as seguintes com
 * a resposta da pergunta de depois, e a última aberta.
 */

const CONEXAO = { tenantId: "fragiq", connectionId: "web" };
const USER = "jogador";
const CONVERSA = `${USER}:730`;
const rid = (perguntaId: string) => idDaResposta(CONEXAO, CONVERSA, perguntaId);

function pergunta(id: string, rounds: number, resposta: { de: string; rounds: number } | null, hora: number): Analise {
  return {
    id,
    userId: USER,
    gameAppId: 730,
    status: resposta ? "ANSWERED" : "ACKNOWLEDGED",
    question: `Nova sessão registrada em 02 de out, ${hora}:00: ${rounds} rounds em 2 partidas.`,
    answer: resposta ? `{"nota":"${resposta.rounds} rounds em 2 partidas"}` : null,
    replyId: resposta ? rid(resposta.de) : null,
    answeredAt: resposta ? `2026-10-02 ${hora + 1}:00:00` : null,
    createdAt: `2026-10-02 ${String(hora).padStart(2, "0")}:00:00`,
  };
}

/** Q1 certa; Q2 perdida (turno vazio) mas com a resposta de Q3; Q3 com a de Q4; Q4 aberta. */
const deslocadas = (): Analise[] => [
  pergunta("q1", 10, { de: "q1", rounds: 10 }, 10),
  pergunta("q2", 25, { de: "q3", rounds: 19 }, 12),
  pergunta("q3", 19, { de: "q4", rounds: 47 }, 14),
  pergunta("q4", 47, null, 16),
];

/** O que o banco fica depois de gravar as mudanças. */
function aplicar(analises: Analise[], mudancas: Mudanca[]): Analise[] {
  return analises.map((a) => {
    const m = mudancas.find((x) => x.id === a.id);
    return m ? { ...a, status: m.depois.status, answer: m.depois.answer, replyId: m.depois.replyId, answeredAt: m.depois.answeredAt } : a;
  });
}

describe("planejarReparo", () => {
  it("cada resposta volta para a dona; a pergunta do turno vazio fica sem resposta", () => {
    const { planos, duvidas } = planejarReparo(deslocadas(), CONEXAO);
    expect(duvidas).toEqual([]);
    expect(planos).toHaveLength(1);
    const m = new Map(planos[0]!.mudancas.map((x) => [x.id, x]));
    expect(m.has("q1")).toBe(false);
    expect(m.get("q2")).toMatchObject({ respostaDe: null, depois: { status: "FAILED", answer: null, replyId: null, error: MOTIVO_SEM_RESPOSTA } });
    expect(m.get("q3")).toMatchObject({ respostaDe: "q2", depois: { status: "ANSWERED", replyId: rid("q3"), answer: '{"nota":"19 rounds em 2 partidas"}' } });
    expect(m.get("q4")).toMatchObject({ respostaDe: "q3", depois: { status: "ANSWERED", replyId: rid("q4") } });
    // A hora da resposta vai junto, como texto (sem passar por fuso).
    expect(m.get("q4")!.depois.answeredAt).toBe("2026-10-02 15:00:00");
  });

  it("idempotente: depois de aplicar, o plano seguinte é vazio", () => {
    const antes = deslocadas();
    const depois = aplicar(antes, planejarReparo(antes, CONEXAO).planos[0]!.mudancas);
    expect(planejarReparo(depois, CONEXAO)).toEqual({ planos: [], duvidas: [] });
  });

  it("conversa sem deslocamento não gera plano", () => {
    expect(planejarReparo([pergunta("q1", 10, { de: "q1", rounds: 10 }, 10)], CONEXAO)).toEqual({ planos: [], duvidas: [] });
  });

  it("resposta sem dona calculável: a conversa inteira fica de fora, listada", () => {
    const analises = deslocadas();
    analises[1] = { ...analises[1]!, replyId: "id-de-outro-lugar" };
    const { planos, duvidas } = planejarReparo(analises, CONEXAO);
    expect(planos).toEqual([]);
    expect(duvidas[0]).toMatchObject({ conversa: CONVERSA });
  });

  it("rounds da resposta diferentes dos da pergunta dona: dúvida, não mexe", () => {
    const analises = deslocadas();
    analises[2] = { ...analises[2]!, answer: '{"nota":"99 rounds em 5 partidas"}' };
    const { planos, duvidas } = planejarReparo(analises, CONEXAO);
    expect(planos).toEqual([]);
    expect(duvidas[0]!.motivo).toMatch(/rounds/);
  });

  it("conversas são independentes: a dúvida de uma não segura a outra", () => {
    const outra = deslocadas().map((a) => ({ ...a, userId: "outro" }));
    outra[1] = { ...outra[1]!, replyId: "id-de-outro-lugar" };
    const { planos, duvidas } = planejarReparo([...deslocadas(), ...outra], CONEXAO);
    expect(planos.map((p) => p.conversa)).toEqual([CONVERSA]);
    expect(duvidas.map((d) => d.conversa)).toEqual(["outro:730"]);
  });
});
