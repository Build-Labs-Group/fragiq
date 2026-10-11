/**
 * TLS como no servidor de bancos da Build Labs: CA própria, servidor
 * endereçado por IP e o IP no SAN do certificado. É o caminho do site até o
 * pgbouncer (`poolConfigDe(url, { ca })`), e foi onde o ensaio da virada
 * achou o erro: com host IP o `pg` não passa `servername`, e o Node
 * comparava o certificado com "localhost" (docs/migracao-banco-aws.md).
 *
 * Como `banco-pg18.test.ts`, só roda com `FRAGIQ_TEST_PG_URL` (superusuário
 * de um Postgres 18 descartável) e precisa do `openssl` no PATH. Liga o SSL
 * do servidor com `ALTER SYSTEM` e desfaz no fim.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { poolConfigDe } from "@/lib/pg-config";

const ADMIN = process.env.FRAGIQ_TEST_PG_URL;
const temOpenssl = spawnSync("openssl", ["version"], { encoding: "utf8" }).status === 0;
const pasta = mkdtempSync(join(tmpdir(), "fragiq-tls-"));
const em = (nome: string) => join(pasta, nome).replace(/\\/g, "/");

function openssl(...args: string[]) {
  const r = spawnSync("openssl", args, { cwd: pasta, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`openssl ${args[0]}: ${r.stderr}`);
}

/** CA e certificado de servidor assinado por ela, com o SAN pedido. */
function emitir(ca: string, servidor: string, san: string) {
  openssl("req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-days", "2",
    "-keyout", `${ca}.key`, "-out", `${ca}.crt`, "-subj", `/O=Teste/CN=${ca}`);
  openssl("req", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes",
    "-keyout", `${servidor}.key`, "-out", `${servidor}.csr`, "-subj", "/O=Teste/CN=bancos");
  writeFileSync(join(pasta, `${servidor}.ext`), `subjectAltName=${san}\n`);
  openssl("x509", "-req", "-in", `${servidor}.csr`, "-CA", `${ca}.crt`, "-CAkey", `${ca}.key`, "-CAcreateserial",
    "-days", "2", "-out", `${servidor}.crt`, "-extfile", `${servidor}.ext`);
}

async function admin(...sqls: string[]) {
  const c = new pg.Client({ connectionString: ADMIN });
  await c.connect();
  try {
    for (const sql of sqls) await c.query(sql);
  } finally {
    await c.end();
  }
}

async function usarCertificado(servidor: string) {
  await admin(
    `ALTER SYSTEM SET ssl_cert_file = '${em(`${servidor}.crt`)}'`,
    `ALTER SYSTEM SET ssl_key_file = '${em(`${servidor}.key`)}'`,
    "ALTER SYSTEM SET ssl = on",
    "SELECT pg_reload_conf()",
  );
  // O reload é assíncrono: espera o postmaster reler antes da próxima conexão.
  await new Promise((ok) => setTimeout(ok, 1500));
}

/** A URL do servidor de teste por IP, com `sslmode=require`, como a do SSM. */
const urlPorIp = () => {
  const u = new URL(ADMIN!);
  u.hostname = "127.0.0.1";
  u.search = "?sslmode=require&pgbouncer=true";
  return u.toString();
};

async function conectar(ca: string) {
  const pool = new pg.Pool(poolConfigDe(urlPorIp(), { ca: readFileSync(join(pasta, `${ca}.crt`), "utf8"), max: 1 }));
  try {
    const { rows } = await pool.query("SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()");
    return rows[0]?.ssl as boolean;
  } finally {
    await pool.end();
  }
}

describe.skipIf(!ADMIN || !temOpenssl)("TLS do Postgres com CA própria e servidor por IP", () => {
  beforeAll(() => {
    emitir("ca", "servidor", "IP:127.0.0.1,DNS:bancos.internal");
    emitir("outra-ca", "servidor-outro-ip", "IP:10.42.2.10");
  });

  afterAll(async () => {
    await admin("ALTER SYSTEM RESET ssl", "ALTER SYSTEM RESET ssl_cert_file", "ALTER SYSTEM RESET ssl_key_file", "SELECT pg_reload_conf()");
    rmSync(pasta, { recursive: true, force: true });
  }, 30_000);

  it("com a CA certa e o IP no SAN, conecta cifrado", async () => {
    await usarCertificado("servidor");
    expect(await conectar("ca")).toBe(true);
  }, 30_000);

  it("CA que não assinou o servidor: recusa", async () => {
    await expect(conectar("outra-ca")).rejects.toThrow(/self[- ]signed|unable to verify|certificate/i);
  }, 30_000);

  it("certificado de outro IP, mesmo da CA certa: recusa (é o verify-full)", async () => {
    await usarCertificado("servidor-outro-ip");
    await expect(conectar("outra-ca")).rejects.toThrow(/altnames|does not match/i);
  }, 30_000);
});
