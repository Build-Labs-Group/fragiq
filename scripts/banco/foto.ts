/**
 * Retrato de um banco do FragIQ, para provar que a cópia Supabase → Neon
 * (docs/migracao-site-build-labs.md, parte "Banco") levou tudo: dados e
 * metadados.
 *
 * Por tabela do schema `public` (incluindo `_prisma_migrations`): número de
 * linhas, checksum do conteúdo (md5 do md5 de cada linha, em ordem estável)
 * e o maior valor de cada coluna de data. Do schema: colunas, índices,
 * restrições, enums, sequences e extensões.
 *
 * A sessão fixa fuso, formato de data e de float antes de ler, para os dois
 * lados escreverem cada linha com o mesmo texto. Nada aqui grava.
 */

export interface ClienteSql {
  query<T = Record<string, unknown>>(sql: string, parametros?: unknown[]): Promise<{ rows: T[] }>;
}

export interface FotoDaTabela {
  linhas: number;
  checksum: string;
  /** Maior valor de cada coluna de data/hora (`createdAt`, `updatedAt`, `finished_at`...). */
  maximos: Record<string, string | null>;
}

export interface Foto {
  tabelas: Record<string, FotoDaTabela>;
  colunas: string[];
  indices: string[];
  restricoes: string[];
  enums: Record<string, string[]>;
  sequencias: Record<string, string | null>;
  extensoes: string[];
  tamanhoBytes: number;
}

/** O que torna o texto de uma linha igual nos dois provedores. */
export const SESSAO_ESTAVEL = [
  "SET TIME ZONE 'UTC'",
  "SET DateStyle = 'ISO, YMD'",
  "SET IntervalStyle = 'postgres'",
  "SET extra_float_digits = 1",
  "SET bytea_output = 'hex'",
];

/** Extensões que todo Supabase traz e que o schema do FragIQ não usa. */
export const EXTENSOES_DO_PROVEDOR = new Set([
  "pg_graphql",
  "pg_stat_statements",
  "pgcrypto",
  "pgjwt",
  "pgsodium",
  "supabase_vault",
  "uuid-ossp",
  "pg_net",
  "pg_cron",
  "plpgsql",
  "neon",
  "neon_utils",
]);

export const aspas = (nome: string) => `"${nome.replace(/"/g, '""')}"`;

/** SQL do retrato de uma tabela. As colunas de data entram como `max(col)::text`. */
export function sqlDaTabela(tabela: string, colunasDeData: string[]): string {
  const maximos = colunasDeData.map((c, i) => `max(t.${aspas(c)})::text AS m${i}`);
  return [
    `SELECT count(*)::bigint AS linhas,`,
    `  md5(coalesce(string_agg(md5(t::text), '' ORDER BY md5(t::text)), '')) AS checksum`,
    maximos.length ? `, ${maximos.join(", ")}` : "",
    `FROM public.${aspas(tabela)} t`,
  ].join("\n");
}

export async function fotografar(c: ClienteSql): Promise<Foto> {
  for (const sql of SESSAO_ESTAVEL) await c.query(sql);

  const { rows: tabelas } = await c.query<{ tabela: string }>(
    `SELECT tablename AS tabela FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  );
  const { rows: colunas } = await c.query<{ tabela: string; coluna: string; tipo: string; posicao: number; nulo: string; padrao: string | null }>(
    `SELECT table_name AS tabela, column_name AS coluna, data_type AS tipo, ordinal_position AS posicao,
            is_nullable AS nulo, column_default AS padrao
       FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`,
  );

  const foto: Foto = {
    tabelas: {},
    colunas: colunas.map((k) => `${k.tabela}.${k.posicao}:${k.coluna} ${k.tipo} nulo=${k.nulo} padrao=${k.padrao ?? ""}`),
    indices: [],
    restricoes: [],
    enums: {},
    sequencias: {},
    extensoes: [],
    tamanhoBytes: 0,
  };

  for (const { tabela } of tabelas) {
    const deData = colunas.filter((k) => k.tabela === tabela && k.tipo.startsWith("timestamp")).map((k) => k.coluna);
    const { rows } = await c.query<Record<string, string | null>>(sqlDaTabela(tabela, deData));
    const r = rows[0]!;
    foto.tabelas[tabela] = {
      linhas: Number(r.linhas),
      checksum: String(r.checksum),
      maximos: Object.fromEntries(deData.map((col, i) => [col, r[`m${i}`] ?? null])),
    };
  }

  foto.indices = (
    await c.query<{ d: string }>(`SELECT indexdef AS d FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`)
  ).rows.map((r) => r.d);
  foto.restricoes = (
    await c.query<{ d: string }>(
      `SELECT conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid) AS d
         FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY 1`,
    )
  ).rows.map((r) => r.d);
  for (const r of (
    await c.query<{ tipo: string; rotulos: string[] }>(
      `SELECT t.typname AS tipo, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS rotulos
         FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public' GROUP BY t.typname ORDER BY t.typname`,
    )
  ).rows) {
    foto.enums[r.tipo] = r.rotulos;
  }
  for (const r of (
    await c.query<{ nome: string; valor: string | null }>(
      `SELECT sequencename AS nome, last_value::text AS valor FROM pg_sequences WHERE schemaname = 'public' ORDER BY 1`,
    )
  ).rows) {
    foto.sequencias[r.nome] = r.valor;
  }
  foto.extensoes = (await c.query<{ nome: string }>(`SELECT extname AS nome FROM pg_extension ORDER BY 1`)).rows.map(
    (r) => r.nome,
  );
  foto.tamanhoBytes = Number(
    (await c.query<{ n: string }>(`SELECT pg_database_size(current_database())::text AS n`)).rows[0]!.n,
  );
  return foto;
}

