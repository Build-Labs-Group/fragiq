/**
 * Integração contra um Postgres de verdade (a versão do servidor da Build
 * Labs, a 18): a pilha de migrações inteira (com e sem a trava de sessão), o
 * Prisma do site com a URL do pgbouncer (`pgbouncer=true`, pool pequeno), a
 * cópia de um banco para outro (`scripts/banco/copiar.ts`) e a conferência
 * (`conferir.ts`), que é o critério de pronto da virada do Neon para o
 * InfraBancos (docs/migracao-banco-aws.md).
 *
 * Fica de fora da suíte comum, que não toca banco: só roda com
 * `FRAGIQ_TEST_PG_URL` apontando para um servidor onde o usuário pode criar
 * bancos (superusuário de um Postgres descartável; nunca produção):
 *
 *   FRAGIQ_TEST_PG_URL=postgresql://postgres:senha@localhost:54318/postgres npx vitest run tests/integracao
 *
 * Cada execução cria dois bancos `fragiq_it_*` e apaga os dois no fim.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { poolConfigDe } from "@/lib/pg-config";
import { migrar } from "../../infra/lambdas/migracoes";
import { comparar, fotografar } from "../../scripts/banco/foto";

const ADMIN = process.env.FRAGIQ_TEST_PG_URL;
const RAIZ = join(import.meta.dirname, "..", "..");
const sufixo = randomBytes(3).toString("hex");
const BANCOS = { a: `fragiq_it_a_${sufixo}`, b: `fragiq_it_b_${sufixo}` };

const urlDe = (banco: string) => {
  const u = new URL(ADMIN!);
  u.pathname = `/${banco}`;
  return u.toString();
};

function lerMigracoes() {
  const pasta = join(RAIZ, "prisma", "migrations");
  return readdirSync(pasta, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(pasta, d.name, "migration.sql")))
    .map((d) => ({ nome: d.name, sql: readFileSync(join(pasta, d.name, "migration.sql"), "utf8") }));
}

function rodar(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync("npx", ["tsx", ...args], {
    cwd: RAIZ,
    shell: true,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { codigo: r.status, saida: `${r.stdout}\n${r.stderr}` };
}

async function consultar<T = Record<string, unknown>>(banco: string, sql: string) {
  const c = new pg.Client({ connectionString: urlDe(banco) });
  await c.connect();
  try {
    return (await c.query(sql)).rows as T[];
  } finally {
    await c.end();
  }
}

describe.skipIf(!ADMIN)("banco do FragIQ no Postgres 18", () => {
  const pasta = mkdtempSync(join(tmpdir(), "fragiq-it-"));

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: ADMIN });
    await admin.connect();
    try {
      for (const banco of Object.values(BANCOS)) await admin.query(`CREATE DATABASE ${banco} TEMPLATE template0 ENCODING 'UTF8'`);
    } finally {
      await admin.end();
    }
  }, 60_000);

  afterAll(async () => {
    rmSync(pasta, { recursive: true, force: true });
    const admin = new pg.Client({ connectionString: ADMIN });
    await admin.connect();
    try {
      for (const banco of Object.values(BANCOS)) await admin.query(`DROP DATABASE IF EXISTS ${banco} WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  }, 60_000);

  it("a versão do servidor é a 18", async () => {
    const [{ v }] = await consultar<{ v: string }>(BANCOS.a, "SELECT current_setting('server_version_num') AS v");
    expect(Math.floor(Number(v) / 10000)).toBe(18);
  });

  it("as migrações do projeto aplicam do zero, em ordem, e uma segunda rodada não faz nada", async () => {
    const todas = lerMigracoes();
    for (const banco of Object.values(BANCOS)) {
      const c = new pg.Client({ connectionString: urlDe(banco) });
      await c.connect();
      try {
        const primeira = await migrar(c, todas, () => {});
        expect(primeira.aplicadas).toHaveLength(todas.length);
        const segunda = await migrar(c, todas, () => {});
        expect(segunda).toEqual({ aplicadas: [], jaEstavam: todas.length });
        // Atrás do pgbouncer a Lambda migra sem a trava de sessão: o resultado é o mesmo.
        expect(await migrar(c, todas, () => {}, { travar: false })).toEqual({ aplicadas: [], jaEstavam: todas.length });
      } finally {
        await c.end();
      }
    }
    const tabelas = await consultar<{ n: string }>(BANCOS.a, "SELECT count(*)::text AS n FROM pg_tables WHERE schemaname = 'public'");
    expect(Number(tabelas[0]!.n)).toBeGreaterThanOrEqual(28);
  }, 120_000);

  it("popula um banco com o seed (enums, JSON, datas) e a cópia leva tudo para o outro, com a conferência igual", async () => {
    const env = { DATABASE_URL: urlDe(BANCOS.a), DIRECT_DATABASE_URL: urlDe(BANCOS.a) };
    for (const script of ["scripts/seed.ts", "scripts/seed-partidas.ts", "scripts/recompute-sessions.ts", "scripts/recompute-insights.ts"]) {
      const r = rodar([script], env);
      expect(r.codigo, `${script}\n${r.saida}`).toBe(0);
    }
    const linhas = await consultar<{ n: string }>(BANCOS.a, "SELECT (SELECT count(*) FROM users)::text AS n");
    expect(Number(linhas[0]!.n)).toBeGreaterThan(0);

    const origem = join(pasta, "origem.url");
    const destino = join(pasta, "destino.url");
    writeFileSync(origem, urlDe(BANCOS.a));
    writeFileSync(destino, urlDe(BANCOS.b));

    const ensaio = rodar(["scripts/banco/copiar.ts", "--origem", origem, "--destino", destino]);
    expect(ensaio.codigo, ensaio.saida).toBe(0);
    expect(ensaio.saida).toContain("ensaio: nada gravado");

    const copia = rodar(["scripts/banco/copiar.ts", "--origem", origem, "--destino", destino, "--sim"]);
    expect(copia.codigo, copia.saida).toBe(0);
    expect(copia.saida).toContain("conferência: linhas, checksums");

    const conf = rodar(["scripts/banco/conferir.ts", "--origem", origem, "--destino", destino]);
    expect(conf.codigo, conf.saida).toBe(0);
    expect(conf.saida).toContain("tudo igual");

    // A cópia só vai para um banco vazio: a segunda tentativa recusa e não mexe em nada.
    const repetida = rodar(["scripts/banco/copiar.ts", "--origem", origem, "--destino", destino, "--sim"]);
    expect(repetida.codigo).toBe(1);
    expect(repetida.saida).toContain("o destino já tem dados");
  }, 300_000);

  it("o Prisma do site abre pela URL do pgbouncer (pgbouncer=true, pool de 2): lê, grava enum/JSON numa transação e desfaz", async () => {
    const prisma = new PrismaClient({ adapter: new PrismaPg(poolConfigDe(`${urlDe(BANCOS.a)}?pgbouncer=true`, { max: 2 })) });
    try {
      const usuarios = await prisma.user.count();
      expect(usuarios).toBeGreaterThan(0);
      // Transação interativa: no modo transaction do pgbouncer ela fica numa conexão só do servidor.
      const id = await prisma.$transaction(async (tx) => {
        const log = await tx.botLog.create({
          data: { nivel: "WARN", mensagem: "teste de integração", dados: { a: [1, "dois"] }, em: new Date("2026-10-11T12:00:00Z") },
        });
        expect(await tx.botLog.findUniqueOrThrow({ where: { id: log.id } })).toMatchObject({ nivel: "WARN", dados: { a: [1, "dois"] } });
        return log.id;
      });
      // Consultas em paralelo maiores que o pool: o pg enfileira, nada falha.
      const contagens = await Promise.all(Array.from({ length: 6 }, () => prisma.botLog.count({ where: { id } })));
      expect(contagens).toEqual([1, 1, 1, 1, 1, 1]);
      await prisma.botLog.delete({ where: { id } });
      expect(await prisma.user.count()).toBe(usuarios);
    } finally {
      await prisma.$disconnect();
    }
  }, 60_000);

  it("a fotografia (linhas + md5 por tabela) acusa uma linha alterada no destino", async () => {
    const c = new pg.Client({ connectionString: urlDe(BANCOS.b) });
    const a = new pg.Client({ connectionString: urlDe(BANCOS.a) });
    await Promise.all([c.connect(), a.connect()]);
    try {
      const igual = comparar(await fotografar(a), await fotografar(c));
      expect(igual).toEqual([]);
      await c.query(`UPDATE users SET "personaName" = "personaName" || ' x' WHERE id = (SELECT id FROM users LIMIT 1)`);
      const diferencas = comparar(await fotografar(a), await fotografar(c));
      expect(diferencas.map((d) => d.onde)).toContain("users: checksum");
    } finally {
      await Promise.all([c.end(), a.end()]);
    }
  }, 60_000);
});
