/**
 * Boot do site na Lambda (docs/migracao-site-build-labs.md).
 *
 * O Lambda Web Adapter roda o `run.sh`, que roda este arquivo. Antes de
 * subir o servidor do Next, ele lê o parâmetro `FRAGIQ_SECRET_PARAM`
 * (`/fragiq/prod/site`, SecureString com um JSON) com a role da própria
 * Lambda e põe cada chave em `process.env`. Precisa ser no boot, e não na
 * primeira requisição como na Vercel: o Prisma lê `DATABASE_URL` no import,
 * e na Lambda a credencial já existe antes de qualquer requisição.
 *
 * O valor nunca vai para log: só o nome do parâmetro e quantas chaves vieram.
 */
import { pathToFileURL } from "node:url";

/**
 * Lê o parâmetro e copia as chaves de texto para `env`. O segredo vence a
 * variável, como no `src/lib/segredos.ts`. Devolve os nomes das chaves.
 *
 * @param {{
 *   nome: string,
 *   ssm: { send: (comando: unknown) => Promise<{ Parameter?: { Value?: string } }> },
 *   GetParameterCommand: new (entrada: { Name: string, WithDecryption: boolean }) => unknown,
 *   env?: Record<string, string | undefined>,
 *   log?: (mensagem: string) => void,
 * }} p
 * @returns {Promise<string[]>}
 */
export async function carregarParametro({ nome, ssm, GetParameterCommand, env = process.env, log = console.log }) {
  const resposta = await ssm.send(new GetParameterCommand({ Name: nome, WithDecryption: true }));
  const valores = JSON.parse(resposta.Parameter?.Value ?? "{}");
  const chaves = [];
  for (const [chave, valor] of Object.entries(valores)) {
    if (typeof valor !== "string" || !valor.trim()) continue;
    env[chave] = valor.trim();
    chaves.push(chave);
  }
  // `src/lib/segredos.ts` vê esta marca e não lê o parâmetro de novo.
  env.FRAGIQ_SEGREDOS_CARREGADOS = nome;
  log(`[segredos] carregado de ${nome} (SSM, boot): ${chaves.length} chaves`);
  return chaves;
}

async function principal() {
  const nome = process.env.FRAGIQ_SECRET_PARAM?.trim();
  if (nome) {
    const { SSMClient, GetParameterCommand } = await import("@aws-sdk/client-ssm");
    await carregarParametro({ nome, ssm: new SSMClient({}), GetParameterCommand });
  }
  await import("./server.js");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal().catch((erro) => {
    // Sem segredo o site não funciona; a Lambda falha o init e tenta de novo na próxima requisição.
    console.error(`[segredos] boot falhou: ${erro?.name ?? "Error"}: ${erro?.message ?? erro}`);
    process.exit(1);
  });
}
