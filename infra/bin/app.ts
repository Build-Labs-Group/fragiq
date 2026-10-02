/**
 * App CDK do site do FragIQ. A esteira da infra-compartilhada roda
 * `cdk deploy --all --context ambiente=prod`, e o `cdk.json` monta o pacote
 * do site (`scripts/aws/construir.mjs`) antes de sintetizar.
 */
import { fileURLToPath } from "node:url";
import { App, Tags } from "aws-cdk-lib";
import { CONTA, lerAmbiente, REGIAO, tagsDaEmpresa } from "../lib/ambiente.ts";
import { SiteStack } from "../lib/site-stack.ts";

const app = new App();
const ambiente = lerAmbiente(app.node.tryGetContext("ambiente"));

new SiteStack(app, ambiente.pilha, {
  env: { account: CONTA, region: REGIAO },
  description: "Site do FragIQ: Next na Lambda, HTTP API com dominio na Cloudflare, agenda diaria e migracoes",
  ambiente,
  pacoteDoSite: fileURLToPath(new URL("../../.aws/site.zip", import.meta.url)),
});

for (const [chave, valor] of Object.entries(tagsDaEmpresa(ambiente.nome))) Tags.of(app).add(chave, valor);
