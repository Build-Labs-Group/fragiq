/** Lambdas do recurso customizado da Cloudflare (onEvent e isComplete do framework Provider). */
import { ACMClient } from "@aws-sdk/client-acm";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { Cloudflare } from "./api.ts";
import { PARAMETRO_DO_TOKEN } from "./parametros.ts";
import { type DependenciasDoRecurso, type EventoDoRecurso, isComplete, onEvent } from "./recurso.ts";

const ssm = new SSMClient({});
let cliente: Cloudflare | undefined;

const deps: DependenciasDoRecurso = {
  acm: new ACMClient({}),
  cloudflare: async () => {
    if (cliente) return cliente;
    const r = await ssm.send(new GetParameterCommand({ Name: PARAMETRO_DO_TOKEN, WithDecryption: true }));
    const token = r.Parameter?.Value?.trim();
    if (!token) throw new Error(`falta o parâmetro ${PARAMETRO_DO_TOKEN}`);
    cliente = new Cloudflare(token);
    return cliente;
  },
  log: (mensagem, dados) => console.log(JSON.stringify({ mensagem, ...dados })),
};

export const aoEvento = (evento: EventoDoRecurso) => onEvent(deps, evento);
export const estaCompleto = (evento: EventoDoRecurso) => isComplete(deps, evento);
