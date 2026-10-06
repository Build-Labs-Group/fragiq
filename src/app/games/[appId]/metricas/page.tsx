import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { carregarFonte } from "@/lib/fonte";
import { todasAsMetricas } from "@/lib/leituras";
import { MetricTable } from "@/components/metric-table";
import { MetricasDestaque } from "@/components/metricas-destaque";
import { deltaEntre, gaugesLookStale, ultimoPar } from "@/lib/series";
import { filtroDoModo, rotuloDoModo, TUDO } from "@/lib/modo";
import { abasDoUsuario, modoDaRequisicao, type SearchParams } from "@/lib/modo-servidor";
import { separarMetricas } from "@/lib/metricas-tela";
import { recorteSessao } from "@/lib/recortes";
import { RecorteChip } from "@/components/graficos/recorte";
import { Secao } from "@/components/secao";
import { Estado } from "@/components/estado";

export const dynamic = "force-dynamic";

/**
 * Todos os contadores da Steam, comparados com o normal, em duas partes
 * (`lib/metricas-tela.ts`): no topo, em cartões, o que mais fugiu do normal
 * na última sessão da lente; embaixo, o resto numa grade fixa com rolagem,
 * busca e filtro por grupo.
 */
export default async function MetricasPage({ params, searchParams }: { params: Promise<{ appId: string }>; searchParams: SearchParams }) {
  const session = await requireSession();
  const appId = Number((await params).appId);
  const fonte = await carregarFonte(session.userId, appId);
  if (!fonte) notFound();
  const modo = await modoDaRequisicao(searchParams, await abasDoUsuario(session.userId, appId));
  const filtro = filtroDoModo(modo);

  const linhas = todasAsMetricas(fonte.rows, fonte.catalog.map((c) => c.key), filtro);
  const par = ultimoPar(fonte.rows, "total_rounds_played", filtro);
  const rounds = par ? (deltaEntre(par, "total_rounds_played") ?? 0) : 0;
  const partidas = par ? deltaEntre(par, "total_matches_played") : null;
  const { destaques, resto, congeladas } = separarMetricas(linhas, rounds);

  return (
    <div>
      <Secao titulo="O que mais mudou">
        <div className="-mt-1 mb-3 flex flex-wrap items-center gap-2">
          {par && <RecorteChip recorte={recorteSessao(rounds, partidas)} />}
          <span className="text-xs text-ink-faint">
            contra o {modo === TUDO ? "vitalício" : `normal do ${rotuloDoModo(modo)}`} · por round
          </span>
        </div>
        {destaques.length > 0 ? (
          <MetricasDestaque metricas={destaques} appId={appId} />
        ) : (
          <Estado
            compacto
            titulo={par ? "Nada fora do normal" : "Nenhuma sessão ainda"}
            texto={par ? "Nenhum contador fugiu do seu normal na última sessão." : "Jogue uma partida de CS2 e os contadores que mudaram aparecem aqui."}
          />
        )}
      </Secao>

      <Secao titulo={`Todas as métricas · ${resto.length + destaques.length}`}>
        <MetricTable metricas={resto} congeladas={congeladas} congeladasPelaValve={gaugesLookStale(fonte.rows)} appId={appId} />
      </Secao>
    </div>
  );
}
