import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { lerCorpoAssinado, parseConversationId } from "@/lib/cogniflow";
import { enfileirarAnaliseNoSteam } from "@/lib/mensagem-steam";
import { registrar, reportarErro } from "@/lib/eventos";
import { donaDaResposta, type Conexao } from "@/lib/resposta-do-analista";

export const dynamic = "force-dynamic";

/**
 * O que o cogniflow nos devolve: a resposta do analista, ou o aviso de que
 * a pergunta chegou e está sendo respondida.
 *
 * A resposta não traz o id da nossa pergunta, mas o `id` dela é derivado
 * desse id (determinístico por turno): é por ele que a dona é achada
 * (`src/lib/resposta-do-analista.ts`). "A mais antiga em aberto" foi a
 * regra até 03/10/2026, e um único turno sem resposta deslocou todas as
 * análises seguintes de um jogador em uma sessão.
 *
 * Repetições são esperadas: a fila entrega ao menos uma vez. Um `replyId`
 * já gravado responde 200 sem escrever nada, senão a fila tentaria de novo.
 */

const mensagem = z.object({
  type: z.literal("message"),
  id: z.string().min(1),
  conversation_id: z.string().min(1),
  text: z.string(),
  /** Só vem quando o agente respondeu citando uma mensagem; é a prova mais forte. */
  reply_to_message_id: z.string().nullish(),
});

const confirmacao = z.object({
  type: z.literal("acknowledgement"),
  conversation_id: z.string().min(1),
  message_id: z.string().min(1),
});

const schema = z.discriminatedUnion("type", [mensagem, confirmacao]);

/** Perguntas da conversa consideradas na busca da dona (as mais recentes). */
const PERGUNTAS_CONSIDERADAS = 50;

function conexaoDoCogniflow(): Conexao | null {
  const tenantId = process.env.COGNIFLOW_TENANT_ID?.trim();
  const connectionId = process.env.COGNIFLOW_CONNECTION_ID?.trim();
  return tenantId && connectionId ? { tenantId, connectionId } : null;
}

export async function POST(request: NextRequest) {
  const lido = await lerCorpoAssinado(request);
  if (!lido.ok) return NextResponse.json({ error: lido.error }, { status: lido.status });

  const parsed = schema.safeParse(lido.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }
  const evento = parsed.data;

  const conversa = parseConversationId(evento.conversation_id);
  if (!conversa) {
    return NextResponse.json({ error: "conversation_id inválido." }, { status: 400 });
  }

  if (evento.type === "acknowledgement") {
    // message_id é o nosso próprio ID de pergunta — foi o que mandamos.
    await prisma.analysis.updateMany({
      where: { id: evento.message_id, userId: conversa.userId, status: "PENDING" },
      data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  }

  const repetida = await prisma.analysis.findUnique({
    where: { replyId: evento.id },
    select: { id: true },
  });
  if (repetida) return NextResponse.json({ ok: true, duplicate: true });

  const perguntas = await prisma.analysis.findMany({
    where: { userId: conversa.userId, gameAppId: conversa.appId },
    orderBy: { createdAt: "desc" },
    take: PERGUNTAS_CONSIDERADAS,
    select: { id: true, status: true },
  });
  const dona = donaDaResposta(
    { id: evento.id, replyToMessageId: evento.reply_to_message_id },
    evento.conversation_id,
    perguntas.map((p) => ({ id: p.id, aberta: p.status === "PENDING" || p.status === "ACKNOWLEDGED" })),
    conexaoDoCogniflow(),
  );

  if (dona.perguntaId === null) {
    // Sem dona provada: chegou tarde para uma pergunta que já saiu da
    // janela, o agente falou sem ser perguntado, ou há mais de uma aberta e
    // nada diz qual. Aceitar sem gravar mantém a fila do cogniflow andando;
    // o diário guarda o que chegou para alguém decidir.
    console.warn("[cogniflow] resposta sem dona:", evento.conversation_id, dona.motivo);
    await registrar("analise.resposta_sem_dona", {
      userId: conversa.userId,
      dados: { replyId: evento.id, motivo: dona.motivo, abertas: perguntas.filter((p) => p.status === "PENDING" || p.status === "ACKNOWLEDGED").length },
    });
    return NextResponse.json({ ok: true, orphan: true });
  }

  const alvo = perguntas.find((p) => p.id === dona.perguntaId)!;
  if (alvo.status === "ANSWERED") {
    // A dona já tem outra resposta gravada (só acontece com dado anterior à
    // correção). Sobrescrever apagaria o que está na tela sem prova de qual
    // é a certa: fica no diário.
    console.warn("[cogniflow] resposta para pergunta já respondida:", dona.perguntaId);
    await registrar("analise.resposta_conflito", {
      userId: conversa.userId,
      dados: { replyId: evento.id, perguntaId: dona.perguntaId, prova: dona.prova },
    });
    return NextResponse.json({ ok: true, conflict: true });
  }

  await prisma.analysis.update({
    where: { id: dona.perguntaId },
    data: {
      answer: evento.text,
      status: "ANSWERED",
      replyId: evento.id,
      answeredAt: new Date(),
      error: null,
    },
  });
  if (dona.prova !== "id_derivado") {
    // A derivação do id é a prova esperada; outra prova é sinal de que o
    // cogniflow mudou o jeito de montar o id.
    console.info("[cogniflow] dona da resposta por", dona.prova, dona.perguntaId);
  }

  // A análise de sessão também vai para o chat da Steam, pelo bot. Falha
  // aqui não pode derrubar o callback — a resposta já está gravada.
  await enfileirarAnaliseNoSteam(dona.perguntaId).catch((e) => reportarErro("cogniflow.mensagemSteam", e));

  return NextResponse.json({ ok: true });
}
