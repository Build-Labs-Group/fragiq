/**
 * O ritmo do bot com o site: atento quando há trabalho, em repouso quando não há.
 *
 * Cada chamada do bot ao site é uma consulta no Postgres. Batendo a cada 20
 * ou 30 s, o banco nunca dormia, e o Neon grátis (100 CU-hora por mês, que
 * desliga a computação depois de 5 min parado) não aguentava: 0,25 CU × 730 h
 * dá 182. É a correção D2 de docs/migracao-site-build-labs.md.
 *
 * - **Atento** (o ritmo de sempre: tick 30 s, filas 20 s, demos 5 min):
 *   na subida, e por uma janela depois de algo que gera trabalho no site
 *   (fim de partida, captura processada, mensagem, partida ou demo na fila,
 *   amigo novo). A janela padrão, 35 min, cobre as tentativas de captura
 *   do site (90 s + 2, 4, 8 e 16 min, `src/lib/capturas.ts`).
 * - **Repouso**: cada laço chama o site uma vez por turno de `repousoMs`,
 *   e os turnos são do relógio (múltiplos de `repousoMs`), então todos
 *   chamam no mesmo minuto e o banco acorda uma vez só por turno.
 *
 * O que nasce no site sem o bot saber (alguém sincroniza na tela, o cron
 * das 05:00) espera no máximo um turno. `repousoMs = 0` desliga o repouso:
 * é a volta sem mexer no código (`BOT_REPOUSO_MS=0`).
 */

export type Ritmo = {
  /** Algo aconteceu que pode gerar trabalho no site: fica atento por `porMs` (padrão: a janela). */
  acordar(motivo: string, porMs?: number): void;
  /** Se o laço `laco` pode chamar o site agora. No repouso, uma vez por turno e laço. */
  podeChamar(laco: string): boolean;
  atento(): boolean;
  /** Para o tick e o log: o estado de agora e até quando. */
  estado(): { atento: boolean; atentoAte: string | null; repousoMs: number };
};

export type OpcoesDoRitmo = {
  /** Quanto tempo fica atento depois de um `acordar` sem prazo. */
  janelaMs: number;
  /** Tamanho do turno no repouso; 0 desliga o repouso. */
  repousoMs: number;
  agora?: () => number;
  /** Chamado na troca de estado (atento → repouso e volta), para o log. */
  aoMudar?: (atento: boolean, motivo: string) => void;
};

export function criarRitmo({ janelaMs, repousoMs, agora = Date.now, aoMudar }: OpcoesDoRitmo): Ritmo {
  // Começa atento: na subida o bot quer saber das filas e o site quer o primeiro sinal.
  let atentoAte = agora() + janelaMs;
  let estavaAtento = true;
  /** laço → turno de repouso em que já chamou. */
  const chamouNoTurno = new Map<string, number>();

  const atento = () => repousoMs <= 0 || agora() < atentoAte;

  /** Avisa a troca de estado uma vez, na primeira vez que alguém olha depois dela. */
  function observar(motivo: string) {
    const agoraAtento = atento();
    if (agoraAtento !== estavaAtento) {
      estavaAtento = agoraAtento;
      aoMudar?.(agoraAtento, motivo);
    }
    return agoraAtento;
  }

  return {
    acordar(motivo, porMs = janelaMs) {
      const ate = agora() + porMs;
      if (ate > atentoAte) atentoAte = ate;
      observar(motivo);
    },
    podeChamar(laco) {
      if (observar("janela acabou")) return true;
      const turno = Math.floor(agora() / repousoMs);
      if (chamouNoTurno.get(laco) === turno) return false;
      chamouNoTurno.set(laco, turno);
      return true;
    },
    atento: () => observar("janela acabou"),
    estado: () => {
      const a = observar("janela acabou");
      return { atento: a, atentoAte: repousoMs > 0 ? new Date(atentoAte).toISOString() : null, repousoMs };
    },
  };
}

/** Lê `BOT_JANELA_MS` e `BOT_REPOUSO_MS`, com os padrões de produção (35 e 30 min). */
export function opcoesDoAmbiente(ambiente: Record<string, string | undefined>): Pick<OpcoesDoRitmo, "janelaMs" | "repousoMs"> {
  const numero = (nome: string, padrao: number) => {
    const bruto = ambiente[nome]?.trim();
    if (!bruto) return padrao;
    const n = Number(bruto);
    return Number.isFinite(n) && n >= 0 ? n : padrao;
  };
  return { janelaMs: numero("BOT_JANELA_MS", 35 * 60_000), repousoMs: numero("BOT_REPOUSO_MS", 30 * 60_000) };
}
