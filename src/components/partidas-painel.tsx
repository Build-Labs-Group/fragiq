import Link from "next/link";
import type { PartidaLinha } from "@/lib/partidas";
import { formatarNumero } from "@/lib/formato";
import { formatarQuando } from "@/lib/sessoes";
import { rotularMapa } from "@/lib/cs2-labels";
import { identidadeDoMapa } from "@/lib/mapas";
import { cn } from "@/lib/utils";

/**
 * O painel da aba Partidas: o que as partidas listadas abaixo somam.
 *
 * Três leituras, de cima para baixo:
 *
 * - **os números** — vitórias, K/D, HS e kills por round, somados dos
 *   scoreboards (soma das kills ÷ soma das mortes, não média das razões);
 * - **a forma** — o resultado das últimas partidas, da mais antiga para a
 *   mais recente, cada quadrado um link para a partida;
 * - **por mapa** — onde você joga e onde você ganha: a barra é o número de
 *   partidas, dividida em vitórias e derrotas.
 *
 * Aqui a cor é valência de verdade: vencer é bom. O recorte é o mesmo da
 * lista (a lente de modo filtra listas), e o cabeçalho diz quantas são.
 */

const FORMA = 20;

export function PartidasPainel({ partidas }: { partidas: PartidaLinha[] }) {
  if (partidas.length < 2) return null;
  const n = partidas.length;
  const soma = partidas.reduce(
    (a, p) => ({
      kills: a.kills + p.eu.kills,
      deaths: a.deaths + p.eu.deaths,
      hs: a.hs + p.eu.hs,
      rounds: a.rounds + p.rounds,
      v: a.v + (p.eu.venceu === true ? 1 : 0),
      d: a.d + (p.eu.venceu === false ? 1 : 0),
    }),
    { kills: 0, deaths: 0, hs: 0, rounds: 0, v: 0, d: 0 },
  );
  const e = n - soma.v - soma.d;

  const tiles = [
    { rotulo: "vitórias", valor: `${formatarNumero((soma.v / n) * 100)}%`, sub: `${soma.v}V · ${soma.d}D${e ? ` · ${e}E` : ""}` },
    { rotulo: "K/D", valor: soma.deaths ? formatarNumero(soma.kills / soma.deaths, 2) : "—", sub: `${formatarNumero(soma.kills)} kills · ${formatarNumero(soma.deaths)} mortes` },
    { rotulo: "headshot", valor: soma.kills ? `${formatarNumero((soma.hs / soma.kills) * 100)}%` : "—", sub: `${formatarNumero(soma.hs)} de ${formatarNumero(soma.kills)}` },
    { rotulo: "kills por round", valor: soma.rounds ? formatarNumero(soma.kills / soma.rounds, 2) : "—", sub: `${formatarNumero(soma.rounds)} rounds` },
  ];

  // Mais antiga → mais recente, como se lê uma sequência.
  const forma = partidas.slice(0, FORMA).reverse();
  let sequencia = 0;
  const ultimoResultado = partidas[0].eu.venceu;
  for (const p of partidas) {
    if (p.eu.venceu !== ultimoResultado || ultimoResultado === null) break;
    sequencia++;
  }

  const porMapa = new Map<string, { n: number; v: number; d: number }>();
  for (const p of partidas) {
    const k = p.mapa ?? "?";
    const m = porMapa.get(k) ?? { n: 0, v: 0, d: 0 };
    porMapa.set(k, { n: m.n + 1, v: m.v + (p.eu.venceu === true ? 1 : 0), d: m.d + (p.eu.venceu === false ? 1 : 0) });
  }
  const mapas = [...porMapa.entries()].sort((a, b) => b[1].n - a[1].n || b[1].v - a[1].v).slice(0, 7);
  const maisJogado = Math.max(...mapas.map(([, m]) => m.n));

  return (
    <section className="space-y-3" aria-label="Resumo das partidas">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="hud">nas {n} partidas abaixo</h2>
        <p className="num text-xs text-ink-faint">placar dos dez, do Game Coordinator</p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t, i) => (
          <div key={t.rotulo} className="entrar rounded-2xl bg-surface p-4 ring-1 ring-line" style={{ "--i": i } as React.CSSProperties}>
            <p className="hud">{t.rotulo}</p>
            <p className="num mt-2 text-2xl font-semibold">{t.valor}</p>
            <p className="num mt-1 text-xs text-ink-faint">{t.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_1.2fr]">
        <div className="entrar min-w-0 rounded-2xl bg-surface p-4 ring-1 ring-line" style={{ "--i": 4 } as React.CSSProperties}>
          <div className="flex items-baseline justify-between gap-2">
            <p className="hud">forma · últimas {forma.length}</p>
            {sequencia >= 2 && ultimoResultado !== null && (
              <p className={cn("num text-xs", ultimoResultado ? "text-good" : "text-bad")}>
                {sequencia} {ultimoResultado ? "vitórias" : "derrotas"} seguidas
              </p>
            )}
          </div>
          {/* Quadrados e barras rolam juntos em tela estreita: um sob o outro, sempre. */}
          <div className="overflow-x-auto">
          <div className="w-max">
          <ol className="mt-2 flex gap-1.5 py-1">
            {forma.map((p, i) => (
              <li key={p.id}>
                <Link
                  href={`/partida/${p.id}`}
                  className={cn(
                    "entrar num grid size-7 place-items-center rounded-md text-[11px] font-semibold ring-1 transition hover:scale-110",
                    p.eu.venceu === true && "bg-good-soft text-good ring-good/30",
                    p.eu.venceu === false && "bg-bad-soft text-bad ring-bad/30",
                    p.eu.venceu === null && "bg-surface-2 text-ink-muted ring-line",
                  )}
                  style={{ "--i": i } as React.CSSProperties}
                  title={`${p.mapa ? rotularMapa(p.mapa) : "Partida"} · ${p.placar[0]}–${p.placar[1]} · ${formatarQuando(p.jogadaEm)}`}
                >
                  {p.eu.venceu === true ? "V" : p.eu.venceu === false ? "D" : "E"}
                </Link>
              </li>
            ))}
          </ol>
          <KdPorPartida forma={forma} />
          </div>
          </div>
          <p className="mt-2 text-[11px] text-ink-faint">mais antiga → mais recente · barra = K/D da partida, linha = 1,00</p>
        </div>

        <div className="entrar min-w-0 rounded-2xl bg-surface p-4 ring-1 ring-line" style={{ "--i": 5 } as React.CSSProperties}>
          <p className="hud">por mapa</p>
          <ul className="mt-3 space-y-2">
            {mapas.map(([mapa, m]) => {
              const id = identidadeDoMapa(mapa === "?" ? null : mapa);
              const largura = (m.n / maisJogado) * 100;
              return (
                <li key={mapa} className="flex items-center gap-3 text-sm" title={`${m.v} vitórias, ${m.d} derrotas em ${m.n} partidas`}>
                  <span className="flex w-24 shrink-0 items-center gap-2 truncate">
                    <span className="size-2.5 shrink-0 rounded-sm" style={{ background: `linear-gradient(135deg, ${id.de}, ${id.para})` }} aria-hidden />
                    {mapa === "?" ? "sem mapa" : rotularMapa(mapa)}
                  </span>
                  <span className="flex h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <span className="flex h-full" style={{ width: `${largura}%` }}>
                      <span className="h-full bg-good/80" style={{ width: `${(m.v / m.n) * 100}%` }} />
                      <span className="h-full bg-bad/70" style={{ width: `${(m.d / m.n) * 100}%` }} />
                      <span className="h-full flex-1 bg-ink-faint/40" />
                    </span>
                  </span>
                  <span className="num w-20 shrink-0 text-right text-xs text-ink-muted">
                    {m.v}–{m.d} · <span className="text-ink">{formatarNumero((m.v / m.n) * 100)}%</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}

/**
 * O K/D de cada partida da forma, uma barra sob cada quadrado — mesma
 * largura, mesma ordem —, com a linha do 1,00 como referência fixa. A cor
 * é a do resultado, apagada: a barra conta quanto, o quadrado já disse se
 * ganhou.
 */
function KdPorPartida({ forma }: { forma: PartidaLinha[] }) {
  const ALT = 56;
  const kds = forma.map((p) => (p.eu.deaths ? p.eu.kills / p.eu.deaths : p.eu.kills));
  const teto = Math.max(1.5, ...kds);
  const um = (1 / teto) * ALT;
  return (
    <div className="relative mt-3" style={{ height: ALT }} aria-hidden>
      <span className="absolute inset-x-0 border-t border-dashed border-line" style={{ bottom: um }} />
      <ol className="absolute inset-0 flex items-end gap-1.5">
        {forma.map((p, i) => (
          <li key={p.id} className="flex h-full w-7 shrink-0 items-end" title={`K/D ${formatarNumero(kds[i], 2)}`}>
            <span
              className={cn(
                "crescer block w-full rounded-t-sm",
                p.eu.venceu === true ? "bg-good/60" : p.eu.venceu === false ? "bg-bad/55" : "bg-ink-faint/40",
              )}
              style={{ height: Math.max(2, (kds[i] / teto) * ALT), "--i": i } as React.CSSProperties}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}
