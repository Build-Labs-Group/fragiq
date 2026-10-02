/**
 * Cópia do banco do FragIQ de um Postgres para outro (Supabase → Neon),
 * com conferência no fim. Plano e janela em docs/migracao-site-build-labs.md.
 *
 *   npx tsx scripts/banco/copiar.ts --origem <arquivo> --destino <arquivo>          ensaio: só mostra
 *   npx tsx scripts/banco/copiar.ts --origem <arquivo> --destino <arquivo> --sim    copia e confere
 *
 * Cada arquivo tem só a URL do banco (sem pooler; a do Supabase é a
 * `SUPA_POSTGRES_URL_NON_POOLING`). As URLs nunca são impressas: apague os
 * arquivos no fim.
 *
 * O destino precisa estar com o schema pronto e vazio: `prisma migrate
 * deploy` nele antes (o schema é o das migrações, igual ao da origem). A
 * cópia lê a origem num snapshot só (REPEATABLE READ) e grava o destino numa
 * transação só: ou vai tudo, ou nada. `_prisma_migrations` vai linha a linha
 * da origem (mesmos ids, checksums e datas), e as sequences ficam no mesmo
 * valor. A escrita na origem precisa estar parada (bot e site), senão o
 * snapshot fica velho no instante seguinte.
 */
import { readFileSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import pg from "pg";
import { from as copiarPara, to as copiarDe } from "pg-copy-streams";
import { poolConfigDe } from "../../src/lib/pg-config";
import { aspas, comparar, fotografar, ordemPorDependencia, SESSAO_ESTAVEL } from "./foto";

export const TABELA_DO_PRISMA = "_prisma_migrations";

export function lerUrl(argumentos: string[], nome: "--origem" | "--destino"): string {
  const i = argumentos.indexOf(nome);
  const arquivo = i >= 0 ? argumentos[i + 1] : undefined;
  if (!arquivo) throw new Error(`falta ${nome} <arquivo com a URL do banco>`);
  const url = readFileSync(arquivo, "utf8").trim();
  if (!/^postgres(ql)?:\/\//.test(url)) throw new Error(`${nome}: o arquivo não tem uma URL postgresql://`);
  return url;
}

/** Só o host, para o log dizer de onde para onde sem mostrar usuário nem senha. */
export const hostDe = (url: string) => new URL(url).hostname;

async function conectar(url: string) {
  const c = new pg.Client(poolConfigDe(url));
  await c.connect();
  for (const sql of SESSAO_ESTAVEL) await c.query(sql);
  return c;
}

async function principal(argumentos: string[]) {
  const gravar = argumentos.includes("--sim");
  const urlOrigem = lerUrl(argumentos, "--origem");
  const urlDestino = lerUrl(argumentos, "--destino");
  console.log(`origem ${hostDe(urlOrigem)} → destino ${hostDe(urlDestino)}${gravar ? "" : " (ensaio)"}`);

  const origem = await conectar(urlOrigem);
  const destino = await conectar(urlDestino);
  try {
    const [fotoOrigem, fotoDestino] = await Promise.all([fotografar(origem), fotografar(destino)]);
    const tabelas = Object.keys(fotoOrigem.tabelas);
    console.log(`origem: ${tabelas.length} tabelas, ${(fotoOrigem.tamanhoBytes / 1e6).toFixed(1)} MB`);
    for (const t of tabelas) console.log(`  ${t}: ${fotoOrigem.tabelas[t]!.linhas}`);

    // O schema do destino tem de ser o mesmo; os dados, nenhum.
    const doSchema = comparar(fotoOrigem, fotoDestino).filter((d) => /^(colunas|indices|restricoes|enum|tabela )/.test(d.onde));
    if (doSchema.length) {
      console.error("schema do destino diferente da origem (rode `prisma migrate deploy` nele antes):", doSchema.slice(0, 20));
      process.exitCode = 1;
      return;
    }
    const comDados = Object.entries(fotoDestino.tabelas).filter(([t, f]) => t !== TABELA_DO_PRISMA && f.linhas > 0);
    if (comDados.length) {
      console.error("o destino já tem dados; a cópia só vai para um banco vazio:", comDados.map(([t, f]) => `${t}=${f.linhas}`));
      process.exitCode = 1;
      return;
    }

    const { rows: chaves } = await origem.query<{ de: string; para: string }>(
      `SELECT c.conrelid::regclass::text AS de, c.confrelid::regclass::text AS para
         FROM pg_constraint c WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace`,
    );
    const semAspas = (n: string) => n.replace(/^public\./, "").replace(/^"|"$/g, "");
    const ordem = ordemPorDependencia(
      tabelas.filter((t) => t !== TABELA_DO_PRISMA),
      chaves.map((k) => ({ de: semAspas(k.de), para: semAspas(k.para) })),
    );
    console.log("ordem de cópia:", [TABELA_DO_PRISMA, ...ordem].join(", "));
    if (!gravar) {
      console.log("ensaio: nada gravado (falta --sim)");
      return;
    }

    const { rows: colunas } = await origem.query<{ tabela: string; coluna: string }>(
      `SELECT table_name AS tabela, column_name AS coluna FROM information_schema.columns
        WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`,
    );
    const colunasDe = (t: string) => colunas.filter((c) => c.tabela === t).map((c) => aspas(c.coluna)).join(", ");

    const inicio = Date.now();
    await origem.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await destino.query("BEGIN");
    try {
      await destino.query(`TRUNCATE public.${aspas(TABELA_DO_PRISMA)}`);
      for (const t of [TABELA_DO_PRISMA, ...ordem]) {
        const cols = colunasDe(t);
        const leitura = origem.query(copiarDe(`COPY (SELECT ${cols} FROM public.${aspas(t)}) TO STDOUT`));
        const escrita = destino.query(copiarPara(`COPY public.${aspas(t)} (${cols}) FROM STDIN`));
        await pipeline(leitura, escrita);
        console.log(`  copiada ${t}`);
      }
      const { rows: sequencias } = await origem.query<{ nome: string; valor: string | null }>(
        `SELECT sequencename AS nome, last_value::text AS valor FROM pg_sequences WHERE schemaname = 'public'`,
      );
      for (const s of sequencias) {
        if (s.valor === null) await destino.query(`SELECT setval($1, 1, false)`, [`public.${aspas(s.nome)}`]);
        else await destino.query(`SELECT setval($1, $2::bigint, true)`, [`public.${aspas(s.nome)}`, s.valor]);
      }
      await destino.query("COMMIT");
    } catch (erro) {
      await destino.query("ROLLBACK").catch(() => {});
      throw erro;
    } finally {
      await origem.query("COMMIT").catch(() => {});
    }
    console.log(`cópia em ${((Date.now() - inicio) / 1000).toFixed(1)} s; conferindo...`);

    const diferencas = comparar(await fotografar(origem), await fotografar(destino));
    if (diferencas.length) {
      console.error(`${diferencas.length} diferenças:`, diferencas.slice(0, 50));
      process.exitCode = 1;
    } else {
      console.log("conferência: linhas, checksums, datas máximas, sequences, índices, restrições e enums iguais");
    }
  } finally {
    await origem.end();
    await destino.end();
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/banco/copiar.ts")) {
  principal(process.argv.slice(2)).catch((erro) => {
    console.error((erro as Error).message);
    process.exit(1);
  });
}
