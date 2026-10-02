/**
 * Monta o pacote do site para a Lambda, em `.aws/site/`
 * (docs/migracao-site-build-labs.md). O `infra/cdk.json` roda este script
 * antes de sintetizar a pilha, então a esteira `publicar.yml` (que só faz
 * `npm ci` e `cdk deploy` em `infra/`) também constrói o site.
 *
 *   1. `npm ci` na raiz, se ainda não há `node_modules` (o `postinstall` gera o Prisma);
 *   2. `next build` com `FRAGIQ_ALVO=aws` (saída standalone);
 *   3. copia `.next/standalone`, `.next/static`, `public` e o boot (`aws/`)
 *      para `.aws/site/`, sem o sharp (o site não otimiza imagem).
 *
 * O build lê `DATABASE_URL` ao coletar as rotas, mas não conecta: uma URL
 * fictícia basta, e nenhum segredo entra no build. Com `FRAGIQ_PULAR_BUILD=1`
 * só refaz a cópia (útil depois de um build manual).
 *
 * No fim gera `.aws/site.zip`, que é o que a pilha publica. O zip é feito
 * aqui, e não pelo CDK, para o `run.sh` sair executável (0755) em qualquer
 * máquina: o Windows não grava o bit de execução, e sem ele a Lambda não sobe.
 */
import { execSync } from "node:child_process";
import { chmodSync, cpSync, createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { finished } from "node:stream/promises";
import yazl from "yazl";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const destino = join(raiz, ".aws", "site");

const rodar = (comando, env = {}) =>
  execSync(comando, { cwd: raiz, stdio: "inherit", env: { ...process.env, ...env } });

if (process.env.FRAGIQ_PULAR_BUILD !== "1") {
  if (!existsSync(join(raiz, "node_modules"))) rodar("npm ci --no-audit --no-fund");
  rodar("npx next build", {
    FRAGIQ_ALVO: "aws",
    NEXT_TELEMETRY_DISABLED: "1",
    DATABASE_URL: "postgresql://build:build@127.0.0.1:1/build",
  });
}

const standalone = join(raiz, ".next", "standalone");
if (!existsSync(join(standalone, "server.js"))) {
  throw new Error(".next/standalone/server.js não existe: o build não rodou com FRAGIQ_ALVO=aws");
}

rmSync(destino, { recursive: true, force: true });
mkdirSync(destino, { recursive: true });
cpSync(standalone, destino, { recursive: true });
cpSync(join(raiz, ".next", "static"), join(destino, ".next", "static"), { recursive: true });
if (existsSync(join(raiz, "public"))) cpSync(join(raiz, "public"), join(destino, "public"), { recursive: true });
// O sharp só serve ao otimizador de imagem, desligado no build da AWS; é binário da máquina do build.
for (const pasta of ["node_modules/sharp", "node_modules/@img"]) rmSync(join(destino, pasta), { recursive: true, force: true });
cpSync(join(raiz, "aws", "iniciar.mjs"), join(destino, "iniciar.mjs"));

// O Lambda Web Adapter roda este script como handler. LF sempre, e executável.
const runSh = [
  "#!/bin/bash",
  "# Handler da Lambda: o Lambda Web Adapter (layer) espera o servidor responder na porta 8080.",
  "export PORT=8080 HOSTNAME=127.0.0.1 NODE_ENV=production",
  'cd "$(dirname "$0")"',
  "exec node iniciar.mjs",
  "",
].join("\n");
writeFileSync(join(destino, "run.sh"), runSh);
chmodSync(join(destino, "run.sh"), 0o755);

/** Todos os arquivos da pasta, com caminho relativo e barras `/`. */
function arquivos(pasta) {
  return readdirSync(pasta, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() || d.isSymbolicLink())
    .map((d) => join(d.parentPath, d.name));
}

const zip = new yazl.ZipFile();
const caminhoDoZip = join(raiz, ".aws", "site.zip");
rmSync(caminhoDoZip, { force: true });
const saida = createWriteStream(caminhoDoZip);
zip.outputStream.pipe(saida);
for (const arquivo of arquivos(destino).sort()) {
  const nome = relative(destino, arquivo).split("\\").join("/");
  zip.addFile(arquivo, nome, { mode: nome === "run.sh" ? 0o100755 : 0o100644, mtime: new Date(0) });
}
zip.end();
await finished(saida);

console.log(`[construir] pacote do site em ${destino} e ${caminhoDoZip} (${(statSync(caminhoDoZip).size / 1e6).toFixed(1)} MB)`);
