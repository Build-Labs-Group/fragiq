import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { carregarFonte } from "@/lib/fonte";
import { lerSerie } from "@/lib/leituras";
import { normaisDoHero, ultimaSessao } from "@/lib/sessoes";
import { CS2_PANEL } from "@/lib/cs2-panel";
import { SessaoHero } from "@/components/sessao-hero";
import { StatPanel } from "@/components/stat-panel";
import { PorModo } from "@/components/por-modo";
import { PrimeirosPassos, TudoPronto } from "@/components/primeiros-passos";
import { Secao } from "@/components/secao";
import { SemDados } from "@/components/sem-dados";
import { Estado } from "@/components/estado";
import { botEhAmigo } from "@/lib/bot";
import { prisma } from "@/lib/prisma";
import { filtroDoModo, rotuloDoModo, TUDO } from "@/lib/modo";
import { abasDoUsuario, modoDaRequisicao, type SearchParams } from "@/lib/modo-servidor";
import { insightsDaUltimaSessao, insightsDoModo } from "@/lib/insights/ler";
import { Insight } from "@/components/insight";
import { formatarQuando } from "@/lib/sessoes";

export const dynamic = "force-dynamic";

/**
 * Resumo: "como foi, e o que fazer na próxima" em uma dobra e meia.
 *
 * Ordem de leitura: o que falta (só enquanto faltar) → a última sessão em
 * três números → os insights (uma linha e um desenho cada, lidos do banco)
 * → seis cartões → os modos lado a lado. A lente vale para tudo: a última
 * sessão é a última DAQUELE modo, e o normal é o do modo quando há base.
 * A análise em prosa saiu daqui em 17/09 (docs/dados-confiaveis.md §3.5):
 * vive em /analista, para quem quiser perguntar; a tela principal não tem
 * texto de mais de uma linha.
 */
export default async function ResumoPage({ params, searchParams }: { params: Promise<{ appId: string }>; searchParams: SearchParams }) {
  const session = await requireSession();
  const appId = Number((await params).appId);

  const fonte = await carregarFonte(session.userId, appId);
  if (!fonte) {
    if (appId !== 730) notFound();
    return <SemDados botAmigo={await botEhAmigo(session.steamId)} />;
  }
  const { rows } = fonte;
  const modo = await modoDaRequisicao(searchParams, await abasDoUsuario(session.userId, appId));
  const lente = filtroDoModo(modo)?.mode ?? null;

  const sessao = ultimaSessao(rows, filtroDoModo(modo));
  const amigoDoBot = appId === 730 ? await botEhAmigo(session.steamId) : true;
  const portas =
    appId === 730 ? await prisma.user.findUnique({ where: { id: session.userId }, select: { partidasAtivadasEm: true, partidasErro: true, botAmigoDesde: true } }) : null;
  // Ligada e andando: uma corrente que a Steam parou de aceitar não é um
  // passo feito, é um passo para refazer.
  const partidasParadas = appId === 730 && Boolean(portas?.partidasAtivadasEm && portas.partidasErro);
  const partidasAtivas = appId === 730 ? Boolean(portas?.partidasAtivadasEm) && !partidasParadas : true;
  const onboarding = appId === 730 && (rows.length < 2 || amigoDoBot !== true || !partidasAtivas);
  // A lista some quando fica toda verde; sem isto, o último passo feito
  // não tem recompensa nenhuma — a pessoa nunca vê o "5 de 5". O cartão
  // fica alguns dias depois da última porta aberta e depois some sozinho.
  const ultimaPorta = Math.max(portas?.partidasAtivadasEm?.getTime() ?? 0, portas?.botAmigoDesde?.getTime() ?? 0);
  const recemConcluido = appId === 730 && !onboarding && Date.now() - ultimaPorta < 3 * 86_400_000;
  const notas = lerSerie(rows, filtroDoModo(modo)).filter((l) => l.id === "amostra" || l.id === "mapas");
  const [daSessao, doModo] =
    appId === 730 ? await Promise.all([insightsDaUltimaSessao(session.userId, lente), insightsDoModo(session.userId, lente)]) : [null, []];

  return (
    <>
      {onboarding && (
        <div className="mb-8">
          <PrimeirosPassos statsVisiveis botAmigo={amigoDoBot} coletas={rows.length} partidasAtivas={partidasAtivas} partidasParadas={partidasParadas} />
        </div>
      )}
      {recemConcluido && (
        <div className="mb-8">
          <TudoPronto />
        </div>
      )}

      {sessao ? (
        <SessaoHero sessao={sessao} normais={normaisDoHero(rows, { modo: lente }, sessao.snapshotId)} notas={notas} lente={lente} />
      ) : modo !== TUDO ? (
        <Estado titulo={`Sem sessões de ${rotuloDoModo(modo)}`} texto="A próxima partida nesse modo aparece aqui." acao={{ rotulo: "Ver tudo", href: `/games/${appId}` }} />
      ) : rows.length === 1 ? (
        <Estado titulo="Ponto de partida guardado" texto="Jogue uma partida de CS2: quando ela terminar, a primeira sessão aparece aqui com o que mudou." />
      ) : null}

      {(daSessao || doModo.length > 0) && (
        <Secao titulo="Insights">
          <div className="grid gap-2 md:grid-cols-2">
            {daSessao && (
              <div className="space-y-2">
                <p className="hud text-xs text-ink-faint" suppressHydrationWarning>última sessão · {formatarQuando(daSessao.ate)}</p>
                {daSessao.insights.map((i) => <Insight key={i.id} insight={i} />)}
              </div>
            )}
            {doModo.length > 0 && (
              <div className="space-y-2">
                <p className="hud text-xs text-ink-faint">{lente ? rotuloDoModo(modo) : "tudo"} · forma e tendência</p>
                {doModo.map((i) => <Insight key={i.id} insight={i} />)}
              </div>
            )}
          </div>
        </Secao>
      )}


      {appId === 730 && (
        <Secao titulo="Estatísticas" href={`/games/${appId}/estatisticas`} acao="todas">
          <StatPanel stats={CS2_PANEL} snapshots={rows} lente={lente} appId={appId} limite={6} />
        </Secao>
      )}

      {appId === 730 && <PorModo rows={rows} lente={lente} base={`/games/${appId}`} />}
    </>
  );
}
