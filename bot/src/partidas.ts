import type SteamUser from "steam-user";
import GlobalOffensive, { type MatchInfo } from "globaloffensive";
import { ShareCode } from "globaloffensive-sharecode";
import { CS2_APPID, config } from "./config.js";
import { lerCabecalhoDaDemo } from "./demo-header.js";
import type { Ritmo } from "./ritmo.js";

/** Depois de uma partida na fila vêm a demo e, às vezes, outra partida da mesma corrente. */
const JANELA_DA_FILA_MS = 10 * 60_000;

/**
 * A ponte com o Game Coordinator do CS2.
 *
 * O site descobre share codes pela Web API; quem transforma um share code
 * em scoreboard é o GC, e o GC só fala com um cliente Steam "dentro do
 * jogo". Este módulo abre essa sessão (a licença gratuita do CS2 é o que
 * faz a Steam aceitar o gamesPlayed), busca a fila do site e devolve o que
 * o GC contar sobre cada partida. Uma por vez: a resposta não diz a qual
 * pedido pertence, então casamos pelo matchid decodificado do código.
 */

type Pendente = { id: string; shareCode: string };
type SemMapa = { shareCode: string; demoUrl: string };

type Resultado = {
  shareCode: string;
  status: "DONE" | "EXPIRED" | "FAILED";
  error?: string;
  partida?: {
    matchId: string;
    matchtime: number;
    duracaoS: number;
    rounds: number;
    gameType: number | null;
    demoUrl: string | null;
    mapa: string | null;
    servidor: string | null;
    contas: number[];
    kills: number[];
    assists: number[];
    deaths: number[];
    mvps: number[];
    scores: number[];
    hs: number[];
    pings: number[];
    placar: [number, number];
    /** A resposta inteira: o site guarda o fato, não só o que já virou coluna. */
    gc: unknown;
  };
};

/**
 * O protobuf decodificado traz uint64 como Long (`{ low, high, unsigned }`)
 * e bytes como Buffer; nenhum dos dois sobrevive a JSON. Longs viram string
 * decimal, Buffers somem (são chaves de criptografia da reserva).
 */
export function serializavel(valor: unknown): unknown {
  if (valor === null || typeof valor !== "object") return valor;
  if (Buffer.isBuffer(valor)) return undefined;
  if (Array.isArray(valor)) return valor.map(serializavel);
  const o = valor as Record<string, unknown>;
  if (typeof o.low === "number" && typeof o.high === "number" && typeof o.unsigned === "boolean") {
    const hi = BigInt(o.high >>> 0);
    const lo = BigInt(o.low >>> 0);
    return o.unsigned ? ((hi << 32n) | lo).toString() : BigInt.asIntN(64, (hi << 32n) | lo).toString();
  }
  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    const s = serializavel(v);
    if (s !== undefined) saida[k] = s;
  }
  return saida;
}

const TIMEOUT_MS = 20_000;

