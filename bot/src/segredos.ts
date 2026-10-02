import {
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { GetParameterCommand, PutParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

/**
 * Valores sensíveis vêm da AWS em produção (na EC2 com role). Sem nenhuma
 * das variáveis abaixo, o bot cai no .env — é o caminho de desenvolvimento e
 * o do primeiro login com senha.
 *
 * - `FRAGIQ_SECRET_PARAM`: parâmetro SecureString do SSM Parameter Store
 *   (`/fragiq/prod/bot`, conta da Build Labs; ADR 0005). Tem precedência.
 * - `FRAGIQ_SECRET_ID`: segredo do Secrets Manager (`fragiq/bot`, conta
 *   pessoal). Fica enquanto a EC2 antiga for a volta da migração.
 *
 * O valor é um JSON plano: { "STEAM_BOT_REFRESH_TOKEN": "...", ... }. As
 * chaves têm o mesmo nome das variáveis de ambiente de propósito, para que
 * config.ts não precise saber de onde cada valor veio.
 */

export interface Cliente {
  send(comando: unknown): Promise<unknown>;
}

export interface Armazem {
  /** Onde os segredos moram, para o log (`ssm:/fragiq/prod/bot`). */
  nome: string;
  ler(): Promise<Record<string, string>>;
  gravar(valores: Record<string, string>): Promise<void>;
}

export function criarArmazem(
  env: Record<string, string | undefined> = process.env,
  clientes: { ssm?: Cliente; secretsManager?: Cliente } = {},
): Armazem | null {
  const parametro = env.FRAGIQ_SECRET_PARAM?.trim();
  if (parametro) {
    const ssm = clientes.ssm ?? (new SSMClient({}) as Cliente);
    return {
      nome: `ssm:${parametro}`,
      async ler() {
        const out = (await ssm.send(new GetParameterCommand({ Name: parametro, WithDecryption: true }))) as {
          Parameter?: { Value?: string };
        };
        return JSON.parse(out.Parameter?.Value ?? "{}");
      },
      async gravar(valores) {
        // Overwrite: nasce uma versão nova do valor, com o mesmo tipo e a chave aws/ssm.
        await ssm.send(
          new PutParameterCommand({ Name: parametro, Value: JSON.stringify(valores), Type: "SecureString", Overwrite: true }),
        );
      },
    };
  }

  const segredo = env.FRAGIQ_SECRET_ID?.trim();
  if (segredo) {
    const sm = clientes.secretsManager ?? (new SecretsManagerClient({}) as Cliente);
    return {
      nome: `secretsmanager:${segredo}`,
      async ler() {
        const out = (await sm.send(new GetSecretValueCommand({ SecretId: segredo }))) as { SecretString?: string };
        return JSON.parse(out.SecretString ?? "{}");
      },
      async gravar(valores) {
        await sm.send(new PutSecretValueCommand({ SecretId: segredo, SecretString: JSON.stringify(valores) }));
      },
    };
  }

  return null;
}

const armazem = criarArmazem();

/** Onde estão os segredos (`ssm:...` ou `secretsmanager:...`), ou null no caminho do .env. */
export const secretId = armazem?.nome ?? null;

export async function lerSegredos(): Promise<Record<string, string>> {
  return armazem ? armazem.ler() : {};
}

/**
 * O steam-user renova o refresh token sozinho antes de expirar. Se o novo
 * valor não for gravado, o próximo reboot loga com um token morto — então o
 * bot escreve de volta onde leu, sem perder as outras chaves.
 */
export async function gravarRefreshToken(token: string, destino: Armazem | null = armazem): Promise<void> {
  if (!destino) throw new Error("Nem FRAGIQ_SECRET_PARAM nem FRAGIQ_SECRET_ID definidos");
  const atual = await destino.ler();
  await destino.gravar({ ...atual, STEAM_BOT_REFRESH_TOKEN: token });
}
