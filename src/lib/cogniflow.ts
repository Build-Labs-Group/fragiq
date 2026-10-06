import { createHmac, timingSafeEqual } from "node:crypto";
import { cogniflow, type Cogniflow } from "./env";

/**
 * O FragIQ como cliente do cogniflow.
 *
 * O cogniflow é um runtime de agentes que fala com canais: WhatsApp, e-mail,
 * e uma aplicação de cliente por webhook. O FragIQ é essa aplicação. Cada
 * pergunta ao analista vira uma mensagem numa conversa por (usuário, jogo),
 * e a resposta volta por POST no nosso callback. Durante o turno, o agente
 * consulta a série pelo nosso endpoint de dados — a mesma assinatura protege
 * os três caminhos.
 */

export const SIGNATURE_HEADER = "x-signature-256";

export function assinar(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** Compara em tempo constante; um header ausente ou malformado é só falso. */
export function assinaturaValida(
  secret: string,
  body: string,
  header: string | null,
): boolean {
  if (!header) return false;
  const esperada = Buffer.from(assinar(secret, body));
  const recebida = Buffer.from(header);
  return esperada.length === recebida.length && timingSafeEqual(esperada, recebida);
}

/**
 * Uma conversa por jogador e jogo. É a chave da memória do agente, então
 * "e no Mirage?" depois de "como fui esta semana?" continua fazendo sentido.
 */
export function conversationId(userId: string, appId: number) {
  return `${userId}:${appId}`;
}

export function parseConversationId(value: string): { userId: string; appId: number } | null {
  const i = value.lastIndexOf(":");
  if (i <= 0) return null;
  const appId = Number(value.slice(i + 1));
  if (!Number.isInteger(appId)) return null;
  return { userId: value.slice(0, i), appId };
}

/**
 * O que o agente recebe de volta em `context` quando pede dados.
 *
 * `sessao` amarra o turno à sessão perguntada: a coleta que a fecha e o
 * modo provado dela. Com isso `/api/cogniflow/data` corta a série nessa
 * coleta e toda view lê aquela sessão, não "a última" na hora do turno
 * (`recortarParaSessao`). Opcional: perguntas anteriores a 05/10/2026 não
 * têm, e sem ele as views leem a série inteira, como antes.
 */
export type ContextoDaPergunta = {
  userId: string;
  appId: number;
  sessao?: { ate: string; modo: string | null };
};

export async function enviarPergunta(
  config: Cogniflow,
  pergunta: {
    id: string;
    userId: string;
    appId: number;
    personaName: string;
    texto: string;
    sessao?: { ate: string; modo: string | null };
  },
): Promise<void> {
  const contexto: ContextoDaPergunta = { userId: pergunta.userId, appId: pergunta.appId };
  if (pergunta.sessao) contexto.sessao = pergunta.sessao;
  const body = JSON.stringify({
    client_id: config.clientId,
    conversation_id: conversationId(pergunta.userId, pergunta.appId),
    sender: { id: pergunta.userId, name: pergunta.personaName },
    message: { id: pergunta.id, text: pergunta.texto },
    context: contexto,
  });

  const res = await fetch(config.webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [SIGNATURE_HEADER]: assinar(config.signingSecret, body),
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const detalhe = await res.text().catch(() => "");
    throw new Error(`cogniflow respondeu ${res.status}: ${detalhe.slice(0, 200)}`);
  }
}

/**
 * Lê o corpo cru e confere a assinatura antes de qualquer parse. É o que
 * torna o callback e o endpoint de dados públicos sem serem abertos: só quem
 * tem o segredo produz um header que bate.
 */
export async function lerCorpoAssinado(
  request: Request,
): Promise<{ ok: true; body: unknown } | { ok: false; status: number; error: string }> {
  const config = await cogniflow();
  if (!config) return { ok: false, status: 404, error: "Analista não configurado." };

  const raw = await request.text();
  if (!assinaturaValida(config.signingSecret, raw, request.headers.get(SIGNATURE_HEADER))) {
    return { ok: false, status: 403, error: "Assinatura inválida." };
  }

  try {
    return { ok: true, body: JSON.parse(raw) };
  } catch {
    return { ok: false, status: 400, error: "JSON malformado." };
  }
}