export function ligarPartidas(client: SteamUser, ritmo: Ritmo) {
  const csgo = new GlobalOffensive(client);
  let esperando: { matchId: string; resolve: (m: MatchInfo | null) => void } | null = null;

  client.on("loggedOn", () => {
    client.requestFreeLicense([CS2_APPID], (err) => {
      if (err) console.warn("Licença do CS2:", err.message);
      client.gamesPlayed([CS2_APPID]);
    });
  });

  csgo.on("connectedToGC", () => console.log("GC do CS2 conectado."));
  csgo.on("disconnectedFromGC", (motivo) => console.warn("GC do CS2 desconectou:", motivo));

  csgo.on("matchList", (matches) => {
    if (!esperando) return;
    const achada = matches.find((m) => String(m.matchid) === esperando?.matchId) ?? null;
    if (achada || matches.length === 0) {
      const { resolve } = esperando;
      esperando = null;
      resolve(achada);
    }
  });

  function pedir(shareCode: string): Promise<MatchInfo | null | "timeout"> {
    const { matchId } = new ShareCode(shareCode).decode();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        esperando = null;
        resolve("timeout");
      }, TIMEOUT_MS);
      esperando = {
        matchId,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      };
      csgo.requestGame(shareCode);
    });
  }

  let rodando = false;

  async function processarFila() {
    if (rodando || !csgo.haveGCSession || !ritmo.podeChamar("partidas")) return;
    rodando = true;
    try {
      const res = await fetch(config.partidasUrl, {
        headers: { authorization: `Bearer ${config.webhookSecret}` },
      });
      if (!res.ok) {
        console.warn(`Fila de partidas: ${res.status}`);
        return;
      }
      const { partidas, semMapa = [] } = (await res.json()) as { partidas: Pendente[]; semMapa?: SemMapa[] };
      if (partidas.length || semMapa.length) ritmo.acordar("partidas na fila", JANELA_DA_FILA_MS);
      for (const p of partidas) {
        const resultado = await consultar(p.shareCode);
        console.log(`Partida ${p.shareCode}: ${resultado.status}${resultado.error ? ` (${resultado.error})` : ""}`);
        await gravar(resultado);
        await new Promise((r) => setTimeout(r, 1500));
      }
      for (const p of semMapa) {
        const cabecalho = await lerCabecalhoDaDemo(p.demoUrl).catch(() => ({ mapa: null, servidor: null }));
        console.log(`Mapa ${p.shareCode}: ${cabecalho.mapa ?? "não lido"}`);
        await gravar({ shareCode: p.shareCode, status: "MAPA", ...cabecalho });
      }
    } catch (err) {
      console.error("Fila de partidas falhou:", err);
    } finally {
      rodando = false;
    }
  }

  async function gravar(resultado: Resultado | { shareCode: string; status: "MAPA"; mapa: string | null; servidor: string | null }) {
    await fetch(config.partidasUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", authorization: `Bearer ${config.webhookSecret}` },
      body: JSON.stringify(resultado),
    }).catch((err) => console.error("Fila de partidas: não gravou:", err));
  }

  async function consultar(shareCode: string): Promise<Resultado> {
    let info: MatchInfo | null | "timeout";
    try {
      info = await pedir(shareCode);
    } catch (err) {
      return { shareCode, status: "FAILED", error: String(err instanceof Error ? err.message : err).slice(0, 300) };
    }
    if (info === "timeout") return { shareCode, status: "FAILED", error: "o GC não respondeu" };
    if (!info) return { shareCode, status: "EXPIRED" };

    const fim = info.roundstatsall?.at(-1) ?? info.roundstats_legacy;
    const contas = fim?.reservation?.account_ids ?? [];
    if (!fim || contas.length === 0) return { shareCode, status: "FAILED", error: "resposta do GC sem scoreboard" };

    const demoUrl = fim.map ?? null;
    const cabecalho = demoUrl
      ? await lerCabecalhoDaDemo(demoUrl).catch((err) => {
          console.warn("Cabeçalho da demo falhou:", err instanceof Error ? err.message : err);
          return { mapa: null, servidor: null };
        })
      : { mapa: null, servidor: null };

    return {
      shareCode,
      status: "DONE",
      partida: {
        matchId: String(info.matchid),
        matchtime: info.matchtime ?? 0,
        duracaoS: fim.match_duration ?? 0,
        rounds: (fim.team_scores?.[0] ?? 0) + (fim.team_scores?.[1] ?? 0),
        gameType: fim.reservation?.game_type ?? null,
        demoUrl,
        mapa: cabecalho.mapa,
        servidor: cabecalho.servidor,
        contas,
        kills: fim.kills ?? [],
        assists: fim.assists ?? [],
        deaths: fim.deaths ?? [],
        mvps: fim.mvps ?? [],
        scores: fim.scores ?? [],
        hs: fim.enemy_headshots ?? [],
        pings: fim.pings ?? [],
        placar: [fim.team_scores?.[0] ?? 0, fim.team_scores?.[1] ?? 0],
        gc: serializavel(info),
      },
    };
  }

  const timer = setInterval(() => void processarFila(), config.outboxPollMs);
  return { timer, gcConectado: () => csgo.haveGCSession };
}
