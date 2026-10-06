"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { DeltaChip } from "./delta-chip";
import { GROUP_ORDER } from "@/lib/series";
import { formatarNumeroAte } from "@/lib/formato";
import type { MetricaDaTela } from "@/lib/metricas-tela";
import { cn } from "@/lib/utils";

/**
 * Todas as métricas que não são destaque, para quem quer procurar.
 *
 * Ladrilhos de tamanho fixo numa grade com rolagem própria: a página não
 * vira uma lista de 180 linhas, e cada ladrilho diz só o nome, o número e
 * o chip (o detalhe está a um toque, em `metricas/[key]`). A ordem é a de
 * `todasAsMetricas` — moveu e pesou, moveu pouco, não moveu —, e os que não
 * se moveram na sessão vão apagados. Chips de grupo e busca recortam a
 * grade; os contadores de "última partida" ficam fora, num `details`.
 */

function fmt(v: number | null, casas = 2) {
  if (v === null) return "—";
  return formatarNumeroAte(v, v !== 0 && Math.abs(v) < 0.1 ? 4 : casas);
}

export function MetricTable({
  metricas,
  congeladas,
  congeladasPelaValve,
  appId,
}: {
  metricas: MetricaDaTela[];
  congeladas: MetricaDaTela[];
  /** Os contadores de última partida pararam de andar (a Valve congelou). */
  congeladasPelaValve: boolean;
  appId: number;
}) {
  const [busca, setBusca] = useState("");
  const [grupo, setGrupo] = useState<string | null>(null);

  const grupos = useMemo(() => GROUP_ORDER.filter((g) => metricas.some((m) => m.grupo === g)), [metricas]);
  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return metricas.filter(
      (m) => (!q || m.rotulo.toLowerCase().includes(q) || m.key.toLowerCase().includes(q)) && (grupo === null || m.grupo === grupo),
    );
  }, [busca, grupo, metricas]);
  const paradas = filtradas.filter((m) => !m.aconteceu).length;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {[null, ...grupos].map((g) => (
          <button
            key={g ?? "todas"}
            type="button"
            onClick={() => setGrupo(g)}
            className={cn(
              "rounded-full px-3 py-1 text-xs ring-1 transition",
              grupo === g ? "bg-accent-soft text-accent ring-accent/40" : "text-ink-muted ring-line hover:text-ink",
            )}
          >
            {g ?? "Todas"}
          </button>
        ))}
        <label className="relative ml-auto flex w-full items-center sm:w-64">
          <Search className="pointer-events-none absolute left-3 size-4 text-ink-faint" aria-hidden />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder={`Buscar entre ${metricas.length}`}
            aria-label="Buscar métrica"
            className="min-h-10 w-full rounded-xl bg-surface pr-3 pl-9 text-sm text-ink ring-1 ring-line placeholder:text-ink-faint focus:ring-accent/50 focus:outline-none"
          />
        </label>
      </div>

      {filtradas.length === 0 ? (
        <p className="rounded-2xl bg-surface px-4 py-8 text-center text-sm text-ink-faint ring-1 ring-line">Nenhuma métrica com esse nome.</p>
      ) : (
        <div className="max-h-[26rem] overflow-y-auto rounded-2xl bg-surface p-2 ring-1 ring-line">
          <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
            {filtradas.map((m) => (
              <Ladrilho key={m.key} m={m} appId={appId} />
            ))}
          </ul>
        </div>
      )}
      <p className="tnum mt-2 text-[11px] text-ink-faint">
        {filtradas.length} {filtradas.length === 1 ? "métrica" : "métricas"}
        {paradas > 0 && ` · ${paradas} sem movimento na sessão, apagadas no fim`} · valores por round
      </p>

      {congeladas.length > 0 && (
        <details className="mt-4 rounded-2xl bg-surface ring-1 ring-line">
          <summary className="cursor-pointer px-4 py-3 text-xs text-ink-faint transition hover:text-ink">
            {congeladas.length} contadores de última partida{congeladasPelaValve ? " · congelados pela Valve" : ""}
          </summary>
          <ul className="grid grid-cols-2 gap-1.5 p-2 pt-0 sm:grid-cols-3 lg:grid-cols-4">
            {congeladas.map((m) => (
              <Ladrilho key={m.key} m={m} appId={appId} bruto />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Um ladrilho de altura fixa: nome numa linha, número e chip na outra. */
function Ladrilho({ m, appId, bruto = false }: { m: MetricaDaTela; appId: number; bruto?: boolean }) {
  return (
    <li>
      <Link
        href={`/games/${appId}/metricas/${encodeURIComponent(m.key)}`}
        title={`${m.rotulo} · ${m.grupo}`}
        className={cn(
          "flex h-16 flex-col justify-between rounded-xl bg-surface-2/50 px-3 py-2 transition hover:bg-surface-2 hover:ring-1 hover:ring-accent/30",
          !bruto && !m.aconteceu && "opacity-45",
        )}
      >
        <span className="truncate text-xs text-ink-muted">{m.rotulo}</span>
        <span className="num flex items-center gap-2 text-sm font-medium">
          {fmt(m.periodo, bruto ? 0 : 2)}
          {!bruto && <DeltaChip delta={m.delta} className="ml-auto" />}
        </span>
      </Link>
    </li>
  );
}
