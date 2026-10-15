/**
 * Vínculo com a Gamers Club contra um Postgres de verdade: as rotas reais
 * (`/api/conta/gamersclub`, exportar, apagar) escrevem e leem o banco, e o
 * teste confere a linha em SQL puro, sem mock do dado gravado. Só a sessão
 * é falsa (o cookie assinado não é o assunto).
 *
 * Roda com `FRAGIQ_TEST_PG_URL` (mesmas regras de banco-pg18.test.ts):
 * cria um banco `fragiq_gc_*`, aplica todas as migrações e apaga no fim.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrar } from "../../infra/lambdas/migracoes";

const ADMIN = process.env.FRAGIQ_TEST_PG_URL;
const BANCO = `fragiq_gc_${randomBytes(3).toString("hex")}`;
const sessao = { userId: "", steamId: "76561198000000001" };

vi.mock("@/lib/session", () => ({
  getSession: async () => (sessao.userId ? { ...sessao } : null),
  destroySession: async () => {},
}));

const urlDe = (banco: string) => {
  const u = new URL(ADMIN!);
  u.pathname = `/${banco}`;
  return u.toString();
};

async function sql<T = Record<string, unknown>>(banco: string, texto: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: urlDe(banco) });
  await c.connect();
  try {
    return (await c.query(texto, params)).rows as T[];
  } finally {
    await c.end();
  }
}

const json = (corpo: unknown) =>
  new Request("http://localhost/api/conta/gamersclub", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  }) as never;

describe.skipIf(!ADMIN)("vínculo Gamers Club ↔ banco", () => {
  let rota: typeof import("@/app/api/conta/gamersclub/route");

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: ADMIN });
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE ${BANCO} TEMPLATE template0 ENCODING 'UTF8'`);
    } finally {
      await admin.end();
    }
    const pasta = join(import.meta.dirname, "..", "..", "prisma", "migrations");
    const todas = readdirSync(pasta, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(pasta, d.name, "migration.sql")))
      .map((d) => ({ nome: d.name, sql: readFileSync(join(pasta, d.name, "migration.sql"), "utf8") }));
    const c = new pg.Client({ connectionString: urlDe(BANCO) });
    await c.connect();
    try {
      await migrar(c, todas, () => {});
    } finally {
      await c.end();
    }

    process.env.DATABASE_URL = urlDe(BANCO);
    rota = await import("@/app/api/conta/gamersclub/route");
    const [u] = await sql<{ id: string }>(
      BANCO,
      `INSERT INTO users (id, "steamId", "personaName", "updatedAt") VALUES ('u_gc', $1, 'Teste GC', now()) RETURNING id`,
      [sessao.steamId],
    );
    sessao.userId = u!.id;
  }, 120_000);

  afterAll(async () => {
    const admin = new pg.Client({ connectionString: ADMIN });
    await admin.connect();
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${BANCO} WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  }, 60_000);

  const linhas = () => sql<Record<string, unknown>>(BANCO, `SELECT * FROM contas_gamersclub WHERE "userId" = 'u_gc'`);

  it("sem sessão, 401 e nada gravado", async () => {
    const antes = sessao.userId;
    sessao.userId = "";
    expect((await rota.POST(json({ perfil: "1879287" }))).status).toBe(401);
    expect((await rota.DELETE()).status).toBe(401);
    sessao.userId = antes;
    expect(await linhas()).toHaveLength(0);
  });

  it("perfil inválido: 400 e nada gravado", async () => {
    expect((await rota.POST(json({ perfil: "https://evil.com/player/1" }))).status).toBe(400);
    expect((await rota.POST(json({ perfil: "1879287", nivel: 99 }))).status).toBe(400);
    expect(await linhas()).toHaveLength(0);
  });

  it("vincular grava a linha com a proveniência (usuário, não verificada, data)", async () => {
    const res = await rota.POST(json({ perfil: "https://gamersclub.com.br/player/1879287", nivel: 17 }));
    expect(res.status).toBe(200);
    const [l] = await linhas();
    expect(l).toMatchObject({ gcPlayerId: "1879287", nivel: 17, fonte: "USUARIO", verificada: false });
    expect(l!.informadoEm).toBeInstanceOf(Date);
  });

  it("a rota GET devolve o mesmo que está no banco; corrigir mantém uma linha só", async () => {
    await rota.POST(json({ perfil: "1879287", nivel: 18 }));
    const corpo = (await (await rota.GET()).json()) as { vinculo: { gcPlayerId: string; nivel: number } };
    expect(corpo.vinculo).toMatchObject({ gcPlayerId: "1879287", nivel: 18 });
    const [{ n }] = await sql<{ n: string }>(BANCO, `SELECT count(*)::text AS n FROM contas_gamersclub`);
    expect(n).toBe("1");
  });

  it("o export leva o vínculo", async () => {
    const { GET } = await import("@/app/api/conta/exportar/route");
    const dados = (await (await GET()).json()) as { gamersClub: { gcPlayerId: string } | null };
    expect(dados.gamersClub?.gcPlayerId).toBe("1879287");
  });

  it("desvincular apaga a linha de verdade", async () => {
    const res = await rota.DELETE();
    expect(await res.json()).toEqual({ ok: true, apagado: true });
    expect(await linhas()).toHaveLength(0);
  });

  it("apagar a conta leva o vínculo em cascata", async () => {
    await rota.POST(json({ perfil: "42" }));
    expect(await linhas()).toHaveLength(1);
    const { POST } = await import("@/app/api/conta/apagar/route");
    expect((await POST()).status).toBe(200);
    expect(await linhas()).toHaveLength(0);
    const [{ n }] = await sql<{ n: string }>(BANCO, `SELECT count(*)::text AS n FROM users WHERE id = 'u_gc'`);
    expect(n).toBe("0");
  });
});
