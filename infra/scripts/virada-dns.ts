/**
 * Virada (e volta) do DNS de fragiq.buildlabs.com.br entre a Vercel e a AWS.
 *
 *   npm run virada-dns                  mostra o registro de hoje e o que mudaria (não grava)
 *   npm run virada-dns -- --ir --sim    troca o A da Vercel pelo CNAME da HTTP API (com proxy)
 *   npm run virada-dns -- --voltar --sim  volta para o A da Vercel (76.76.21.21, com proxy)
 *
 * Sem `--sim` nada é gravado. Precisa de `AWS_PROFILE=buildlabs`: o alvo vem da
 * saída `AlvoDoDominioPrincipal` da pilha Fragiq-Prod e o token da Cloudflare
 * de `/infra-compartilhada/prod/cloudflare-api-token` (o valor não é impresso).
 * A regra de SSL "fragiq: SSL Full (Vercel)" da zona serve aos dois lados
 * (as duas origens têm certificado válido) e não muda.
 */
import { CloudFormationClient, DescribeStacksCommand } from "@aws-sdk/client-cloudformation";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { Cloudflare, type RegistroDns } from "../lambdas/cloudflare/api.ts";
import { PARAMETRO_DO_TOKEN } from "../lambdas/cloudflare/parametros.ts";
import { lerAmbiente, REGIAO, ZONA } from "../lib/ambiente.ts";

/** O registro de antes da virada (lido na Cloudflare em 02/10/2026). */
export const REGISTRO_DA_VERCEL = { type: "A", content: "76.76.21.21", proxied: true } as const;

export type Acao =
  | { tipo: "apagar"; registro: RegistroDns }
  | { tipo: "criar"; corpo: { type: string; name: string; content: string; proxied: boolean; ttl: number; comment: string } };

/**
 * O que fazer para o nome apontar para `destino`, a partir dos registros de
 * hoje. Só mexe em A, AAAA e CNAME do próprio nome; nada a fazer se já está certo.
 */
export function planejar(
  nome: string,
  atuais: RegistroDns[],
  destino: { type: "A" | "CNAME"; content: string; proxied: boolean },
  comentario: string,
): Acao[] {
  const doEndereco = atuais.filter((r) => ["A", "AAAA", "CNAME"].includes(r.type));
  const certo = doEndereco.length === 1 && doEndereco[0]!.type === destino.type && doEndereco[0]!.content === destino.content && !!doEndereco[0]!.proxied === destino.proxied;
  if (certo) return [];
  return [
    ...doEndereco.map((registro) => ({ tipo: "apagar" as const, registro })),
    { tipo: "criar" as const, corpo: { ...destino, name: nome, ttl: 1, comment: comentario } },
  ];
}

async function principal(argumentos: string[]) {
  const ir = argumentos.includes("--ir");
  const voltar = argumentos.includes("--voltar");
  const gravar = argumentos.includes("--sim");
  if (ir && voltar) throw new Error("use --ir ou --voltar, não os dois");
  const { dominioPrincipal, pilha } = lerAmbiente("prod");

  const ssm = new SSMClient({ region: REGIAO });
  const token = (await ssm.send(new GetParameterCommand({ Name: PARAMETRO_DO_TOKEN, WithDecryption: true }))).Parameter?.Value?.trim();
  if (!token) throw new Error(`falta ${PARAMETRO_DO_TOKEN}`);
  const cf = new Cloudflare(token);
  const zona = await cf.zona(ZONA);
  const atuais = await cf.registros(zona, dominioPrincipal);
  console.log(`hoje em ${dominioPrincipal}:`, atuais.map((r) => `${r.type} ${r.content} proxied=${!!r.proxied}`));
  console.log("regras de SSL do host:", (await cf.regrasDoHost(zona, dominioPrincipal)).map((r) => r.description));

  let destino: { type: "A" | "CNAME"; content: string; proxied: boolean };
  if (voltar) {
    destino = { ...REGISTRO_DA_VERCEL };
  } else {
    const cfn = new CloudFormationClient({ region: REGIAO });
    const saida = (await cfn.send(new DescribeStacksCommand({ StackName: pilha }))).Stacks?.[0]?.Outputs?.find(
      (o) => o.OutputKey === "AlvoDoDominioPrincipal",
    )?.OutputValue;
    if (!saida) throw new Error(`a pilha ${pilha} não tem a saída AlvoDoDominioPrincipal`);
    destino = { type: "CNAME", content: saida, proxied: true };
  }
  if (!ir && !voltar) {
    console.log("nada gravado. Para trocar: --ir --sim (AWS) ou --voltar --sim (Vercel). Destino da AWS:", destino);
    return;
  }
  const acoes = planejar(dominioPrincipal, atuais, destino, voltar ? "site do fragiq na Vercel (volta)" : "site do fragiq na AWS (virada)");
  if (!acoes.length) {
    console.log("já está apontando para o destino; nada a fazer");
    return;
  }
  for (const a of acoes) console.log(a.tipo === "apagar" ? `apagar ${a.registro.type} ${a.registro.content}` : `criar ${a.corpo.type} ${a.corpo.content} proxied=${a.corpo.proxied}`);
  if (!gravar) {
    console.log("nada gravado (falta --sim)");
    return;
  }
  // Criar antes de apagar não dá: a Cloudflare recusa CNAME junto de A com o mesmo nome.
  // A janela entre as duas chamadas é de menos de um segundo.
  for (const a of acoes) {
    if (a.tipo === "apagar") await cf.pedir("DELETE", `/zones/${zona}/dns_records/${a.registro.id}`);
    else await cf.pedir("POST", `/zones/${zona}/dns_records`, a.corpo);
  }
  console.log("gravado:", (await cf.registros(zona, dominioPrincipal)).map((r) => `${r.type} ${r.content} proxied=${!!r.proxied}`));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop()!)) {
  principal(process.argv.slice(2)).catch((erro) => {
    console.error((erro as Error).message);
    process.exit(1);
  });
}
