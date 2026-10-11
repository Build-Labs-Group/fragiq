import type { PoolConfig } from "pg";
import { SUPABASE_ROOT_CA } from "./supabase-ca";

/** O que a conexão recebe de fora da URL: a CA do servidor próprio e o tamanho do pool. */
export interface OpcoesDoPool {
  /**
   * Certificado público da CA que assina o Postgres próprio da Build Labs
   * (`/bancos/prod/tls/ca-cert`, pilha InfraBancos). Vem no parâmetro do site
   * como `DATABASE_SSL_CA`. Com ele, `sslmode=require` verifica a cadeia e o
   * IP do servidor (`verify-full`) contra essa CA, em vez de contra as
   * raízes do Node, que não a conhecem.
   */
  ca?: string;
  /** Conexões abertas por processo. Atrás do pgbouncer cada Lambda precisa de poucas. */
  max?: number;
}

/**
 * Como o `pg` abre a conexão a partir da URL do banco. Usado pelo Prisma
 * (`prisma.ts`) e pela Lambda de migrações da AWS (`infra/lambdas/migracoes.ts`),
 * para os dois verificarem o certificado do mesmo jeito.
 *
 * `sslmode=require` faz o `pg` avisar em toda requisição que trata o modo
 * como `verify-full` — e é o que ele faz, então dizemos isso na URL e o
 * aviso some. Sem SSL na URL (Postgres local) nada muda.
 *
 * O Supabase assina com uma CA própria, que o Node não conhece: lá o
 * `sslmode` sai da URL (senão ele sobrescreve o objeto `ssl`) e a
 * verificação continua completa, só que contra a raiz deles. O servidor
 * Postgres da Build Labs (InfraBancos) é igual: com `opcoes.ca`, a
 * verificação completa é contra a CA da empresa.
 */
export function poolConfigDe(url: string, opcoes: OpcoesDoPool = {}): PoolConfig {
  const max = opcoes.max && opcoes.max > 0 ? { max: opcoes.max } : {};
  const semSslmode = () => url.replace(/([?&])sslmode=[^&]*&?/, "$1").replace(/[?&]$/, "");
  if (/@[^/]*\.supabase\.com[:/]/.test(url)) {
    return { connectionString: semSslmode(), ssl: { ca: SUPABASE_ROOT_CA }, ...max };
  }
  const ca = opcoes.ca?.trim();
  if (ca && /[?&]sslmode=(require|prefer|verify-ca|verify-full)\b/.test(url)) {
    return { connectionString: semSslmode(), ssl: { ca, rejectUnauthorized: true }, ...max };
  }
  return { connectionString: url.replace(/([?&])sslmode=(require|prefer|verify-ca)\b/, "$1sslmode=verify-full"), ...max };
}

/** As opções que o processo recebe do ambiente (o `aws/iniciar.mjs` copia o parâmetro do site para ele). */
export function opcoesDoAmbiente(env: Record<string, string | undefined> = process.env): OpcoesDoPool {
  const max = Number.parseInt(env.DATABASE_POOL_MAX ?? "", 10);
  return { ca: env.DATABASE_SSL_CA, max: Number.isFinite(max) ? max : undefined };
}