export interface Diferenca {
  onde: string;
  origem: unknown;
  destino: unknown;
}

/**
 * Tudo o que difere entre os dois retratos. Lista vazia = cópia pronta.
 * O tamanho do banco não entra (cada provedor guarda de um jeito) e as
 * extensões que só o provedor usa também não.
 */
export function comparar(origem: Foto, destino: Foto): Diferenca[] {
  const d: Diferenca[] = [];
  const nomes = new Set([...Object.keys(origem.tabelas), ...Object.keys(destino.tabelas)]);
  for (const t of [...nomes].sort()) {
    const a = origem.tabelas[t];
    const b = destino.tabelas[t];
    if (!a || !b) {
      d.push({ onde: `tabela ${t}`, origem: a ? "existe" : "falta", destino: b ? "existe" : "falta" });
      continue;
    }
    if (a.linhas !== b.linhas) d.push({ onde: `${t}: linhas`, origem: a.linhas, destino: b.linhas });
    if (a.checksum !== b.checksum) d.push({ onde: `${t}: checksum`, origem: a.checksum, destino: b.checksum });
    for (const col of new Set([...Object.keys(a.maximos), ...Object.keys(b.maximos)])) {
      if (a.maximos[col] !== b.maximos[col]) d.push({ onde: `${t}.${col}: max`, origem: a.maximos[col], destino: b.maximos[col] });
    }
  }
  const listas: [string, string[], string[]][] = [
    ["colunas", origem.colunas, destino.colunas],
    ["indices", origem.indices, destino.indices],
    ["restricoes", origem.restricoes, destino.restricoes],
    [
      "extensoes",
      origem.extensoes.filter((e) => !EXTENSOES_DO_PROVEDOR.has(e)),
      destino.extensoes.filter((e) => !EXTENSOES_DO_PROVEDOR.has(e)),
    ],
  ];
  for (const [nome, a, b] of listas) {
    const sb = new Set(b);
    const sa = new Set(a);
    for (const x of a) if (!sb.has(x)) d.push({ onde: `${nome}: só na origem`, origem: x, destino: null });
    for (const x of b) if (!sa.has(x)) d.push({ onde: `${nome}: só no destino`, origem: null, destino: x });
  }
  for (const tipo of new Set([...Object.keys(origem.enums), ...Object.keys(destino.enums)])) {
    const a = JSON.stringify(origem.enums[tipo] ?? null);
    const b = JSON.stringify(destino.enums[tipo] ?? null);
    if (a !== b) d.push({ onde: `enum ${tipo}`, origem: origem.enums[tipo] ?? null, destino: destino.enums[tipo] ?? null });
  }
  for (const s of new Set([...Object.keys(origem.sequencias), ...Object.keys(destino.sequencias)])) {
    if (origem.sequencias[s] !== destino.sequencias[s]) {
      d.push({ onde: `sequence ${s}`, origem: origem.sequencias[s] ?? null, destino: destino.sequencias[s] ?? null });
    }
  }
  return d;
}

/**
 * Ordem de cópia que respeita as chaves estrangeiras: quem é referenciado
 * vem antes de quem referencia. Autorreferência não conta; ciclo é erro.
 */
export function ordemPorDependencia(tabelas: string[], chaves: { de: string; para: string }[]): string[] {
  const pendentes = new Map(tabelas.map((t) => [t, new Set<string>()]));
  for (const { de, para } of chaves) if (de !== para && pendentes.has(de) && pendentes.has(para)) pendentes.get(de)!.add(para);
  const ordem: string[] = [];
  while (pendentes.size) {
    const prontas = [...pendentes].filter(([, deps]) => deps.size === 0).map(([t]) => t).sort();
    if (!prontas.length) throw new Error(`ciclo de chaves estrangeiras entre: ${[...pendentes.keys()].join(", ")}`);
    for (const t of prontas) {
      ordem.push(t);
      pendentes.delete(t);
      for (const deps of pendentes.values()) deps.delete(t);
    }
  }
  return ordem;
}
