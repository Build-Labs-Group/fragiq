import { prisma } from "./prisma";
import { REGRAS_EM_VIGOR } from "./insights/regras";
import { medirPendencias } from "./saude-dos-dados";
import { REGRA_VERSAO } from "./sessao/atribuir";
import type { FontesDeIndicadores } from "./indicadores-painel";

/**
 * As fontes de produção dos indicadores do painel (`indicadores-painel.ts`).
 *
 * Só leitura e só agregados: cada função devolve contagens e idades, nunca
 * uma linha com SteamID, nome ou texto. As tabelas são pequenas (dezenas de
 * jogadores, milhares de linhas), e as janelas de 24 h a 30 dias seguem os
 * índices que existem (`status, createdAt`, `nivel, em`, `proximaEm`); onde
 * o filtro é por coluna sem índice próprio (`captured_at`, `sessions.createdAt`)
 * a varredura é de uma tabela que cabe numa página de índice.
 */

const H = 3_600_000;
const DIA = 24 * H;

export function fontesDoBanco(): FontesDeIndicadores {
  return {
    async pendencias(agora) {
      const p = await medirPendencias(agora);
      const fins = p.partidasSemSessao.map((x) => x.fim.getTime());
      return {
        // Uma partida com dois jogadores sem sessão conta uma vez: o que importa é quantas partidas.
        partidasSemSessao: new Set(p.partidasSemSessao.map((x) => x.matchId)).size,
        partidaMaisAntigaMs: fins.length ? agora.getTime() - Math.min(...fins) : null,
        analisesSemResposta: p.analisesSemResposta.length,
        capturasVencidas: p.capturasVencidas.length,
      };
    },

    async bot(agora) {
      const s = await prisma.botStatus.findUnique({
        where: { id: "bot" },
        select: { ultimoTickEm: true, logado: true, desconectadoDesde: true },
      });
      if (!s) return null;
      return {
        tickHaMs: Math.max(0, agora.getTime() - s.ultimoTickEm.getTime()),
        logado: s.logado,
        desconectadoDesde: s.desconectadoDesde,
        ultimoTickEm: s.ultimoTickEm,
      };
    },

    async coletaHaH(agora) {
      const ultima = await prisma.cronRun.findFirst({ orderBy: { startedAt: "desc" }, select: { startedAt: true } });
      return ultima ? Math.max(0, agora.getTime() - ultima.startedAt.getTime()) / H : null;
    },

    async uso(agora) {
      const dia = new Date(agora.getTime() - DIA);
      const semana = new Date(agora.getTime() - 7 * DIA);
      const [usuarios, novos7d, snapshots24h, partidas24h, sessoes24h] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { createdAt: { gte: semana } } }),
        prisma.statSnapshot.count({ where: { capturedAt: { gte: dia } } }),
        prisma.match.count({ where: { status: "DONE", createdAt: { gte: dia } } }),
        prisma.session.count({ where: { createdAt: { gte: dia } } }),
      ]);
      return { usuarios, novos7d, snapshots24h, partidas24h, sessoes24h };
    },

    async integridade(agora) {
      const trinta = new Date(agora.getTime() - 30 * DIA);
      const umDia = new Date(agora.getTime() - DIA);
      const seteDias = new Date(agora.getTime() - 7 * DIA);
      const [sessoes, insights, orfas, semPonto] = await Promise.all([
        prisma.session.count({ where: { gameAppId: 730, regraVersao: { not: REGRA_VERSAO } } }),
        prisma.insight.groupBy({ by: ["regra", "escopo", "regraVersao"], where: { gameAppId: 730 }, _count: { _all: true } }),
        prisma.$queryRaw<{ n: bigint }[]>`
          SELECT count(*)::bigint AS n
            FROM sessions s
           CROSS JOIN LATERAL unnest(s."matchIds") AS m(id)
           WHERE s.ate >= ${trinta}
             AND NOT EXISTS (SELECT 1 FROM matches x WHERE x.id = m.id)`,
        prisma.$queryRaw<{ n: bigint }[]>`
          SELECT count(*)::bigint AS n
            FROM bot_observations o
           WHERE o.kind = 'MATCH_ENDED'
             AND o."userId" IS NOT NULL
             AND o."observedAt" >= ${seteDias}
             AND o."observedAt" < ${umDia}
             AND NOT EXISTS (SELECT 1 FROM stat_snapshots st WHERE st."traceId" = o."traceId")`,
      ]);
      const atrasados = insights.filter((i) =>
        REGRAS_EM_VIGOR.some((r) => r.regra === i.regra && r.escopo === i.escopo && r.versao !== i.regraVersao),
      );
      return {
        sessoesComRegraAtrasada: sessoes,
        insightsComRegraAtrasada: atrasados.reduce((a, i) => a + i._count._all, 0),
        sessoesComPartidaInexistente: Number(orfas[0]?.n),
        observacoesSemPonto: Number(semPonto[0]?.n),
      };
    },

    async filas(agora) {
      const dia = new Date(agora.getTime() - DIA);
      const [botErros24h, mensagensSteamFalhas24h, partidasGcPendentes] = await Promise.all([
        prisma.botLog.count({ where: { nivel: "ERROR", em: { gte: dia } } }),
        prisma.steamMessage.count({ where: { status: "FAILED", createdAt: { gte: dia } } }),
        prisma.match.count({ where: { status: "PENDING", createdAt: { lt: dia } } }),
      ]);
      return { botErros24h, mensagensSteamFalhas24h, partidasGcPendentes };
    },
  };
}
