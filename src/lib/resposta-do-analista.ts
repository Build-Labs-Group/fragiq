import { createHash } from "node:crypto";

/**
 * De qual pergunta é a resposta que o cogniflow devolveu.
 *
 * O callback (`/api/cogniflow/callback`) recebe a resposta do analista com o
 * `id` da resposta e a conversa, mas não com o id da nossa pergunta. Até
 * 03/10/2026 a regra era "a pergunta mais antiga em aberto na conversa é a
 * dona", apoiada na premissa de que só existe uma em aberto por vez. A
 * análise de sessão quebra a premissa: cada sessão nova abre uma pergunta,
 * sem esperar a anterior. Em 02/10, às 15:33 UTC, um turno do analista
 * terminou sem texto (modelo `gpt-oss-20b`, que gastava os tokens no
 * raciocínio) e a pergunta ficou aberta para sempre. Dali em diante cada
 * resposta caiu na pergunta anterior à dela: a sessão das 16:13 mostrava a
 * análise da sessão das 20:56, e a última sessão ficava sempre "perdida".
 *
 * A resposta tem dono certo sem adivinhar. O `id` da resposta é
 * determinístico por turno no cogniflow (é o que já usamos para descartar
 * repetição), e é derivado do id da mensagem que abriu o turno — a nossa
 * pergunta:
 *
 *     event_id = "{tenant}:webhook:{conexão}:{id da pergunta}"
 *     id       = uuid5(NAMESPACE_URL,
 *                "message.send.requested:{tenant}:{conexão}:{conversa}:{event_id}:default")
 *
 * (cogniflow: `orchestration-service/app/workers/requests.py::event_id_of` e
 * `app/capabilities/messaging.py::_command_id`; contrato descrito em
 * `docs/cogniflow-tenant.md`). Conferido contra 25 respostas de produção.
 *
 * Ordem de decisão, da prova mais forte para a mais fraca:
 * 1. `reply_to_message_id` igual ao id de uma pergunta da conversa;
 * 2. o `id` da resposta igual ao derivado de uma pergunta da conversa;
 * 3. uma única pergunta em aberto na conversa (o caso de sempre, e a
 *    rede de segurança se o cogniflow mudar a derivação).
 * Fora disso a resposta fica sem dono: gravar na pergunta errada é pior
 * do que não gravar, porque a tela mostraria a análise de outra sessão.
 */

/** `uuid.NAMESPACE_URL` do Python (RFC 4122). */
const NAMESPACE_URL = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";

/** O provedor da conexão webhook no cogniflow, como entra no `event_id`. */
const PROVEDOR = "webhook";

/** uuid versão 5 (SHA-1), igual ao `uuid.uuid5` do Python. */
export function uuid5(namespace: string, nome: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const h = createHash("sha1").update(Buffer.concat([ns, Buffer.from(nome, "utf8")])).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export type Conexao = { tenantId: string; connectionId: string };

/** O `id` que a resposta do cogniflow à pergunta `perguntaId` terá. */
export function idDaResposta(conexao: Conexao, conversationId: string, perguntaId: string): string {
  const eventId = `${conexao.tenantId}:${PROVEDOR}:${conexao.connectionId}:${perguntaId}`;
  return uuid5(
    NAMESPACE_URL,
    `message.send.requested:${conexao.tenantId}:${conexao.connectionId}:${conversationId}:${eventId}:default`,
  );
}

export type Pergunta = { id: string; aberta: boolean };

export type Dona =
  | { perguntaId: string; prova: "reply_to" | "id_derivado" | "unica_aberta" }
  | { perguntaId: null; motivo: "nenhuma_aberta" | "ambigua" };

/**
 * Escolhe a pergunta dona da resposta entre as perguntas da conversa.
 *
 * `perguntas` são as da conversa (abertas e fechadas, das mais recentes):
 * uma resposta atrasada a uma pergunta já dada como perdida ainda acha a
 * dona pelo id, e não cai na pergunta seguinte.
 */
export function donaDaResposta(
  resposta: { id: string; replyToMessageId?: string | null },
  conversationId: string,
  perguntas: Pergunta[],
  conexao: Conexao | null,
): Dona {
  if (resposta.replyToMessageId) {
    const alvo = perguntas.find((p) => p.id === resposta.replyToMessageId);
    if (alvo) return { perguntaId: alvo.id, prova: "reply_to" };
  }
  if (conexao) {
    const alvo = perguntas.find((p) => idDaResposta(conexao, conversationId, p.id) === resposta.id);
    if (alvo) return { perguntaId: alvo.id, prova: "id_derivado" };
  }
  const abertas = perguntas.filter((p) => p.aberta);
  if (abertas.length === 1) return { perguntaId: abertas[0].id, prova: "unica_aberta" };
  return { perguntaId: null, motivo: abertas.length === 0 ? "nenhuma_aberta" : "ambigua" };
}
