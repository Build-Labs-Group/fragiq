/** Lambda chamada pelo EventBridge Scheduler: a coleta diária e a checagem de saúde (veja agenda.ts). */
import { LambdaClient } from "@aws-sdk/client-lambda";
import { SSMClient } from "@aws-sdk/client-ssm";
import { origemDoEvento, rodarAgenda } from "./agenda.ts";

const lambda = new LambdaClient({});
const ssm = new SSMClient({});

export const handler = (evento?: unknown) =>
  rodarAgenda({
    origem: origemDoEvento(evento),
    lambda,
    ssm,
    funcaoDoSite: process.env.FUNCAO_DO_SITE!,
    parametro: process.env.FRAGIQ_SECRET_PARAM!,
    dominio: process.env.DOMINIO!,
  });
