/**
 * Indicadores do FragIQ para o painel da Build Labs: `GET /api/buildlabs/indicadores`
 * com `Authorization: Bearer <token>`. O contrato (esquema zod) fica no
 * projeto `painel`: `docs/contratos/manifesto-e-indicadores.md`; a decisão é
 * a ADR 0006 da empresa. O que cada número significa está em
 * `docs/indicadores-painel.md`.
 *
 * Regras que este módulo cumpre:
 *  - só números agregados: nada de SteamID, nome, e-mail nem texto de
 *    jogador (LGPD). As fontes devolvem contagens e idades, nunca linhas;
 *  - cada indicador diz de onde vem (`origem`) e o nível é decidido aqui;
 *  - só leitura, consultas pequenas e em paralelo, cada fonte com limite de
 *    tempo;
 *  - fonte que falha vira `valor: null` com o motivo em `detalhe`; nunca um
 *    zero inventado.
 *
 * Este arquivo não conhece o banco: recebe as fontes pelo construtor
 * (`indicadores-fonte.ts` tem as de produção), por isso os testes rodam sem
 * rede, sem AWS e sem Postgres.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { estadoDoBot, haQuanto, type EstadoDoBot } from "./saude-do-bot";

export const PROJETO = "fragiq";

/** Passado isto sem coleta diária o agendador está quebrado (o mesmo limite do `/api/health`). */
export const COLETA_VENCE_EM_H = 26;
/** Erros do bot nas últimas 24 h a partir dos quais o indicador pede atenção. */
export const ERROS_DO_BOT_ATENCAO = 10;
/** Mensagens da Steam que falharam na entrega em 24 h a partir das quais o indicador pede atenção. */
export const MENSAGENS_FALHAS_ATENCAO = 5;

export type Nivel = "ok" | "info" | "atencao" | "critico";
type Periodo = "agora" | "24h" | "7d" | "30d" | "mes";

export interface Indicador {
  id: string;
  rotulo: string;
  valor: number | null;
  unidade?: string;
  periodo?: Periodo;
  nivel: Nivel;
  detalhe?: string;
  origem: string;
}

export interface Aviso {
  nivel: "atencao" | "critico";
  titulo: string;
  detalhe?: string;
  desde?: string;
}

export interface Resposta {
  versao: 1;
  projeto: typeof PROJETO;
  geradoEm: string;
  indicadores: Indicador[];
  avisos: Aviso[];
}

/** Pendências de `saude-dos-dados.ts`, já contadas. A idade vem em ms, sem identificar ninguém. */
export interface ContagemDePendencias {
  partidasSemSessao: number;
  /** Há quanto tempo terminou a mais antiga (ms), para o detalhe. */
  partidaMaisAntigaMs: number | null;
  analisesSemResposta: number;
  capturasVencidas: number;
}

export interface SinalDoBot {
  tickHaMs: number;
  logado: boolean;
  /** Desde quando a Steam derrubou o bot (para o aviso). */
  desconectadoDesde: Date | null;
  ultimoTickEm: Date;
}

export interface ContagemDeUso {
  usuarios: number;
  novos7d: number;
  snapshots24h: number;
  partidas24h: number;
  sessoes24h: number;
}

export interface ContagemDeIntegridade {
  /** Sessões cuja `regraVersao` não é a em vigor (derivação desatualizada). */
  sessoesComRegraAtrasada: number;
  /** Insights cuja `regraVersao` não é a em vigor para a regra. */
  insightsComRegraAtrasada: number;
  /** Sessões dos últimos 30 dias que apontam (`matchIds`) para partida que não existe. */
  sessoesComPartidaInexistente: number;
  /** `MATCH_ENDED` de jogador do site, de 1 a 7 dias atrás, sem snapshot com o mesmo `traceId`. */
  observacoesSemPonto: number;
}

export interface ContagemDeFilas {
  botErros24h: number;
  mensagensSteamFalhas24h: number;
  /** Partidas do GC em `PENDING` há mais de 24 h: o bot não buscou o scoreboard. */
  partidasGcPendentes: number;
}

export interface FontesDeIndicadores {
  pendencias: (agora: Date) => Promise<ContagemDePendencias>;
  /** `null`: o bot nunca bateu o tick. */
  bot: (agora: Date) => Promise<SinalDoBot | null>;
  /** Há quantas horas começou a última coleta diária; `null` sem nenhuma registrada. */
  coletaHaH: (agora: Date) => Promise<number | null>;
  uso: (agora: Date) => Promise<ContagemDeUso>;
  integridade: (agora: Date) => Promise<ContagemDeIntegridade>;
  filas: (agora: Date) => Promise<ContagemDeFilas>;
}

