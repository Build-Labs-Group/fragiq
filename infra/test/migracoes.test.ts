import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CHAVE_DO_LOCK, checksumDe, type ClienteSql, migrar } from "../lambdas/migracoes.ts";

/** Postgres de mentira: guarda `_prisma_migrations` e registra cada SQL que chegou. */
function bancoFalso(linhas: Record<string, unknown>[] = [], falharEm?: string) {
  const executados: string[] = [];
  const tabela = [...linhas];
  const cliente: ClienteSql = {
    async query(sql, parametros = []) {
      executados.push(sql);
      if (sql.startsWith("SELECT migration_name")) return { rows: tabela };
      if (sql.startsWith('INSERT INTO "_prisma_migrations"')) {
        tabela.push({ id: parametros[0], checksum: parametros[1], migration_name: parametros[2], finished_at: null, rolled_back_at: null, logs: null });
      } else if (sql.includes("SET finished_at")) {
        Object.assign(tabela.find((l) => l.id === parametros[0])!, { finished_at: new Date(), applied_steps_count: 1 });
      } else if (sql.includes("SET logs")) {
        Object.assign(tabela.find((l) => l.id === parametros[0])!, { logs: parametros[1] });
      } else if (falharEm && sql === falharEm) {
        throw new Error('relation "x" already exists');
      }
      return { rows: [] };
    },
  };
  return { cliente, executados, tabela };
}

const sem = () => {};

describe("migrações (compatíveis com o prisma migrate deploy)", () => {
  it("aplica só as pendentes, em ordem, com o lock do Prisma e o registro completo", async () => {
    const { cliente, executados, tabela } = bancoFalso([
      { migration_name: "20260901000000_init", finished_at: new Date(), rolled_back_at: null },
    ]);
    const r = await migrar(
      cliente,
      [
        { nome: "20260925190000_b", sql: "ALTER TABLE b ADD x int;" },
        { nome: "20260901000000_init", sql: "CREATE TABLE a();" },
        { nome: "20260920000000_a", sql: "CREATE TABLE b();\r\n" },
      ],
      sem,
    );
    expect(r).toEqual({ aplicadas: ["20260920000000_a", "20260925190000_b"], jaEstavam: 1 });
    expect(executados[0]).toBe("SELECT pg_advisory_lock($1)");
    expect(executados.at(-1)).toBe("SELECT pg_advisory_unlock($1)");
    expect(executados).not.toContain("CREATE TABLE a();");
    expect(executados.indexOf("CREATE TABLE b();\r\n")).toBeLessThan(executados.indexOf("ALTER TABLE b ADD x int;"));
    const nova = tabela.find((l) => l.migration_name === "20260920000000_a")!;
    expect(nova).toMatchObject({ applied_steps_count: 1, checksum: checksumDe("CREATE TABLE b();\n") });
    expect(nova.finished_at).toBeInstanceOf(Date);
    expect(CHAVE_DO_LOCK).toBe(72707369);
  });

  it("o checksum é o SHA-256 do arquivo com LF, como o Prisma grava no Linux", () => {
    expect(checksumDe("SELECT 1;\r\n")).toBe(checksumDe("SELECT 1;\n"));
    expect(checksumDe("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("migração que falha fica registrada com o erro, sem fim, e o lock é solto", async () => {
    const { cliente, executados, tabela } = bancoFalso([], "CREATE TABLE x();");
    await expect(migrar(cliente, [{ nome: "20260101000000_x", sql: "CREATE TABLE x();" }], sem)).rejects.toThrow(
      /20260101000000_x falhou: relation "x" already exists/,
    );
    expect(tabela[0]).toMatchObject({ finished_at: null, logs: 'relation "x" already exists' });
    expect(executados.at(-1)).toBe("SELECT pg_advisory_unlock($1)");
  });

  it("com migração presa (começada e não terminada) não aplica nada, como o P3009", async () => {
    const { cliente, executados } = bancoFalso([{ migration_name: "20260101000000_x", finished_at: null, rolled_back_at: null }]);
    await expect(migrar(cliente, [{ nome: "20260102000000_y", sql: "SELECT 1" }], sem)).rejects.toThrow(/não terminada/);
    expect(executados).not.toContain("SELECT 1");
  });

  it("migração desfeita (rolled_back_at) volta a ser aplicada", async () => {
    const { cliente } = bancoFalso([{ migration_name: "20260101000000_x", finished_at: null, rolled_back_at: new Date() }]);
    const r = await migrar(cliente, [{ nome: "20260101000000_x", sql: "SELECT 1" }], sem);
    expect(r.aplicadas).toEqual(["20260101000000_x"]);
  });

  it("as migrações reais do projeto são SQL puro, sem controle de transação nem CONCURRENTLY", () => {
    const pasta = fileURLToPath(new URL("../../prisma/migrations", import.meta.url));
    const pastas = readdirSync(pasta, { withFileTypes: true }).filter((d) => d.isDirectory());
    expect(pastas.length).toBeGreaterThan(30);
    for (const d of pastas) {
      const sql = readFileSync(join(pasta, d.name, "migration.sql"), "utf8");
      expect(sql, d.name).not.toMatch(/\bCONCURRENTLY\b|^\s*(BEGIN|COMMIT)\s*;/im);
    }
  });
});
