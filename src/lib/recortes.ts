import { formatarDia, formatarNumero } from "./formato";

/**
 * De onde um número vem, dito do mesmo jeito em todas as telas.
 *
 * O FragIQ tem cinco fontes para a "mesma" estatística, e elas dão números
 * diferentes de propósito: o K/D da última sessão (delta entre duas coletas),
 * o das partidas oficiais (scoreboard do GC), o das demos (round a round),
 * o vitalício da Steam (a vida inteira, todos os modos) e o da comunidade
 * (todos os jogadores do FragIQ). Em produção a mesma conta mostrava K/D
 * 1,66 no Resumo, 1,33 em Partidas e 0,71 como "vitalício" — três números
 * certos que pareciam um erro, porque nenhum dizia de onde vinha.
 *
 * A regra: **todo número grande diz o seu recorte**, e o recorte é um destes
 * tipos, com o mesmo nome, o mesmo ícone e a mesma ordem de confiança em
 * qualquer tela. Este módulo é o modelo; `components/graficos/recorte.tsx`
 * é a única forma de desenhá-lo.
 */
export type TipoDeRecorte = "sessao" | "partidas" | "demos" | "vitalicio" | "periodo" | "comunidade";

export type Recorte = {
  tipo: TipoDeRecorte;
  /** O que o chip diz, curto: "última sessão", "39 partidas oficiais". */
  rotulo: string;
  /** O que o `title` diz: a fonte inteira, para quem quiser conferir. */
  detalhe: string;
};

/** Nome da fonte, igual em toda a interface. */
export const FONTE: Record<TipoDeRecorte, string> = {
  sessao: "sessão",
  partidas: "partidas oficiais",
  demos: "demos",
  vitalicio: "vitalício Steam",
  periodo: "período",
  comunidade: "comunidade FragIQ",
};

const plural = (n: number, um: string, varios: string) => `${formatarNumero(n)} ${n === 1 ? um : varios}`;

export function recorteSessao(rounds: number, partidas: number | null): Recorte {
  return {
    tipo: "sessao",
    rotulo: "última sessão",
    detalhe: `Diferença entre duas coletas da Steam: ${plural(rounds, "round", "rounds")}${partidas ? ` em ${plural(partidas, "partida", "partidas")}` : ""}.`,
  };
}

export function recortePartidas(n: number): Recorte {
  return {
    tipo: "partidas",
    rotulo: plural(n, "partida oficial", "partidas oficiais"),
    detalhe: `Soma do placar dos dez, lido do Game Coordinator, em ${plural(n, "partida", "partidas")}.`,
  };
}

export function recorteDemos(n: number): Recorte {
  return {
    tipo: "demos",
    rotulo: plural(n, "demo", "demos"),
    detalhe: `Medido round a round nas demos de ${plural(n, "partida", "partidas")}.`,
  };
}

export function recorteVitalicio(): Recorte {
  return {
    tipo: "vitalicio",
    rotulo: FONTE.vitalicio,
    detalhe: "Os contadores da Steam desde a criação da conta, todos os modos somados.",
  };
}

export function recortePeriodo(dias: number, desde?: Date): Recorte {
  return {
    tipo: "periodo",
    rotulo: `${dias} dias`,
    detalhe: `As sessões que fecharam nos últimos ${dias} dias${desde ? `, desde ${formatarDia(desde)}` : ""}.`,
  };
}

/**
 * `nota` diz o corte quando o gráfico não usa todo mundo (uma distribuição
 * só conta quem tem amostra): o chip mostra sempre o N que o desenho usa.
 */
export function recorteComunidade(jogadores: number, partidas?: number, nota?: string): Recorte {
  return {
    tipo: "comunidade",
    rotulo: plural(jogadores, "jogador", "jogadores"),
    detalhe: `${nota ?? "Todos os jogadores com partida gravada no FragIQ"}${partidas ? `, em ${plural(partidas, "partida", "partidas")}` : ""}. Agregado, sem identificar ninguém.`,
  };
}
