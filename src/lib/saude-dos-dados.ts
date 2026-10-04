import { prisma } from "./prisma";

/**
 * O que terminou e ainda não apareceu para o jogador.
 *
 * Três pendências, cada uma com um prazo que o fluxo normal nunca passa:
 *
 * - **Partida sem sessão**: o GC devolveu a partida (ela está em
 *   `/partidas`), mas nenhuma sessão do jogador a contém 24 h depois do
 *   fim. A sessão nasce quando a Steam publica os totais, e para alguns
 *   jogadores isso só acontece quando o CS2 fecha (medido em 03/10/2026:
 *   todos os 13 pontos do merudox vieram logo depois de ele sair do jogo).
 *   24 h cobrem uma noite inteira com o jogo aberto. Partida anterior ao
 *   primeiro ponto do jogador não conta: antes dele não há série.
 * - **Análise sem resposta**: pergunta ao analista em aberto há mais de
 *   30 min (responde em segundos). Foi o sintoma do turno perdido de
 *   02/10/2026, que deslocou as análises de um jogador.
 * - **Captura vencida**: pedido de coleta que devia ter rodado há mais de
 *   1 h. O tick do bot ou o cron não está rodando.
 *
 * A rota `/api/cron/saude` publica as contagens como métricas (o alarme da
 * AWS olha para elas) e o `/admin` mostra as mesmas listas.
 */

export const PRAZO_PARTIDA_MS = 24 * 60 * 60_000;
export const PRAZO_ANALISE_MS = 30 * 60_000;
export const PRAZO_CAPTURA_MS = 60 * 60_000;
/** Até onde olhar para trás. O GC esquece a partida em ~30 dias; a sessão não muda depois de dias. */
export const JANELA_MS = 14 * 24 * 60 * 60_000;
/** A mesma folga de `evidenciasDe` (sessao/materializar.ts): a Steam demora a publicar. */
const FOLGA_SESSAO_MS = 10 * 60_000;

export type DadosDaSaude = {
  partidas: { id: string; jogadaEm: Date; duracaoS: number | null; userIds: string[] }[];
  sessoes: { userId: string; de: Date; ate: Date; matchIds: string[] }[];
  primeiroPonto: Map<string, Date>;
  analisesAbertas: { id: string; userId: string; createdAt: Date }[];
  capturas: { id: string; userId: string; proximaEm: Date }[];
};

export type Pendencias = {
  partidasSemSessao: { matchId: string; userId: string; fim: Date }[];
  analisesSemResposta: { id: string; userId: string; createdAt: Date }[];
  capturasVencidas: { id: string; userId: string; proximaEm: Date }[];
};

/** A regra, sem banco: o que está atrasado em `agora`. */
export function pendenciasDe(d: DadosDaSaude, agora: Date): Pendencias {
  const t = agora.getTime();
  const porUser = new Map<string, DadosDaSaude["sessoes"]>();
  for (const s of d.sessoes) porUser.set(s.userId, [...(porUser.get(s.userId) ?? []), s]);

  const partidasSemSessao: Pendencias["partidasSemSessao"] = [];
  for (const p of d.partidas) {
    const fim = p.jogadaEm.getTime() + (p.duracaoS ?? 0) * 1000;
    if (fim > t - PRAZO_PARTIDA_MS || fim < t - JANELA_MS) continue;
    for (const userId of p.userIds) {
      const primeiro = d.primeiroPonto.get(userId);
      if (!primeiro || fim <= primeiro.getTime()) continue;
      const coberta = (porUser.get(userId) ?? []).some(
        (s) => s.matchIds.includes(p.id) || (fim > s.de.getTime() - FOLGA_SESSAO_MS && fim <= s.ate.getTime()),
      );
      if (!coberta) partidasSemSessao.push({ matchId: p.id, userId, fim: new Date(fim) });
    }
  }

  return {
    partidasSemSessao,
    analisesSemResposta: d.analisesAbertas.filter(
      (a) => a.createdAt.getTime() <= t - PRAZO_ANALISE_MS && a.createdAt.getTime() >= t - JANELA_MS,
    ),
    capturasVencidas: d.capturas.filter((c) => c.proximaEm.getTime() <= t - PRAZO_CAPTURA_MS),
  };
}

