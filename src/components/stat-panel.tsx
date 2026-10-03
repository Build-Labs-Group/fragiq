import type { PanelStat } from "@/lib/cs2-panel";
import { normalDe, serieDeSessoes, type SnapshotRow } from "@/lib/series";
import { rotularModo } from "@/lib/cs2-labels";
import { StatCard } from "./stat-card";
import { Estado } from "./estado";

/**
 * A grade de cartões de estatística. Calcula, para cada uma, a série
 * inteira (nunca recortada pela lente), o ponto lido (a última sessão do
 * modo, se há lente) e o normal honesto; o cartão só mostra.
 */
type Props = {
  stats: PanelStat[];
  snapshots: SnapshotRow[];
  lente?: string | null;
  appId: number;
  /** Quantos cartões mostrar; o resto fica para a aba Estatísticas. */
  limite?: number;
};

export function StatPanel({ stats, snapshots, lente = null, appId, limite }: Props) {
  const cartoes = stats
    .map((stat) => {
      const pontos = serieDeSessoes(snapshots, stat);
      const doModo = lente ? pontos.filter((p) => p.modo === lente) : pontos;
      const atual = doModo[doModo.length - 1] ?? null;
      const normal = normalDe(snapshots, stat, { modo: lente }, atual?.sessaoId ?? null, rotularModo);
      return { stat, pontos, atual, normal };
    })
    .filter((c) => c.atual !== null || c.normal.tipo !== "nenhum")
    .slice(0, limite ?? stats.length);

  if (cartoes.length === 0) {
    return <Estado titulo="Sem estatísticas ainda" texto="A primeira coleta com partidas preenche este painel." />;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cartoes.map((c) => (
        <StatCard key={c.stat.key} stat={c.stat} pontos={c.pontos} atual={c.atual} normal={c.normal} lente={lente} appId={appId} />
      ))}
    </div>
  );
}
