import { config } from "./config.js";
import { logar } from "./logs.js";
import type { Ritmo } from "./ritmo.js";

/**
 * Preços do Mercado da Comunidade, lidos daqui porque a Steam deixa.
 *
 * O `priceoverview` responde 429 para o IP da plataforma (ECS) e 200 para
 * este host — medido em 17/09/2026. O site decide o que venceu
 * (`GET /api/bot/precos`), este loop lê um nome por vez com 4 s entre
 * chamadas (a Steam tolera ~20/min por IP e a fila não tem pressa) e
 * devolve (`POST /api/bot/precos`). Um 429 encerra a rodada; a próxima
 * espera 5 min (depois 10, 15 no máximo) e volta a 1 min quando passa.
 */

const ESPACO_MS = 6_000;
const RODADA_MS = 60_000;
/** Depois de um 429: medido em 17/09, 5 leituras passam e a sexta leva 429; 5 min bastam para a Steam esquecer. */
const CALMA_MS = 5 * 60_000;
const CALMA_MAX_MS = 15 * 60_000;

type Resultado = { marketHashName: string; listado: boolean; menorCents: number | null; medianaCents: number | null; volume: number | null };

/** `R$ 1.234,56` / `$12.34` / `12,34€` → centavos; null quando ilegível. */
export function centavos(texto: string | null | undefined): number | null {
  if (!texto) return null;
  const digitos = [...texto].filter((c) => /[0-9,.]/.test(c)).join("");
  if (!digitos) return null;
  let inteiro = digitos;
  let decimal = "00";
  for (const sep of [",", "."]) {
    const i = digitos.lastIndexOf(sep);
    if (i !== -1 && digitos.length - i - 1 === 2) {
      inteiro = digitos.slice(0, i);
      decimal = digitos.slice(i + 1);
      break;
    }
  }
  const n = Number(inteiro.replace(/[.,]/g, "") || "0");
  return Number.isFinite(n) ? n * 100 + Number(decimal) : null;
}

export function volume(texto: string | null | undefined): number | null {
  const d = (texto ?? "").replace(/\D/g, "");
  return d ? Number(d) : null;
}

async function ler(nome: string): Promise<Resultado | "calma"> {
  const url = new URL("https://steamcommunity.com/market/priceoverview/");
  url.searchParams.set("appid", "730");
  url.searchParams.set("currency", "7");
  url.searchParams.set("market_hash_name", nome);
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (res.status === 429) return "calma";
  if (!res.ok) throw new Error(`priceoverview ${res.status}`);
  const d = (await res.json().catch(() => null)) as { success?: boolean; lowest_price?: string; median_price?: string; volume?: string } | null;
  if (!d?.success) return { marketHashName: nome, listado: false, menorCents: null, medianaCents: null, volume: null };
  return { marketHashName: nome, listado: true, menorCents: centavos(d.lowest_price), medianaCents: centavos(d.median_price), volume: volume(d.volume) };
}

export function ligarPrecos(clientLogado: () => boolean, ritmo: Ritmo) {
  let rodando = false;
  let espera = RODADA_MS;
  if (!config.precos) return { parar() {} };

  async function rodada() {
    if (rodando) return;
    rodando = true;
    try {
      // Dentro do try: o finally reagenda a próxima rodada (antes, sem sessão na primeira, o laço parava).
      if (!clientLogado() || !ritmo.podeChamar("precos")) return;
      const res = await fetch(config.precosUrl, { headers: { authorization: `Bearer ${config.webhookSecret}` } });
      if (!res.ok) return;
      const { nomes } = (await res.json()) as { nomes: string[] };
      for (const nome of nomes) {
        const r = await ler(nome);
        if (r === "calma") {
          espera = Math.min(espera >= CALMA_MS ? espera * 2 : CALMA_MS, CALMA_MAX_MS);
          logar("WARN", `mercado pediu calma (429); próxima rodada em ${Math.round(espera / 1000)} s`);
          return;
        }
        await fetch(config.precosUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", authorization: `Bearer ${config.webhookSecret}` },
          body: JSON.stringify(r),
        });
        await new Promise((r) => setTimeout(r, ESPACO_MS));
      }
      espera = RODADA_MS;
      if (nomes.length) logar("INFO", `preços: ${nomes.length} lidos`);
    } catch (err) {
      logar("ERROR", `preços falharam: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      rodando = false;
      timer = setTimeout(() => void rodada(), espera);
    }
  }

  let timer: NodeJS.Timeout = setTimeout(() => void rodada(), 15_000);
  return { parar: () => clearTimeout(timer) };
}