const CS2_APPID = 730;

/** Lê o banco e aplica a regra. Seis consultas pequenas (a janela é de 14 dias). */
export async function medirPendencias(agora = new Date()): Promise<Pendencias> {
  const desde = new Date(agora.getTime() - JANELA_MS - PRAZO_PARTIDA_MS);
  const [partidas, analisesAbertas, capturas] = await Promise.all([
    prisma.match.findMany({
      where: { status: "DONE", jogadaEm: { gte: desde }, jogadores: { some: { userId: { not: null } } } },
      select: { id: true, jogadaEm: true, duracaoS: true, jogadores: { where: { userId: { not: null } }, select: { userId: true } } },
    }),
    prisma.analysis.findMany({
      where: { status: { in: ["PENDING", "ACKNOWLEDGED"] }, createdAt: { gte: desde } },
      select: { id: true, userId: true, createdAt: true },
    }),
    prisma.pendingCapture.findMany({ select: { id: true, userId: true, proximaEm: true } }),
  ]);
  const userIds = [...new Set(partidas.flatMap((p) => p.jogadores.map((j) => j.userId!)))];
  const [sessoes, userGames] = userIds.length
    ? await Promise.all([
        prisma.session.findMany({
          where: { userId: { in: userIds }, gameAppId: CS2_APPID, ate: { gte: desde } },
          select: { userId: true, de: true, ate: true, matchIds: true },
        }),
        prisma.userGame.findMany({ where: { userId: { in: userIds }, gameAppId: CS2_APPID }, select: { id: true, userId: true } }),
      ])
    : [[], []];
  const primeiros = userGames.length
    ? await prisma.statSnapshot.groupBy({
        by: ["userGameId"],
        where: { userGameId: { in: userGames.map((u) => u.id) } },
        _min: { capturedAt: true },
      })
    : [];
  const donoDoJogo = new Map(userGames.map((u) => [u.id, u.userId]));
  const primeiroPonto = new Map<string, Date>();
  for (const p of primeiros) {
    const userId = donoDoJogo.get(p.userGameId);
    if (userId && p._min.capturedAt) primeiroPonto.set(userId, p._min.capturedAt);
  }

  return pendenciasDe(
    {
      partidas: partidas
        .filter((p) => p.jogadaEm)
        .map((p) => ({ id: p.id, jogadaEm: p.jogadaEm!, duracaoS: p.duracaoS, userIds: p.jogadores.map((j) => j.userId!) })),
      sessoes,
      primeiroPonto,
      analisesAbertas,
      capturas,
    },
    agora,
  );
}

/**
 * A linha de log que vira métrica no CloudWatch (Embedded Metric Format):
 * a Lambda do site escreve no stdout, o CloudWatch extrai `FragIQ/*` sem
 * chamada de API nem permissão a mais.
 */
export function linhaDeMetricas(p: Pendencias, agora: Date): string {
  return JSON.stringify({
    _aws: {
      Timestamp: agora.getTime(),
      CloudWatchMetrics: [
        {
          Namespace: "FragIQ",
          Dimensions: [[]],
          Metrics: [
            { Name: "PartidasSemSessao", Unit: "Count" },
            { Name: "AnalisesSemResposta", Unit: "Count" },
            { Name: "CapturasVencidas", Unit: "Count" },
          ],
        },
      ],
    },
    PartidasSemSessao: p.partidasSemSessao.length,
    AnalisesSemResposta: p.analisesSemResposta.length,
    CapturasVencidas: p.capturasVencidas.length,
  });
}
