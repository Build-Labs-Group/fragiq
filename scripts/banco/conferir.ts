/**
 * Conferência entre dois bancos do FragIQ, sem gravar nada: linhas e
 * checksum de toda tabela, maior valor de cada coluna de data, sequences,
 * colunas, índices, restrições, enums e extensões
 * (docs/migracao-site-build-labs.md, parte "Banco").
 *
 *   npx tsx scripts/banco/conferir.ts --origem <arquivo> --destino <arquivo> [--json saida.json]
 *
 * Sai com código 1 se houver diferença. Serve depois da cópia, antes da
 * virada, e de novo no dia seguinte (o destino deve ter só linhas a mais,
 * nunca a menos).
 */
import { writeFileSync } from "node:fs";
import pg from "pg";
import { poolConfigDe } from "../../src/lib/pg-config";
import { hostDe, lerUrl } from "./copiar";
import { comparar, fotografar } from "./foto";

async function principal(argumentos: string[]) {
  const urls = { origem: lerUrl(argumentos, "--origem"), destino: lerUrl(argumentos, "--destino") };
  const fotos = await Promise.all(
    Object.values(urls).map(async (url) => {
      const c = new pg.Client(poolConfigDe(url));
      await c.connect();
      try {
        return await fotografar(c);
      } finally {
        await c.end();
      }
    }),
  );
  const [origem, destino] = fotos as [Awaited<ReturnType<typeof fotografar>>, Awaited<ReturnType<typeof fotografar>>];
  const diferencas = comparar(origem, destino);

  console.log(`origem ${hostDe(urls.origem)} (${(origem.tamanhoBytes / 1e6).toFixed(1)} MB) × destino ${hostDe(urls.destino)} (${(destino.tamanhoBytes / 1e6).toFixed(1)} MB)`);
  for (const [t, f] of Object.entries(origem.tabelas)) {
    const g = destino.tabelas[t];
    console.log(`  ${f.linhas === g?.linhas && f.checksum === g?.checksum ? "igual    " : "DIFERENTE"} ${t}: ${f.linhas} × ${g?.linhas ?? "-"}`);
  }
  const j = argumentos.indexOf("--json");
  if (j >= 0 && argumentos[j + 1]) writeFileSync(argumentos[j + 1]!, JSON.stringify({ origem, destino, diferencas }, null, 2));
  if (diferencas.length) {
    console.error(`${diferencas.length} diferenças:`, diferencas.slice(0, 50));
    process.exitCode = 1;
  } else {
    console.log("tudo igual: dados e metadados");
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/banco/conferir.ts")) {
  principal(process.argv.slice(2)).catch((erro) => {
    console.error((erro as Error).message);
    process.exit(1);
  });
}
