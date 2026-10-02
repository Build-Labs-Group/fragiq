/**
 * Lambda de migrações (Trigger do CDK, a cada publicação). Lê a URL direta
 * do banco do parâmetro do site e aplica as pastas de `prisma/migrations`,
 * que o empacotamento copia para `migrations/` ao lado deste arquivo.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import pg from "pg";
import { poolConfigDe } from "../../src/lib/pg-config";
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
  const url = valores.DIRECT_DATABASE_URL?.trim() || valores.DATABASE_URL?.trim();
  if (!url) throw new Error(`${nome} não tem DIRECT_DATABASE_URL nem DATABASE_URL`);

  const cliente = new pg.Client(poolConfigDe(url));
  await cliente.connect();
  try {
    return await migrar(cliente, lerMigracoes(join(import.meta.dirname, "migrations")));
  } finally {
    await cliente.end();
  }
}
