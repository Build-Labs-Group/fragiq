import type { PoolConfig } from "pg";
import { SUPABASE_ROOT_CA } from "./supabase-ca";

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
 * verificação continua completa, só que contra a raiz deles.
 */
export function poolConfigDe(url: string): PoolConfig {
  if (/@[^/]*\.supabase\.com[:/]/.test(url)) {
    const semSslmode = url.replace(/([?&])sslmode=[^&]*&?/, "$1").replace(/[?&]$/, "");
    return { connectionString: semSslmode, ssl: { ca: SUPABASE_ROOT_CA } };
  }
  return { connectionString: url.replace(/([?&])sslmode=(require|prefer|verify-ca)\b/, "$1sslmode=verify-full") };
}
