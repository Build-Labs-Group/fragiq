/** Lambda chamada pelo EventBridge Scheduler uma vez por dia (veja agenda.ts). */
import { LambdaClient } from "@aws-sdk/client-lambda";
import { SSMClient } from "@aws-sdk/client-ssm";
import { rodarAgenda } from "./agenda.ts";

const lambda = new LambdaClient({});
const ssm = new SSMClient({});

export const handler = () =>
  rodarAgenda({
    lambda,
    ssm,
    funcaoDoSite: process.env.FUNCAO_DO_SITE!,
    parametro: process.env.FRAGIQ_SECRET_PARAM!,
    dominio: process.env.DOMINIO!,
  });
