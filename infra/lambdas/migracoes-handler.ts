/**
 * Lambda de migrações (Trigger do CDK, a cada publicação). Lê a URL direta
 * do banco do parâmetro do site e aplica as pastas de `prisma/migrations`,
 * que o empacotamento copia para `migrations/` ao lado deste arquivo.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import pg from "pg";
import { opcoesDoAmbiente, poolConfigDe } from "../../src/lib/pg-config";
import { type Migracao, migrar } from "./migracoes.ts";

function lerMigracoes(pasta: string): Migracao[] {
  return readdirSync(pasta, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(pasta, d.name, "migration.sql")))
    .map((d) => ({ nome: d.name, sql: readFileSync(join(pasta, d.name, "migration.sql"), "utf8") }));
}

export async function handler() {
  const nome = process.env.FRAGIQ_SECRET_PARAM!;
  const r = await new SSMClient({}).send(new GetParameterCommand({ Name: nome, WithDecryption: true }));
  const valores = JSON.parse(r.Parameter?.Value ?? "{}") as Record<string, string | undefined>;
  // Migração por pooler trava (o Prisma usa advisory lock): a URL direta primeiro, como no prisma.config.ts.
  // No Postgres da Build Labs (InfraBancos) a Lambda só alcança o pgbouncer (6432), e o parâmetro do site
  // não leva DIRECT_DATABASE_URL: aí vale DATABASE_URL, sem a trava de sessão (veja `migrar`).
  const direta = valores.DIRECT_DATABASE_URL?.trim();
  const url = direta || valores.DATABASE_URL?.trim();
  if (!url) throw new Error(`${nome} não tem DIRECT_DATABASE_URL nem DATABASE_URL`);
  // A CA do servidor próprio vem do mesmo parâmetro (DATABASE_SSL_CA, certificado público).
  const cliente = new pg.Client(poolConfigDe(url, opcoesDoAmbiente({ DATABASE_SSL_CA: valores.DATABASE_SSL_CA })));
  await cliente.connect();
  try {
    return await migrar(cliente, lerMigracoes(join(import.meta.dirname, "migrations")), console.log, { travar: Boolean(direta) });
  } finally {
    await cliente.end();
  }
}
