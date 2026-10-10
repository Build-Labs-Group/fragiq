import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

/**
 * O token do endpoint de indicadores: um só para todos os projetos da Build
 * Labs, no SSM SecureString `/infra-compartilhada/prod/indicadores-token`
 * (ADR 0005/0006). Nunca vai para log, resposta ou teste.
 *
 * Duas fontes, nesta ordem:
 * 1. `INDICADORES_TOKEN` no ambiente (dev e testes);
 * 2. o parâmetro cujo nome está em `PARAMETRO_INDICADORES`, lido com a role
 *    da Lambda (a pilha dá `ssm:GetParameter` no nome exato, sem prefixo).
 *
 * Devolve `null` quando o token não está configurado ou não pôde ser lido:
 * a rota responde 503 e não deixa passar ninguém. Um valor lido fica 10 min
 * na memória da instância (uma chamada do painel a cada 30 min não paga o
 * SSM de novo, e uma troca do token vale em minutos); uma falha não fica.
 */
const VALIDADE_MS = 10 * 60_000;

export type ClienteSsm = Pick<SSMClient, "send">;

let guardado: { valor: string; ate: number } | null = null;
let cliente: ClienteSsm | null = null;

/** Só para teste: troca o cliente do SSM e esquece o token guardado. */
export function definirClienteSsmDoToken(novo: ClienteSsm | null) {
  cliente = novo;
  guardado = null;
}

export async function tokenDeIndicadores(agora = Date.now()): Promise<string | null> {
  const doAmbiente = process.env.INDICADORES_TOKEN?.trim();
  if (doAmbiente) return doAmbiente;

  const nome = process.env.PARAMETRO_INDICADORES?.trim();
  if (!nome) return null;
  if (guardado && guardado.ate > agora) return guardado.valor;

  try {
    cliente ??= new SSMClient({ region: process.env.AWS_REGION ?? "us-east-2" });
    const r = await cliente.send(new GetParameterCommand({ Name: nome, WithDecryption: true }));
    const valor = r.Parameter?.Value?.trim();
    if (!valor) return null;
    guardado = { valor, ate: agora + VALIDADE_MS };
    return valor;
  } catch (erro) {
    // Só o nome do erro: a mensagem do SSM pode citar o ARN, nunca o valor.
    console.error(`[indicadores] token ilegível em ${nome}: ${(erro as Error).name}`);
    return null;
  }
}
