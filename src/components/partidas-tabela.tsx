import Link from "next/link";
import type { PartidaLinha } from "@/lib/partidas";
import { formatarQuando } from "@/lib/sessoes";
import { rotularMapa, rotularModo } from "@/lib/cs2-labels";
import { MapaVisual } from "./mapa-visual";
import { cn } from "@/lib/utils";

/**
 * As partidas oficiais, uma por linha.
 *
 * Eram doze colunas — quando, mapa, placar, K, A, D, K/D, HS, MVP, score,
 * duração e um link — e ler uma linha exigia contar cabeçalhos. MVP,
 * score e duração saíram: são o mesmo desempenho já dito por K/D e HS,
 * com três números a mais para atravessar, e continuam inteiros na página
 * da partida, que é onde alguém vai atrás deles.
 *
 * O que entrou no lugar não é número: é o mapa, visível. É por ele que se
 * procura uma partida na lista, e um nome escrito no meio de dez colunas
 * de dígitos não se acha.
 *
 * A linha inteira é o link. Um alvo de clique de 44 px de altura na linha
 * toda funciona no toque; uma palavra sublinhada no meio da tabela, não.
 */
export function PartidasTabela({ partidas, publica = false }: { partidas: PartidaLinha[]; publica?: boolean }) {
  const n = (v: number) => v.toLocaleString("pt-BR");

  return (
    <div className="overflow-hidden rounded-2xl bg-surface ring-1 ring-line">
      <ol className="divide-y divide-line-soft">
        {partidas.map((p) => {
          const kd = p.eu.deaths ? p.eu.kills / p.eu.deaths : p.eu.kills;
          const hs = p.eu.kills ? (p.eu.hs / p.eu.kills) * 100 : 0;
          return (
            <li key={p.id}>
              <Link
                href={`/partida/${p.id}`}
                className="flex items-center gap-3 px-3 py-2.5 transition hover:bg-surface-2 sm:gap-4 sm:px-4"
                title={`${n(p.eu.mvps)} MVP · score ${n(p.eu.score)} · ${Math.round(p.duracaoS / 60)} min · ${p.rounds} rounds`}
              >
                <MapaVisual mapa={p.mapa} />

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {p.mapa ? rotularMapa(p.mapa) : "Partida"}
                    {p.modo && <span className="ml-2 text-xs font-normal text-ink-faint">{rotularModo(p.modo)}</span>}
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-faint" suppressHydrationWarning>
                    {formatarQuando(p.jogadaEm)}
                    {!publica && p.conhecidos.length > 0 && ` · +${p.conhecidos.length} do FragIQ`}
                  </p>
                </div>

                <span
                  className={cn(
                    "num shrink-0 rounded-md px-2 py-1 text-sm font-medium",
                    p.eu.venceu === true && "bg-good-soft text-good",
                    p.eu.venceu === false && "bg-bad-soft text-bad",
                    p.eu.venceu === null && "bg-surface-2 text-ink-muted",
                  )}
                >
                  {p.placar[0]}–{p.placar[1]}
                </span>

                <div className="num hidden w-24 shrink-0 text-right text-sm sm:block">
                  <p className="tnum">
                    {n(p.eu.kills)}
                    <span className="text-ink-faint">/{n(p.eu.assists)}/{n(p.eu.deaths)}</span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-faint">K / A / D</p>
                </div>

                <div className="num w-12 shrink-0 text-right sm:w-14">
                  <p className={cn("tnum text-sm font-medium", kd >= 1 && "text-good")}>{kd.toFixed(2).replace(".", ",")}</p>
                  <p className="mt-0.5 text-[11px] text-ink-faint">K/D</p>
                </div>

                <div className="num hidden w-12 shrink-0 text-right sm:block">
                  <p className="tnum text-sm">{hs.toFixed(0)}%</p>
                  <p className="mt-0.5 text-[11px] text-ink-faint">HS</p>
                </div>
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
