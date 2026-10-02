/**
 * O log do bot vai para o site, não só para o `docker logs`.
 *
 * Tudo o que passa por `console.*` é capturado, enfileirado e enviado em
 * lotes para `POST /api/bot/logs` — a cada 10 s ou quando juntam 50
 * linhas, o que vier antes. O console continua imprimindo: o painel é o
 * caminho normal de leitura, o container é o de emergência.
 *
 * `logar` é a forma explícita: nível, mensagem e, quando o bot sabe, de
 * quem (`steamId`) e de qual trace se trata. As chamadas antigas de
 * `console.log` viram INFO sem dono; um steamId no início da mensagem é
 * reconhecido e anexado, porque é assim que o bot sempre escreveu
 * ("7656... entrou no CS2").
 *
 * Falha de rede não perde linha: o lote volta para a fila, com teto para
 * a memória não crescer sem fim numa queda longa do site.
 *
 * Com o bot em repouso (ritmo.ts), o envio periódico espera o turno
 * (`podeEnviar`), para uma linha solta não acordar o banco do site. Lote
 * cheio e a despedida saem na hora.
 */

export type Nivel = "DEBUG" | "INFO" | "WARN" | "ERROR";
export type Linha = { nivel: Nivel; mensagem: string; dados?: Record<string, unknown>; steamId?: string; traceId?: string; em: string };

const LOTE = 50;
const INTERVALO_MS = 10_000;
const TETO = 5_000;
const STEAM_ID = /^(7656119\d{10})\b/;

let fila: Linha[] = [];
let enviando = false;
let destino: { url: string; secret: string } | null = null;
let timer: NodeJS.Timeout | null = null;
/** Se o envio periódico pode chamar o site agora (o ritmo do bot); sem ele, sempre. */
let podeEnviar: () => boolean = () => true;

const original = { log: console.log, warn: console.warn, error: console.error };

function texto(args: unknown[]): string {
  return args
    .map((a) => (a instanceof Error ? `${a.message}` : typeof a === "string" ? a : JSON.stringify(a)))
    .join(" ")
    .slice(0, 2000);
}

function enfileirar(linha: Linha) {
  fila.push(linha);
  if (fila.length > TETO) fila = fila.slice(-TETO);
  if (fila.length >= LOTE) void enviar(true);
}

export function logar(nivel: Nivel, mensagem: string, extra: { steamId?: string; traceId?: string; dados?: Record<string, unknown> } = {}) {
  const em = new Date().toISOString();
  const prefixo = extra.steamId ? `${extra.steamId} ` : "";
  (nivel === "ERROR" ? original.error : nivel === "WARN" ? original.warn : original.log)(`${prefixo}${mensagem}`);
  enfileirar({ nivel, mensagem, em, ...extra });
}

/** Liga a captura do console e o envio periódico. Sem destino, só o console. */
export function ligarLogs(opcoes: { url: string; secret: string; podeEnviar?: () => boolean } | null) {
  destino = opcoes ? { url: opcoes.url, secret: opcoes.secret } : null;
  if (opcoes?.podeEnviar) podeEnviar = opcoes.podeEnviar;
  for (const [metodo, nivel] of [
    ["log", "INFO"],
    ["warn", "WARN"],
    ["error", "ERROR"],
  ] as const) {
    console[metodo] = (...args: unknown[]) => {
      original[metodo](...args);
      const mensagem = texto(args);
      const steamId = mensagem.match(STEAM_ID)?.[1];
      enfileirar({ nivel, mensagem, em: new Date().toISOString(), ...(steamId ? { steamId } : {}) });
    };
  }
  if (destino) timer = setInterval(() => void enviar(false), INTERVALO_MS);
}

/** Exportado para o teste. `forcar`: lote cheio ou despedida, sai mesmo em repouso. */
export async function enviar(forcar: boolean) {
  if (!destino || enviando || fila.length === 0) return;
  // Só gasta o turno do repouso quando há o que mandar.
  if (!forcar && !podeEnviar()) return;
  enviando = true;
  const lote = fila.splice(0, 500);
  try {
    const res = await fetch(destino.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", authorization: `Bearer ${destino.secret}` },
      body: JSON.stringify({ linhas: lote }),
    });
    // 400 é lote que o site nunca vai aceitar; reenviar só repetiria o erro.
    if (!res.ok && res.status !== 400) fila = [...lote, ...fila].slice(-TETO);
  } catch {
    fila = [...lote, ...fila].slice(-TETO);
  } finally {
    enviando = false;
  }
}

/** Último envio antes de sair; espera no máximo alguns segundos. */
export async function despedirLogs() {
  if (timer) clearInterval(timer);
  await Promise.race([enviar(true), new Promise((r) => setTimeout(r, 3000))]);
}
