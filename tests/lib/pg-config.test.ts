import { describe, expect, it } from "vitest";
import { poolConfigDe } from "@/lib/pg-config";
import { SUPABASE_ROOT_CA } from "@/lib/supabase-ca";

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
});
