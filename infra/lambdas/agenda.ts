/**
 * A coleta diária (o cron da Vercel, `0 5 * * *`), na AWS.
 *
 * O EventBridge Scheduler chama esta Lambda, que chama a Lambda do site
 * **direto** (Invoke), com um evento no formato da HTTP API: `GET
 * /api/cron/sync` com o Bearer do `CRON_SECRET`. Direto, e não pela URL
 * pública, porque a HTTP API corta em 30 s e a coleta tem orçamento de 45 s
 * (`CRON_TIME_BUDGET_MS`), com teto de 300 s na rota. A rota do site não
 * muda: é a mesma que a Vercel chama.
 *
 * A mesma Lambda faz a checagem de saúde dos dados de 30 em 30 min (origem
 * `saude`, rota `/api/cron/saude`): partida sem sessão, análise sem
 * resposta e captura vencida, que viram métricas e alarmes na pilha.
 *
 * O `CRON_SECRET` vem do parâmetro do site e nunca vai para log. A resposta
 * da rota (contagens: candidatos, sincronizados, falhas, pulados) vai, para
 * a conferência tela ↔ banco ↔ logs bater com a linha de `CronRun`.
 */
import { randomUUID } from "node:crypto";
import { InvokeCommand, type LambdaClient } from "@aws-sdk/client-lambda";
import type { SSMClient } from "@aws-sdk/client-ssm";
import { GetParameterCommand } from "@aws-sdk/client-ssm";

/** O que cada agendamento chama no site. */
export const ROTAS = { agenda: "/api/cron/sync", saude: "/api/cron/saude" } as const;
export type Origem = keyof typeof ROTAS;

/** A origem que o Scheduler manda no evento; qualquer outra coisa é a coleta diária, como antes. */
export function origemDoEvento(evento: unknown): Origem {
  return (evento as { origem?: unknown } | null)?.origem === "saude" ? "saude" : "agenda";
}

export interface DependenciasDaAgenda {
  lambda: Pick<LambdaClient, "send">;
  ssm: Pick<SSMClient, "send">;
  funcaoDoSite: string;
  parametro: string;
  dominio: string;
  /** Qual rota chamar; sem ela, a coleta diária. */
  origem?: Origem;
  agora?: () => Date;
  log?: (mensagem: string, dados?: Record<string, unknown>) => void;
}

/** Evento da HTTP API (payload 2.0) que o Lambda Web Adapter transforma em requisição. */
export function eventoDoCron(segredo: string, dominio: string, agora: Date, caminho: string = ROTAS.agenda) {
  return {
    version: "2.0",
    routeKey: "$default",
    rawPath: caminho,
    rawQueryString: "",
    headers: {
      authorization: `Bearer ${segredo}`,
      host: dominio,
      "user-agent": "fragiq-agenda",
      "x-forwarded-proto": "https",
    },
    requestContext: {
      accountId: "anonymous",
      apiId: "agenda",
      domainName: dominio,
      domainPrefix: dominio.split(".")[0],
      http: { method: "GET", path: caminho, protocol: "HTTP/1.1", sourceIp: "127.0.0.1", userAgent: "fragiq-agenda" },
      requestId: randomUUID(),
      routeKey: "$default",
      stage: "$default",
      time: agora.toISOString(),
      timeEpoch: agora.getTime(),
    },
    isBase64Encoded: false,
  };
}

export async function rodarAgenda(deps: DependenciasDaAgenda) {
  const log = deps.log ?? ((m, d) => console.log(JSON.stringify({ mensagem: m, ...d })));
  const p = await deps.ssm.send(new GetParameterCommand({ Name: deps.parametro, WithDecryption: true }));
  const segredo = (JSON.parse(p.Parameter?.Value ?? "{}") as { CRON_SECRET?: string }).CRON_SECRET?.trim();
  if (!segredo) throw new Error(`${deps.parametro} não tem CRON_SECRET`);

  const origem = deps.origem ?? "agenda";
  const caminho = ROTAS[origem];
  const evento = eventoDoCron(segredo, deps.dominio, (deps.agora ?? (() => new Date()))(), caminho);
  const r = await deps.lambda.send(
    new InvokeCommand({ FunctionName: deps.funcaoDoSite, Payload: new TextEncoder().encode(JSON.stringify(evento)) }),
  );
  const bruto = r.Payload ? new TextDecoder().decode(r.Payload) : "{}";
  if (r.FunctionError) throw new Error(`a Lambda do site falhou (${r.FunctionError}): ${bruto.slice(0, 300)}`);

  const resposta = JSON.parse(bruto) as { statusCode?: number; body?: string; isBase64Encoded?: boolean };
  const corpo = resposta.isBase64Encoded ? Buffer.from(resposta.body ?? "", "base64").toString("utf8") : (resposta.body ?? "");
  log(origem === "agenda" ? "cron" : origem, { status: resposta.statusCode, resposta: corpo.slice(0, 500) });
  // Falha visível no Scheduler (e no alarme de erros), em vez de um 500 calado.
  if (resposta.statusCode !== 200) throw new Error(`${caminho} respondeu ${resposta.statusCode}: ${corpo.slice(0, 300)}`);
  return JSON.parse(corpo) as Record<string, unknown>;
}
