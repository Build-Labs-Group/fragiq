import { assinar, SIGNATURE_HEADER } from "./cogniflow";
import { cogniflowApi } from "./env";

/**
 * Uma chamada de capability ao cogniflow, fora de qualquer turno de agente.
 *
 * É o caminho por onde o cron lê a Steam: o cogniflow tem a chave, a cota e
 * o executor; nós temos só o que perguntar. O corpo vai assinado com o
 * segredo da conexão (o mesmo do webhook e do callback), e os headers
 * dizem qual tenant e conexão assinaram — um nome forjado resolve para um
 * segredo que o forjador não tem.
 *
 * Erros mantêm o significado do cogniflow: 400 é payload que o schema
 * recusou (defeito nosso), 404 é capability que o tenant não tem (falta o
 * grant), 502 é o provedor recusando — e aí `providerStatus` traz o status
 * da própria Steam, que é o que uma tela precisa para dizer "código errado"
 * em vez de "tente de novo" — e 503 é indisponibilidade, que vale repetir.
 */
export class CogniflowApiError extends Error {
  constructor(
    readonly capability: string,
    readonly status: number,
    readonly providerStatus: number | null,
    detalhe: string,
  ) {
    super(`cogniflow ${capability} respondeu ${status}: ${detalhe}`);
    this.name = "CogniflowApiError";
  }

  /** O provedor recusou de vez ou o cogniflow recusou o pedido; repetir não muda nada. */
  get permanente() {
    return this.status !== 503 && this.status !== 429 && this.status !== 0;
  }
}

type Resposta<T> = {
  invocation_id: string;
  capability_id: string;
  status: "completed" | "accepted";
  output: T;
};

const TIMEOUT_MS = 20_000;

export async function invocar<T>(
  capability: string,
  input: Record<string, unknown>,
  opcoes: { idempotencyKey?: string; timeoutMs?: number } = {},
): Promise<T> {
  const config = await cogniflowApi();
  const body = JSON.stringify({ input, idempotency_key: opcoes.idempotencyKey });

  let res: Response;
  try {
    res = await fetch(`${config.apiUrl}/capabilities/${capability}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Cogniflow-Tenant": config.tenantId,
        "X-Cogniflow-Connection": config.connectionId,
        [SIGNATURE_HEADER]: assinar(config.signingSecret, body),
      },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(opcoes.timeoutMs ?? TIMEOUT_MS),
    });
  } catch (err) {
    throw new CogniflowApiError(capability, 0, null, err instanceof Error ? err.message : String(err));
  }

  if (!res.ok) {
    const corpo = (await res.json().catch(() => null)) as { detail?: unknown } | null;
    const detail = corpo?.detail;
    if (detail && typeof detail === "object" && "provider_status" in detail) {
      const d = detail as { error?: string; provider_status?: number };
      throw new CogniflowApiError(capability, res.status, d.provider_status ?? null, d.error ?? "");
    }
    throw new CogniflowApiError(capability, res.status, null, typeof detail === "string" ? detail : res.statusText);
  }

  const resposta = (await res.json()) as Resposta<T>;
  return resposta.output;
}