export interface DependenciasDeIndicadores {
  fontes: FontesDeIndicadores;
  /** Só nome da fonte e mensagem do erro; nunca dado do banco. */
  log: (mensagem: string, dados?: Record<string, unknown>) => void;
  agora?: () => Date;
  /** Limite de cada fonte, em ms (o painel corta em 12 s). */
  limiteMs?: number;
}

/** Confere o `Authorization: Bearer` sem vazar, pelo tempo, quantos bytes batem. */
export function tokenConfere(esperado: string, cabecalho: string | null | undefined): boolean {
  const enviado = cabecalho?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!enviado) return false;
  // Hash dos dois: tamanho fixo, então `timingSafeEqual` nunca recusa por tamanho.
  const hash = (texto: string) => createHash("sha256").update(texto, "utf8").digest();
  return timingSafeEqual(hash(esperado), hash(enviado));
}

type Leitura<T> = { ok: true; dado: T } | { ok: false; motivo: string };

/** Resolve a fonte ou, passado o limite, devolve o motivo de ela não ter respondido. */
async function lerFonte<T>(
  nome: string,
  fonte: () => Promise<T>,
  limiteMs: number,
  log: DependenciasDeIndicadores["log"],
): Promise<Leitura<T>> {
  let relogio: ReturnType<typeof setTimeout> | undefined;
  try {
    const dado = await Promise.race([
      fonte().then((d) => {
        conferirContagens(d);
        return d;
      }),
      new Promise<never>((_, rejeitar) => {
        relogio = setTimeout(() => rejeitar(new Error("limite de tempo")), limiteMs);
      }),
    ]);
    return { ok: true, dado };
  } catch (erro) {
    const demorou = (erro as Error).message === "limite de tempo";
    // O motivo detalhado fica só no log: a resposta leva uma frase sem dado do banco.
    log("indicadores: fonte falhou", { fonte: nome, erro: (erro as Error).message });
    return {
      ok: false,
      motivo: demorou ? `${nome} demorou mais de ${Math.round(limiteMs / 1000)} s` : `${nome} indisponível`,
    };
  } finally {
    clearTimeout(relogio);
  }
}

/**
 * Toda contagem que a fonte devolve tem de ser número finito e não negativo;
 * do contrário a fonte inteira conta como falha (`valor: null`), nunca um
 * zero inventado. Datas, booleanos e `null` passam.
 */
function conferirContagens(dado: unknown): void {
  if (dado === null || typeof dado !== "object") return;
  for (const v of Object.values(dado)) {
    if (typeof v === "number" && (!Number.isFinite(v) || v < 0)) throw new Error("contagem inválida");
  }
}

const horas = (ms: number) =>
  ms < 3_600_000 ? `${Math.max(1, Math.round(ms / 60_000))} min` : `${Math.round(ms / 3_600_000)} h`;

const plural = (n: number, um: string, varios: string) => (n === 1 ? um : varios);

