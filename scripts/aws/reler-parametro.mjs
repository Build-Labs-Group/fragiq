/**
 * Faz a Lambda do site ler `/fragiq/prod/site` de novo, sem publicar.
 *
 * O site lê o parâmetro no boot (`aws/iniciar.mjs`); ambientes quentes
 * guardam a versão antiga até morrer. Mudar uma variável da função descarta
 * todos eles: esta ferramenta grava `SEGREDO_RELIDO=<agora>` mantendo as
 * outras variáveis e espera a atualização terminar. É o passo final de uma
 * troca do parâmetro (virada ou volta do banco, docs/migracao-banco-aws.md).
 * A próxima publicação da pilha tira a variável, e tudo bem: a versão nova
 * do código também nasce em ambientes novos.
 *
 *   node scripts/aws/reler-parametro.mjs [--funcao fragiq-site] [--perfil buildlabs]
 *
 * Usa a AWS CLI (perfil `buildlabs`, us-east-2). Não lê nem imprime segredo:
 * as variáveis da função são nomes e configuração.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** As variáveis atuais com a marca de releitura nova. Exportada para o teste. */
export function comReleitura(variaveis, agora = new Date()) {
  return { ...variaveis, SEGREDO_RELIDO: agora.toISOString().replace(/\.\d{3}Z$/, "Z") };
}

function aws(perfil, argumentos) {
  const saida = execFileSync("aws", [...argumentos, "--profile", perfil, "--region", "us-east-2", "--output", "json"], {
    encoding: "utf8",
    env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  });
  return saida.trim() ? JSON.parse(saida) : {};
}

function opcao(nome, padrao) {
  const i = process.argv.indexOf(nome);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}

function principal() {
  const funcao = opcao("--funcao", "fragiq-site");
  const perfil = opcao("--perfil", "buildlabs");
  const atual = aws(perfil, ["lambda", "get-function-configuration", "--function-name", funcao]);
  const variaveis = comReleitura(atual.Environment?.Variables ?? {});
  const pasta = mkdtempSync(join(tmpdir(), "reler-"));
  try {
    const arquivo = join(pasta, "entrada.json");
    writeFileSync(arquivo, JSON.stringify({ FunctionName: funcao, Environment: { Variables: variaveis } }));
    // A CLI quer `file://` + caminho (C:/... no Windows, /tmp/... no Linux).
    aws(perfil, ["lambda", "update-function-configuration", "--cli-input-json", `file://${arquivo.replace(/\\/g, "/")}`]);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
  aws(perfil, ["lambda", "wait", "function-updated-v2", "--function-name", funcao]);
  console.log(`${funcao}: SEGREDO_RELIDO=${variaveis.SEGREDO_RELIDO}; ambientes novos leem o parâmetro de novo`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) principal();
