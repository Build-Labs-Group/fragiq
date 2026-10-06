import Link from "next/link";
import { DeltaChip } from "./delta-chip";
import { Sparkline } from "./sparkline";
import { Regua } from "./graficos/regua";
import { pontosSimples } from "@/lib/series";
import { formatarNumeroAte } from "@/lib/formato";
import { fraseDoImpacto, type MetricaDaTela } from "@/lib/metricas-tela";

/**
 * Os contadores que mais fugiram do normal na última sessão, um cartão
 * cada, na ordem do impacto (`lib/metricas-tela.ts`). Mesma anatomia do
 * cartão de estatística (docs/design.md §2.3): rótulo, número com chip,
 * uma linha de referência, a régua (valor × normal), a tendência e, no
 * rodapé, quanto isso pesou em eventos.
 */
export function fmtTaxa(v: number | null, casas = 2) {
  if (v === null) return "—";
  // Taxa por round de contador raro mora na terceira casa; arredondar para
  // duas mostraria "0" ao lado de um chip de +400%.
  return formatarNumeroAte(v, v !== 0 && Math.abs(v) < 0.1 ? 4 : casas);
}

export function rotuloDaReferencia(m: Pick<MetricaDaTela, "referencia">): string {
  if (m.referencia === "modo") return "normal do modo";
  if (m.referencia === "vitalicio-fraco") return "vitalício · modo sem base";
  return "vitalício";
}

export function MetricasDestaque({ metricas, appId }: { metricas: MetricaDaTela[]; appId: number }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {metricas.map((m) => {
        const impacto = fraseDoImpacto(m);
        const valencia = m.delta.estado === "ok" ? m.delta.valencia : null;
        return (
          <li key={m.key}>
            <Link
              href={`/games/${appId}/metricas/${encodeURIComponent(m.key)}`}
              className="block h-full rounded-2xl bg-surface p-4 ring-1 ring-line transition hover:ring-accent/40"
            >
              <p className="hud truncate" title={m.rotulo}>
                {m.rotulo}
              </p>
              <p className="num mt-1 flex items-baseline gap-2 text-2xl font-semibold">
                {fmtTaxa(m.periodo)}
                <span className="text-xs font-normal text-ink-faint">por round</span>
                <DeltaChip delta={m.delta} className="ml-auto" />
              </p>
              <p className="tnum text-xs text-ink-faint">
                {rotuloDaReferencia(m)} {fmtTaxa(m.vitalicio)}
              </p>
              <Regua className="mt-2.5" valor={m.periodo} referencia={m.vitalicio} valencia={valencia} />
              <div className="mt-2.5 flex items-end justify-between gap-3">
                <p className="tnum text-xs text-ink-muted">{impacto ?? `${fmtTaxa(m.total, 0)} no período`}</p>
                {m.valores.length >= 2 && <Sparkline pontos={pontosSimples(m.valores)} normal={m.vitalicio} className="h-7 w-24 shrink-0" />}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
