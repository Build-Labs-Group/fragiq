/**
 * Migrações do banco na AWS: o mesmo que o `prisma migrate deploy` fazia no
 * build da Vercel (`vercel-build`), rodado por um Trigger do CDK antes de a
 * Lambda do site mudar de versão.
 *
 * Não é o CLI do Prisma porque ele depende do schema engine, um binário
 * nativo de ~20 MB por plataforma. As migrações do projeto são SQL puro
 * (`prisma/migrations/<nome>/migration.sql`), e o `migrate deploy` só faz isto:
 *
 *   1. trava com `pg_advisory_lock(72707369)`, a mesma chave do Prisma, para
 *      duas execuções (esta e um `prisma migrate deploy` à mão) não correrem juntas;
 *   2. recusa seguir se há migração começada e não terminada (o P3009 do Prisma);
 *   3. aplica, em ordem, cada pasta que não está em `_prisma_migrations`, e
 *      registra nome, checksum (SHA-256 do SQL), início, fim e passos.
 *
 * A tabela é a do Prisma, linha a linha: depois de uma migração aplicada
 * aqui, `npx prisma migrate status` na máquina diz "up to date" e o build da
 * Vercel (a volta) não reaplica nada.
 */
import { createHash, randomUUID } from "node:crypto";

/** A chave de advisory lock que o `prisma migrate` usa. */
export const CHAVE_DO_LOCK = 72707369;

export interface Migracao {
  nome: string;
  sql: string;
}

export interface ClienteSql {
  query(sql: string, parametros?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface ResultadoDasMigracoes {
  aplicadas: string[];
  jaEstavam: number;
}

/** O checksum que o Prisma grava: SHA-256 do arquivo, com fim de linha LF (como no build Linux da Vercel). */
export const checksumDe = (sql: string) => createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex");

const CRIAR_TABELA = `CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id" VARCHAR(36) PRIMARY KEY NOT NULL,
  "checksum" VARCHAR(64) NOT NULL,
  "finished_at" TIMESTAMPTZ,
  "migration_name" VARCHAR(255) NOT NULL,
  "logs" TEXT,
  "rolled_back_at" TIMESTAMPTZ,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "applied_steps_count" INTEGER NOT NULL DEFAULT 0
)`;

export async function migrar(
  cliente: ClienteSql,
  migracoes: Migracao[],
  log: (mensagem: string) => void = console.log,
): Promise<ResultadoDasMigracoes> {
  await cliente.query("SELECT pg_advisory_lock($1)", [CHAVE_DO_LOCK]);
  try {
    await cliente.query(CRIAR_TABELA);
    const { rows } = await cliente.query(
      `SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`,
    );
    const presas = rows.filter((r) => r.finished_at === null && r.rolled_back_at === null);
    if (presas.length) {
      throw new Error(
        `migração começada e não terminada: ${presas.map((r) => r.migration_name).join(", ")}. ` +
          "Resolva como no Prisma (P3009): `prisma migrate resolve --rolled-back <nome>` depois de conferir o banco.",
      );
    }
    const feitas = new Set(rows.filter((r) => r.finished_at !== null).map((r) => String(r.migration_name)));
    const pendentes = [...migracoes].sort((a, b) => a.nome.localeCompare(b.nome)).filter((m) => !feitas.has(m.nome));

    const aplicadas: string[] = [];
    for (const m of pendentes) {
      const id = randomUUID();
      await cliente.query(
        `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, applied_steps_count) VALUES ($1, $2, $3, now(), 0)`,
        [id, checksumDe(m.sql), m.nome],
      );
      try {
        await cliente.query(m.sql);
      } catch (erro) {
        const mensagem = (erro as Error).message;
        await cliente.query(`UPDATE "_prisma_migrations" SET logs = $2 WHERE id = $1`, [id, mensagem]);
        throw new Error(`migração ${m.nome} falhou: ${mensagem}`);
      }
      await cliente.query(
        `UPDATE "_prisma_migrations" SET finished_at = now(), applied_steps_count = 1 WHERE id = $1`,
        [id],
      );
      log(`[migracoes] aplicada ${m.nome}`);
      aplicadas.push(m.nome);
    }
    log(`[migracoes] ${aplicadas.length} aplicadas, ${feitas.size} já estavam`);
    return { aplicadas, jaEstavam: feitas.size };
  } finally {
    await cliente.query("SELECT pg_advisory_unlock($1)", [CHAVE_DO_LOCK]);
  }
}
