import type { PeerCertificate } from "node:tls";
import { describe, expect, it } from "vitest";
import { identidadeDe, opcoesDoAmbiente, poolConfigDe } from "@/lib/pg-config";
import { SUPABASE_ROOT_CA } from "@/lib/supabase-ca";

const CA_FALSA = "-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----\n";

describe("poolConfigDe", () => {
  it("Neon e afins: sslmode=require vira verify-full", () => {
    expect(poolConfigDe("postgresql://u:p@ep-x.us-east-2.aws.neon.tech/db?sslmode=require").connectionString).toBe(
      "postgresql://u:p@ep-x.us-east-2.aws.neon.tech/db?sslmode=verify-full",
    );
  });

  it("Supabase: tira o sslmode e verifica contra a raiz deles", () => {
    const c = poolConfigDe("postgresql://u:p@aws-0-us-east-2.pooler.supabase.com:6543/postgres?sslmode=require");
    expect(c.connectionString).toBe("postgresql://u:p@aws-0-us-east-2.pooler.supabase.com:6543/postgres");
    expect(c.ssl).toEqual({ ca: SUPABASE_ROOT_CA });
  });

  it("Postgres local sem SSL fica como está", () => {
    const url = "postgresql://fragiq:fragiq@localhost:5433/fragiq?schema=public";
    expect(poolConfigDe(url)).toEqual({ connectionString: url });
  });

  it("Postgres da Build Labs: com a CA, tira o sslmode e verifica cadeia e IP contra ela", () => {
    const c = poolConfigDe("postgresql://fragiq:s@10.42.2.10:6432/fragiq?sslmode=require&pgbouncer=true", {
      ca: CA_FALSA,
    });
    expect(c.connectionString).toBe("postgresql://fragiq:s@10.42.2.10:6432/fragiq?pgbouncer=true");
    expect(c.ssl).toMatchObject({ ca: CA_FALSA.trim(), rejectUnauthorized: true });
    // Com host IP o pg não passa servername: sem esta função o Node compara com "localhost".
    expect(typeof (c.ssl as { checkServerIdentity?: unknown }).checkServerIdentity).toBe("function");
  });

  it("a identidade do servidor é conferida contra o host da URL, inclusive IP (o servidor da Build Labs)", () => {
    const cert = (san: string) => ({ subject: { CN: "bancos" }, subjectaltname: san }) as unknown as PeerCertificate;
    const doServidor = cert("IP Address:10.42.2.10, DNS:bancos.internal");
    expect(identidadeDe("postgresql://fragiq:s@10.42.2.10:6432/fragiq?pgbouncer=true")("", doServidor)).toBeUndefined();
    expect(identidadeDe("postgresql://fragiq:s@bancos.internal:6432/fragiq")("", doServidor)).toBeUndefined();
    // O servername vazio (ou "localhost") não importa: vale o host da URL.
    expect(identidadeDe("postgresql://fragiq:s@10.42.2.11:6432/fragiq")("localhost", doServidor)).toBeInstanceOf(Error);
    expect(identidadeDe("postgresql://fragiq:s@10.42.2.10:6432/fragiq")("", cert("IP Address:10.42.2.99"))).toBeInstanceOf(Error);
  });

  it("a CA só vale para URL com SSL (Postgres local continua sem)", () => {
    const url = "postgresql://fragiq:fragiq@localhost:5433/fragiq";
    expect(poolConfigDe(url, { ca: "x" })).toEqual({ connectionString: url });
  });

  it("o tamanho do pool entra só quando informado", () => {
    expect(poolConfigDe("postgresql://u:p@localhost/db", { max: 5 })).toEqual({ connectionString: "postgresql://u:p@localhost/db", max: 5 });
    expect(poolConfigDe("postgresql://u:p@localhost/db", { max: 0 })).not.toHaveProperty("max");
  });

  it("opcoesDoAmbiente lê DATABASE_SSL_CA e DATABASE_POOL_MAX", () => {
    expect(opcoesDoAmbiente({ DATABASE_SSL_CA: "ca", DATABASE_POOL_MAX: "5" })).toEqual({ ca: "ca", max: 5 });
    expect(opcoesDoAmbiente({})).toEqual({ ca: undefined, max: undefined });
    expect(opcoesDoAmbiente({ DATABASE_POOL_MAX: "x" }).max).toBeUndefined();
  });
});
