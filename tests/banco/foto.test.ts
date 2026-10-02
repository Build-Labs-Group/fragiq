import { describe, expect, it } from "vitest";
import { comparar, type Foto, ordemPorDependencia, sqlDaTabela } from "../../scripts/banco/foto";

/**
 * A conferência da cópia Supabase → Neon. Sem banco: o retrato vem pronto,
 * e o que se testa é o que conta como diferença.
 */
function foto(mudar: (f: Foto) => void = () => {}): Foto {
  const f: Foto = {
    tabelas: {
      users: { linhas: 10, checksum: "a", maximos: { createdAt: "2026-10-01 12:00:00+00", updatedAt: "2026-10-02 01:00:00+00" } },
      _prisma_migrations: { linhas: 39, checksum: "m", maximos: { finished_at: "2026-09-25 20:00:00+00" } },
    },
    colunas: ["users.1:id text nulo=NO padrao="],
    indices: ['CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id)'],
    restricoes: ["users users_pkey PRIMARY KEY (id)"],
    enums: { SyncStatus: ["RUNNING", "SUCCESS", "FAILED"] },
    sequencias: { cron_runs_id_seq: "120" },
    extensoes: ["plpgsql", "pg_graphql", "supabase_vault"],
    tamanhoBytes: 1,
  };
  mudar(f);
  return f;
}

describe("comparar", () => {
  it("cópia perfeita: nenhuma diferença, mesmo com tamanho e extensões do provedor diferentes", () => {
    const destino = foto((f) => {
      f.tamanhoBytes = 999;
      f.extensoes = ["plpgsql", "neon"];
    });
    expect(comparar(foto(), destino)).toEqual([]);
  });

  it("linha a menos, conteúdo trocado e data máxima diferente aparecem, cada um", () => {
    const destino = foto((f) => {
      f.tabelas.users = { linhas: 9, checksum: "b", maximos: { createdAt: "2026-10-01 12:00:00+00", updatedAt: "2026-10-01 23:00:00+00" } };
    });
    expect(comparar(foto(), destino).map((d) => d.onde)).toEqual(["users: linhas", "users: checksum", "users.updatedAt: max"]);
  });

  it("_prisma_migrations é tabela como as outras: migração faltando é diferença", () => {
    const destino = foto((f) => {
      f.tabelas._prisma_migrations = { linhas: 38, checksum: "n", maximos: { finished_at: "2026-09-25 20:00:00+00" } };
    });
    expect(comparar(foto(), destino).map((d) => d.onde)).toEqual(["_prisma_migrations: linhas", "_prisma_migrations: checksum"]);
  });

  it("metadados: sequence, enum, índice e extensão usada pelo schema", () => {
    const destino = foto((f) => {
      f.sequencias.cron_runs_id_seq = "1";
      f.enums.SyncStatus = ["RUNNING", "SUCCESS"];
      f.indices = [];
      f.extensoes = ["plpgsql", "citext"];
    });
    expect(comparar(foto(), destino).map((d) => d.onde).sort()).toEqual([
      "enum SyncStatus",
      "extensoes: só no destino",
      "indices: só na origem",
      "sequence cron_runs_id_seq",
    ]);
  });

  it("tabela que falta de um lado", () => {
    const destino = foto((f) => {
      delete f.tabelas.users;
    });
    expect(comparar(foto(), destino)).toEqual([{ onde: "tabela users", origem: "existe", destino: "falta" }]);
  });
});

describe("ordemPorDependencia", () => {
  it("quem é referenciado vem antes; autorreferência não trava", () => {
    const ordem = ordemPorDependencia(
      ["matches", "match_players", "users", "follows"],
      [
        { de: "match_players", para: "matches" },
        { de: "match_players", para: "users" },
        { de: "follows", para: "users" },
        { de: "users", para: "users" },
      ],
    );
    expect(ordem.indexOf("users")).toBeLessThan(ordem.indexOf("match_players"));
    expect(ordem.indexOf("matches")).toBeLessThan(ordem.indexOf("match_players"));
    expect(ordem.indexOf("users")).toBeLessThan(ordem.indexOf("follows"));
    expect(ordem).toHaveLength(4);
  });

  it("ciclo vira erro em vez de cópia pela metade", () => {
    expect(() => ordemPorDependencia(["a", "b"], [{ de: "a", para: "b" }, { de: "b", para: "a" }])).toThrow(/ciclo/);
  });
});

describe("sqlDaTabela", () => {
  it("checksum em ordem estável e máximo de cada coluna de data, com nomes entre aspas", () => {
    const sql = sqlDaTabela("stat_snapshots", ["takenAt"]);
    expect(sql).toContain("string_agg(md5(t::text), '' ORDER BY md5(t::text))");
    expect(sql).toContain('max(t."takenAt")::text AS m0');
    expect(sql).toContain('FROM public."stat_snapshots" t');
  });
});
