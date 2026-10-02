import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { gzipSync } from "node:zlib";
import unbzip2 from "unbzip2-stream";
import { config } from "./config.js";
import { logar } from "./logs.js";
import type { Ritmo } from "./ritmo.js";

/**
 * Demos: baixar, descomprimir, extrair, entregar.
 *
 * O GC responde com a URL da demo de cada partida (`Match.demoUrl`), um
 * `.dem.bz2` de ~100 MB que a Valve mantém por cerca de um mês. É a única
 * fonte do que acontece dentro do round — quem abriu, quem trocou, onde
 * cada granada caiu — e nada disso roda em serverless. Este loop pega uma
 * partida por vez da fila do site (`GET /api/bot/demos`), baixa para o
 * disco, descomprime (`bzip2` do sistema; o descompressor em JS é reserva),
 * roda `demo-parse.ts` num processo filho e posta o resultado comprimido
 * (`POST /api/bot/demos`, gzip: ~300 KB por partida inteira). Os arquivos
 * são apagados no fim, deu certo ou não. Medições em docs/demos.md.
 */

const RODADA_MS = 5 * 60_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;
const PARSE_TIMEOUT_MS = 5 * 60_000;
const PASTA = join(tmpdir(), "fragiq-demos");

type Pendente = { matchId: string; shareCode: string; demoUrl: string };

export function ligarDemos(clientLogado: () => boolean, ritmo: Ritmo) {
  let rodando = false;

  async function rodada() {
    if (rodando || !clientLogado() || !ritmo.podeChamar("demos")) return;
    rodando = true;
    try {
      const res = await fetch(config.demosUrl, { headers: { authorization: `Bearer ${config.webhookSecret}` } });
      if (!res.ok) {
        logar("WARN", `Fila de demos: ${res.status}`);
        return;
      }
      const { demos = [] } = (await res.json()) as { demos?: Pendente[] };
      // Uma demo por rodada: com mais na fila, a próxima rodada também precisa do site.
      if (demos.length) ritmo.acordar("demos na fila", 2 * RODADA_MS);
      for (const p of demos) await processar(p);
    } catch (err) {
      logar("ERROR", `Fila de demos falhou: ${err instanceof Error ? err.message : err}`);
    } finally {
      rodando = false;
    }
  }

  async function processar(p: Pendente) {
    const inicio = Date.now();
    await mkdir(PASTA, { recursive: true });
    const bz2 = join(PASTA, `${p.matchId}.dem.bz2`);
    const dem = join(PASTA, `${p.matchId}.dem`);
    try {
      const status = await baixar(p.demoUrl, bz2);
      if (status !== 200) {
        // 404 é a demo que a Valve já apagou: não adianta insistir.
        await entregar({ matchId: p.matchId, status: status === 404 ? "EXPIRED" : "FAILED", error: `download ${status}` });
        return;
      }
      await descomprimir(bz2, dem);
      const tamanho = (await stat(dem)).size;
      const payload = await extrair(dem);
      await entregar({ matchId: p.matchId, status: "DONE", payload });
      logar("INFO", `Demo ${p.shareCode}: ${Math.round(tamanho / 1e6)} MB, ${Math.round((Date.now() - inicio) / 1000)} s`);
    } catch (err) {
      const motivo = String(err instanceof Error ? err.message : err).slice(0, 300);
      logar("WARN", `Demo ${p.shareCode} falhou: ${motivo}`);
      await entregar({ matchId: p.matchId, status: "FAILED", error: motivo });
    } finally {
      await Promise.all([rm(bz2, { force: true }), rm(dem, { force: true })]);
    }
  }

  const timer = setInterval(() => void rodada(), RODADA_MS);
  setTimeout(() => void rodada(), 60_000);
  return { timer };
}

async function baixar(url: string, destino: string): Promise<number> {
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controle.signal });
    if (!res.ok || !res.body) return res.status;
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(destino));
    return 200;
  } finally {
    clearTimeout(timer);
  }
}

/** `bzip2 -dc` quando existe (Alpine: `apk add bzip2`); senão o descompressor em JS, mais lento mas suficiente. */
export async function descomprimir(bz2: string, dem: string) {
  const nativo = await new Promise<boolean>((resolve) => {
    const filho = spawn("bzip2", ["-dc", bz2], { stdio: ["ignore", "pipe", "ignore"] });
    filho.on("error", () => resolve(false));
    // `close` do processo vem depois de o stdout esvaziar: só aí o arquivo está inteiro e o código de saída existe.
    const escrita = pipeline(filho.stdout, createWriteStream(dem)).then(() => true, () => false);
    filho.on("close", (codigo) => void escrita.then((ok) => resolve(ok && codigo === 0)));
  });
  if (nativo) return;
  await pipeline(createReadStream(bz2), unbzip2(), createWriteStream(dem));
}

/** O parser num processo à parte: se faltar memória, cai ele, não o bot. */
export function extrair(dem: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const filho = spawn(process.execPath, [join(process.cwd(), "node_modules/.bin/tsx"), join(process.cwd(), "src/demo-parse.ts"), dem], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const saida: Buffer[] = [];
    let erro = "";
    const timer = setTimeout(() => filho.kill("SIGKILL"), PARSE_TIMEOUT_MS);
    filho.stdout.on("data", (c: Buffer) => saida.push(c));
    filho.stderr.on("data", (c: Buffer) => (erro += c.toString()));
    filho.on("error", reject);
    filho.on("close", (codigo, sinal) => {
      clearTimeout(timer);
      if (codigo !== 0) return reject(new Error(`parser saiu com ${codigo ?? sinal}: ${erro.trim().split("\n").at(-1) ?? ""}`));
      try {
        resolve(JSON.parse(Buffer.concat(saida).toString("utf8")));
      } catch (e) {
        reject(e);
      }
    });
  });
}

async function entregar(resultado: { matchId: string; status: "DONE" | "EXPIRED" | "FAILED"; error?: string; payload?: unknown }) {
  const corpo = gzipSync(JSON.stringify(resultado));
  const res = await fetch(config.demosUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Encoding": "gzip", authorization: `Bearer ${config.webhookSecret}` },
    body: corpo,
  }).catch((err) => {
    logar("ERROR", `Fila de demos: não gravou: ${err instanceof Error ? err.message : err}`);
    return null;
  });
  if (res && !res.ok) logar("WARN", `Fila de demos: gravação ${res.status} (${Math.round(corpo.length / 1024)} KB)`);
}
