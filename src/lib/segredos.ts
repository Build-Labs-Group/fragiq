import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { awsCredentialsProvider } from "@vercel/functions/oidc";

/**
 * Os segredos do FragIQ não são variáveis soltas: vêm de um JSON com as
 * mesmas chaves das variáveis, guardado num lugar só, e entram em
 * `process.env` na primeira leitura. Há duas fontes, nesta ordem:
 *
 * 1. **SSM Parameter Store** (`FRAGIQ_SECRET_PARAM`, ex. `/fragiq/prod/site`),
 *    na conta da Build Labs (ADR 0005). É a fonte da Lambda na AWS, que lê
 *    com a própria role. Lá o `aws/iniciar.mjs` já carrega o parâmetro antes
 *    do servidor subir (o `DATABASE_URL` precisa existir no import do
 *    Prisma) e marca `FRAGIQ_SEGREDOS_CARREGADOS`; este módulo então não lê
 *    de novo.
 * 2. **Secrets Manager** (`FRAGIQ_SECRET_ID`, `cogniflow/tenants/fragiq`) na
 *    conta pessoal, pela role OIDC `fragiq-vercel`. É o caminho da Vercel e
 *    fica até a conta pessoal ser desligada (docs/migracao-site-build-labs.md).
 *
 * Sem nenhuma das duas nada acontece e o `.env` continua valendo (modo dev).
 * Com uma delas e sem `AWS_ROLE_ARN`, usa-se a cadeia de credenciais da
 * máquina (perfil, SSO, role da Lambda).
 *
 * O carregamento é preguiçoso — na primeira leitura de um segredo, dentro
 * de uma requisição — e não no boot. Foi medido do jeito errado primeiro:
 * um `instrumentation.ts` derrubou a produção em 14/09/2026 porque o token
 * OIDC da Vercel é um header da requisição (`x-vercel-oidc-token`), e
 * antes da primeira requisição não há token para trocar por credencial.
 * Depois da primeira leitura o valor fica em `process.env` para a vida da
 * instância; uma falha zera o cache e a próxima requisição tenta de novo.
 *
 * O que fica de fora na Vercel, e por quê: `DATABASE_URL` e
 * `DIRECT_DATABASE_URL` porque o build roda `prisma migrate deploy` antes de
 * existir runtime; `CRON_SECRET` porque a Vercel só manda o Bearer do cron
 * se a variável estiver nela. Na AWS os três vêm do parâmetro.
 */
export const CHAVES_DO_SEGREDO = ["AUTH_SECRET", "COGNIFLOW_SIGNING_SECRET", "BOT_WEBHOOK_SECRET"] as const;
export type ChaveDoSegredo = (typeof CHAVES_DO_SEGREDO)[number];

/** O que o carregador precisa de fora. Os testes trocam os clientes; em produção são os do SDK. */
export type FontesDeSegredo = {
  ssm: () => Pick<SSMClient, "send">;
  secretsManager: () => Pick<SecretsManagerClient, "send">;
};

function fontesPadrao(): FontesDeSegredo {
  const regiao = process.env.AWS_REGION ?? "us-east-1";
  const roleArn = process.env.AWS_ROLE_ARN?.trim();
  return {
    ssm: () => new SSMClient({ region: regiao }),
    secretsManager: () =>
      new SecretsManagerClient({
        region: regiao,
        ...(roleArn ? { credentials: awsCredentialsProvider({ roleArn }) } : {}),
      }),
  };
}

let fontes: FontesDeSegredo | null = null;
let carregado: Promise<void> | null = null;

/** Só para teste: troca os clientes e esquece o que já foi carregado. */
export function definirFontesDeSegredo(novas: FontesDeSegredo | null) {
  fontes = novas;
  carregado = null;
}

function carregarSegredos(): Promise<void> {
  carregado ??= carregar().catch((err) => {
    carregado = null;
    throw err;
  });
  return carregado;
}

/** O valor de um segredo, ou null se não está no segredo nem no ambiente. */
export async function segredoOpcional(nome: ChaveDoSegredo): Promise<string | null> {
  await carregarSegredos();
  return process.env[nome]?.trim() || null;
}

/** O valor de um segredo; sem ele o site não funciona, então lança. */
export async function segredo(nome: ChaveDoSegredo): Promise<string> {
  const valor = await segredoOpcional(nome);
  if (!valor) {
    const fonte = process.env.FRAGIQ_SECRET_PARAM ?? process.env.FRAGIQ_SECRET_ID ?? "FRAGIQ_SECRET_PARAM/FRAGIQ_SECRET_ID (não definido)";
    throw new Error(`${nome} não está em ${fonte} nem no ambiente (ver docs/segredos.md).`);
  }
  return valor;
}

/** Lê o JSON da fonte configurada; null quando não há fonte (dev com `.env`). */
async function lerJson(f: FontesDeSegredo): Promise<{ origem: string; valores: Record<string, unknown> } | null> {
  const parametro = process.env.FRAGIQ_SECRET_PARAM?.trim();
  if (parametro) {
    const r = await f.ssm().send(new GetParameterCommand({ Name: parametro, WithDecryption: true }));
    return { origem: `${parametro} (SSM)`, valores: JSON.parse(r.Parameter?.Value ?? "{}") };
  }
  const secretId = process.env.FRAGIQ_SECRET_ID?.trim();
  if (secretId) {
    const r = await f.secretsManager().send(new GetSecretValueCommand({ SecretId: secretId }));
    const viaOidc = process.env.AWS_ROLE_ARN?.trim() ? " via OIDC" : "";
    return { origem: `${secretId}${viaOidc}`, valores: JSON.parse(r.SecretString ?? "{}") };
  }
  return null;
}

async function carregar() {
  // O boot da Lambda (aws/iniciar.mjs) já pôs o parâmetro inteiro no ambiente.
  if (process.env.FRAGIQ_SEGREDOS_CARREGADOS) return;

  const lido = await lerJson(fontes ?? fontesPadrao());
  if (!lido) return;

  const faltando: string[] = [];
  for (const chave of CHAVES_DO_SEGREDO) {
    const valor = lido.valores[chave];
    if (typeof valor === "string" && valor.trim()) process.env[chave] = valor.trim();
    else if (!process.env[chave]) faltando.push(chave);
  }
  if (faltando.length) console.warn(`[segredos] ${lido.origem} não tem: ${faltando.join(", ")} (usando o ambiente, se houver)`);
  console.log(`[segredos] carregado de ${lido.origem}`);
}