export function criarIndicadores(deps: DependenciasDeIndicadores) {
  const agora = deps.agora ?? (() => new Date());
  const limiteMs = deps.limiteMs ?? 9_000;

  async function medir(): Promise<Resposta> {
    const t0 = agora();
    const ler = <T>(nome: string, f: (a: Date) => Promise<T>) => lerFonte(nome, () => f(t0), limiteMs, deps.log);
    const [pendencias, bot, coleta, uso, integridade, filas] = await Promise.all([
      ler("banco (pendências)", deps.fontes.pendencias),
      ler("banco (bot)", deps.fontes.bot),
      ler("banco (coleta diária)", deps.fontes.coletaHaH),
      ler("banco (uso)", deps.fontes.uso),
      ler("banco (integridade)", deps.fontes.integridade),
      ler("banco (filas)", deps.fontes.filas),
    ]);

    const indicadores: Indicador[] = [];
    const avisos: Aviso[] = [];

    /** Fonte que falhou: um indicador `null` por id, com o motivo, para o painel não ficar sem o número sem saber por quê. */
    const semMedir = (
      id: string,
      rotulo: string,
      origem: string,
      motivo: string,
      extra: Pick<Indicador, "unidade" | "periodo"> = {},
    ): Indicador => ({ id, rotulo, valor: null, ...extra, nivel: "info", detalhe: motivo, origem });

    // ---- Pendências (a mesma regra dos alarmes da AWS, `saude-dos-dados.ts`) ----
    const ORIGEM_PEND = "saude-dos-dados.ts, 14 dias";
    if (pendencias.ok) {
      const p = pendencias.dado;
      indicadores.push(
        {
          id: "partidas_sem_sessao",
          rotulo: "Partidas sem sessão (+24 h)",
          valor: p.partidasSemSessao,
          unidade: "partidas",
          periodo: "agora",
          // O jogador joga e a partida não aparece na série dele: dado que a Steam não devolve depois.
          nivel: p.partidasSemSessao > 0 ? "critico" : "ok",
          detalhe:
            p.partidasSemSessao > 0 && p.partidaMaisAntigaMs !== null
              ? `a mais antiga terminou há ${horas(p.partidaMaisAntigaMs)}`
              : "toda partida do GC com mais de 24 h está numa sessão",
          origem: `matches DONE de usuário do site, fim há +24 h, fora de toda sessions (${ORIGEM_PEND})`,
        },
        {
          id: "analises_sem_resposta",
          rotulo: "Análises sem resposta (+30 min)",
          valor: p.analisesSemResposta,
          unidade: "análises",
          periodo: "agora",
          nivel: p.analisesSemResposta > 0 ? "atencao" : "ok",
          detalhe: "pergunta ao analista (cogniflow) em PENDING ou ACKNOWLEDGED há mais de 30 min",
          origem: `analyses PENDING/ACKNOWLEDGED há +30 min (${ORIGEM_PEND})`,
        },
        {
          id: "capturas_vencidas",
          rotulo: "Capturas vencidas (+1 h)",
          valor: p.capturasVencidas,
          unidade: "capturas",
          periodo: "agora",
          // Captura parada é o tick do bot ou o cron fora do ar: dado que se perde.
          nivel: p.capturasVencidas > 0 ? "critico" : "ok",
          detalhe: "pedido de coleta que devia ter rodado há mais de 1 h",
          origem: `pending_captures com proxima_em há +1 h (${ORIGEM_PEND})`,
        },
      );
    } else {
      const o = "pending_captures, matches, sessions, analyses";
      indicadores.push(
        semMedir("partidas_sem_sessao", "Partidas sem sessão (+24 h)", o, pendencias.motivo, { unidade: "partidas", periodo: "agora" }),
        semMedir("analises_sem_resposta", "Análises sem resposta (+30 min)", o, pendencias.motivo, { unidade: "análises", periodo: "agora" }),
        semMedir("capturas_vencidas", "Capturas vencidas (+1 h)", o, pendencias.motivo, { unidade: "capturas", periodo: "agora" }),
      );
    }

    // ---- Bot (bot_status) -------------------------------------------------------
    const ORIGEM_BOT = "bot_status.ultimo_tick_em (estadoDoBot em saude-do-bot.ts)";
    if (bot.ok) {
      const s = bot.dado;
      const estado: EstadoDoBot = estadoDoBot(s ? { tickHaMs: s.tickHaMs, logado: s.logado } : null);
      const nivel: Nivel = estado === "parado" ? "critico" : estado === "deslogado" || estado === "nunca" ? "atencao" : "ok";
      const texto: Record<EstadoDoBot, string> = {
        vivo: "bot vivo",
        repouso: "bot em repouso (turno de 30 min)",
        deslogado: "bot no ar mas sem sessão na Steam",
        parado: "bot sem tick além do turno de repouso",
        nunca: "o bot nunca bateu o tick",
      };
      indicadores.push({
        id: "bot_ultimo_tick_min",
        rotulo: "Último sinal do bot",
        valor: s ? Math.round(s.tickHaMs / 60_000) : null,
        unidade: "min",
        periodo: "agora",
        nivel,
        detalhe: s ? `${texto[estado]}; tick ${haQuanto(s.tickHaMs)}` : texto[estado],
        origem: ORIGEM_BOT,
      });
      if (s && estado === "parado") {
        avisos.push({
          nivel: "critico",
          titulo: `Bot sem tick há ${horas(s.tickHaMs)}`,
          detalhe: "O host compartilhado ou o container fragiq-bot não está batendo o tick.",
          desde: s.ultimoTickEm.toISOString(),
        });
      } else if (s && estado === "deslogado") {
        avisos.push({
          nivel: "atencao",
          titulo: "Bot sem sessão na Steam",
          ...(s.desconectadoDesde ? { desde: s.desconectadoDesde.toISOString() } : {}),
        });
      }
    } else {
      indicadores.push(semMedir("bot_ultimo_tick_min", "Último sinal do bot", ORIGEM_BOT, bot.motivo, { unidade: "min", periodo: "agora" }));
    }

    // ---- Coleta diária (cron_runs) ----------------------------------------------
    const ORIGEM_COLETA = "cron_runs.started_at mais recente (a mesma regra do /api/health)";
    if (coleta.ok) {
      const h = coleta.dado;
      if (h === null) {
        indicadores.push({
          id: "coleta_diaria_idade_h",
          rotulo: "Última coleta diária",
          valor: null,
          unidade: "h",
          periodo: "agora",
          nivel: "info",
          detalhe: "nenhuma coleta registrada em cron_runs (projeto recém-implantado?)",
          origem: ORIGEM_COLETA,
        });
      } else {
        const vencida = h > COLETA_VENCE_EM_H;
        indicadores.push({
          id: "coleta_diaria_idade_h",
          rotulo: "Última coleta diária",
          valor: Math.round(h * 10) / 10,
          unidade: "h",
          periodo: "agora",
          nivel: vencida ? "critico" : "ok",
          detalhe: vencida ? `agendador parado: o limite é ${COLETA_VENCE_EM_H} h` : `dentro do limite de ${COLETA_VENCE_EM_H} h`,
          origem: ORIGEM_COLETA,
        });
        if (vencida) {
          avisos.push({
            nivel: "critico",
            titulo: `Coleta diária parada há ${Math.round(h)} h`,
            detalhe: "A Steam só sabe o total de hoje: coleta perdida não se recupera.",
            desde: new Date(t0.getTime() - h * 3_600_000).toISOString(),
          });
        }
      }
    } else {
      indicadores.push(semMedir("coleta_diaria_idade_h", "Última coleta diária", ORIGEM_COLETA, coleta.motivo, { unidade: "h", periodo: "agora" }));
    }

    // ---- Integridade dos dados --------------------------------------------------
    const ORIGEM_INT = "sessions, insights, matches, bot_observations e stat_snapshots";
    if (integridade.ok) {
      const i = integridade.dado;
      indicadores.push(
        {
          id: "sessoes_regra_atrasada",
          rotulo: "Sessões com regra desatualizada",
          valor: i.sessoesComRegraAtrasada,
          unidade: "sessões",
          periodo: "agora",
          nivel: i.sessoesComRegraAtrasada > 0 ? "atencao" : "ok",
          detalhe: "derivação com regraVersao diferente da em vigor; npm run recompute:sessions refaz",
          origem: "sessions.regra_versao diferente de REGRA_VERSAO (sessao/atribuir.ts)",
        },
        {
          id: "insights_regra_atrasada",
          rotulo: "Insights com regra desatualizada",
          valor: i.insightsComRegraAtrasada,
          unidade: "insights",
          periodo: "agora",
          nivel: i.insightsComRegraAtrasada > 0 ? "atencao" : "ok",
          detalhe: "insight de uma versão que não é a em vigor da regra (insights/regras.ts)",
          origem: "insights.regra_versao diferente de REGRAS_EM_VIGOR, por regra e escopo",
        },
        {
          id: "sessoes_partida_inexistente",
          rotulo: "Sessões que citam partida inexistente",
          valor: i.sessoesComPartidaInexistente,
          unidade: "referências",
          periodo: "30d",
          // A prova da sessão aponta para o vazio: a atribuição de modo não é reproduzível.
          nivel: i.sessoesComPartidaInexistente > 0 ? "critico" : "ok",
          detalhe: "sessions.matchIds com id que não está em matches",
          origem: "sessions (ate nos últimos 30 dias) sem matches.id para cada item de matchIds",
        },
        {
          id: "observacoes_sem_ponto",
          rotulo: "Fins de partida observados sem ponto",
          valor: i.observacoesSemPonto,
          unidade: "observações",
          periodo: "7d",
          // Só informa: a captura desiste de propósito (detalhes do jogo privados) e a sessão cobre o resto.
          nivel: "info",
          detalhe: "inclui captura desistida (estatísticas privadas); o efeito no jogador está em partidas_sem_sessao",
          origem: `bot_observations MATCH_ENDED de 1 a 7 dias, sem stat_snapshots com o mesmo trace_id`,
        },
      );
    } else {
      const sem = (id: string, rotulo: string, unidade: string, periodo: Periodo) =>
        semMedir(id, rotulo, ORIGEM_INT, integridade.motivo, { unidade, periodo });
      indicadores.push(
        sem("sessoes_regra_atrasada", "Sessões com regra desatualizada", "sessões", "agora"),
        sem("insights_regra_atrasada", "Insights com regra desatualizada", "insights", "agora"),
        sem("sessoes_partida_inexistente", "Sessões que citam partida inexistente", "referências", "30d"),
        sem("observacoes_sem_ponto", "Fins de partida observados sem ponto", "observações", "7d"),
      );
    }

    // ---- Filas e erros ----------------------------------------------------------
    if (filas.ok) {
      const f = filas.dado;
      indicadores.push(
        {
          id: "bot_erros_24h",
          rotulo: "Erros do bot",
          valor: f.botErros24h,
          unidade: "erros",
          periodo: "24h",
          nivel: f.botErros24h === 0 ? "ok" : f.botErros24h >= ERROS_DO_BOT_ATENCAO ? "atencao" : "info",
          detalhe: `atenção a partir de ${ERROS_DO_BOT_ATENCAO}; a lista está em /admin`,
          origem: "bot_logs com nivel ERROR e em nas últimas 24 h",
        },
        {
          id: "mensagens_steam_falhas_24h",
          rotulo: "Mensagens da Steam que falharam",
          valor: f.mensagensSteamFalhas24h,
          unidade: "mensagens",
          periodo: "24h",
          nivel:
            f.mensagensSteamFalhas24h === 0 ? "ok" : f.mensagensSteamFalhas24h >= MENSAGENS_FALHAS_ATENCAO ? "atencao" : "info",
          detalhe: `atenção a partir de ${MENSAGENS_FALHAS_ATENCAO}`,
          origem: "steam_messages com status FAILED criadas nas últimas 24 h",
        },
        {
          id: "partidas_gc_pendentes",
          rotulo: "Partidas do GC sem scoreboard (+24 h)",
          valor: f.partidasGcPendentes,
          unidade: "partidas",
          periodo: "agora",
          nivel: f.partidasGcPendentes > 0 ? "atencao" : "ok",
          detalhe: `${f.partidasGcPendentes} ${plural(f.partidasGcPendentes, "partida conhecida", "partidas conhecidas")} que o bot ainda não buscou`,
          origem: "matches com status PENDING criadas há mais de 24 h",
        },
      );
    } else {
      const o = "bot_logs, steam_messages e matches";
      indicadores.push(
        semMedir("bot_erros_24h", "Erros do bot", o, filas.motivo, { unidade: "erros", periodo: "24h" }),
        semMedir("mensagens_steam_falhas_24h", "Mensagens da Steam que falharam", o, filas.motivo, { unidade: "mensagens", periodo: "24h" }),
        semMedir("partidas_gc_pendentes", "Partidas do GC sem scoreboard (+24 h)", o, filas.motivo, { unidade: "partidas", periodo: "agora" }),
      );
    }

    // ---- Uso do produto ---------------------------------------------------------
    if (uso.ok) {
      const u = uso.dado;
      indicadores.push(
        {
          id: "usuarios_total",
          rotulo: "Jogadores cadastrados",
          valor: u.usuarios,
          unidade: "jogadores",
          periodo: "agora",
          nivel: "info",
          detalhe: `${u.novos7d} ${plural(u.novos7d, "novo", "novos")} nos últimos 7 dias`,
          origem: "users (contagem)",
        },
        {
          id: "snapshots_24h",
          rotulo: "Pontos da série gravados",
          valor: u.snapshots24h,
          unidade: "pontos",
          periodo: "24h",
          nivel: "info",
          origem: "stat_snapshots com captured_at nas últimas 24 h",
        },
        {
          id: "partidas_24h",
          rotulo: "Partidas do GC gravadas",
          valor: u.partidas24h,
          unidade: "partidas",
          periodo: "24h",
          nivel: "info",
          origem: "matches DONE criadas nas últimas 24 h",
        },
        {
          id: "sessoes_24h",
          rotulo: "Sessões fechadas",
          valor: u.sessoes24h,
          unidade: "sessões",
          periodo: "24h",
          nivel: "info",
          origem: "sessions com created_at nas últimas 24 h",
        },
      );
    } else {
      const o = "users, stat_snapshots, matches e sessions";
      indicadores.push(
        semMedir("usuarios_total", "Jogadores cadastrados", o, uso.motivo, { unidade: "jogadores", periodo: "agora" }),
        semMedir("snapshots_24h", "Pontos da série gravados", o, uso.motivo, { unidade: "pontos", periodo: "24h" }),
        semMedir("partidas_24h", "Partidas do GC gravadas", o, uso.motivo, { unidade: "partidas", periodo: "24h" }),
        semMedir("sessoes_24h", "Sessões fechadas", o, uso.motivo, { unidade: "sessões", periodo: "24h" }),
      );
    }

    return { versao: 1, projeto: PROJETO, geradoEm: t0.toISOString(), indicadores, avisos };
  }

  return { medir };
}
