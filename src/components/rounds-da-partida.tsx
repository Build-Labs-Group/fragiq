import { Bomb, Clock, Scissors, Skull } from "lucide-react";
import type { LinhaDoTempo, RoundNaLinha } from "@/lib/demo/linha-do-tempo";
import type { ClasseEconomica } from "@/lib/demo/economia";
import type { Lado } from "@/lib/demo/payload";
import { conversaoDosTimes } from "@/lib/demo/conversao";
import { cn } from "@/lib/utils";

/**
 * A partida round a round, lida da demo (`MatchDemo.linhaDoTempo`).
 *
 * Duas camadas, uma pergunta cada:
 *
 * - **o placar ao longo da partida** — a diferença de rounds entre os
 *   times depois de cada round, acima e abaixo do zero. É onde a virada, a
 *   sequência e o "abriu 8 a 2 e perdeu" aparecem sem ler número nenhum;
 * - **a faixa** — uma coluna por round, a célula acesa na linha do time
 *   que venceu, na cor do lado com que venceu (CT azul, T dourado) e com o
 *   ícone de como acabou: eliminação, bomba, desarme, tempo. A troca de
 *   lados abre um vão. Com economia (payload v2), um traço sob cada time
 *   diz a compra: baixo para eco/pistol, médio para meia, cheio para cheia.
 *
 * Os times da demo (0 = começou de CT) casam com o A/B do placar pela
 * escalação, como a conversão (`conversaoDosTimes`).
 */

const COR: Record<Lado, string> = { CT: "var(--side-ct)", T: "var(--side-t)" };
const oposto = (l: Lado): Lado => (l === "CT" ? "T" : "CT");

function Motivo({ motivo, className }: { motivo: string | null; className?: string }) {
  const m = motivo ?? "";
  const props = { className, "aria-hidden": true, strokeWidth: 2.25 } as const;
  if (m.includes("bomb_exploded") || m.includes("target_bombed")) return <Bomb {...props} />;
  if (m.includes("defused")) return <Scissors {...props} />;
  if (m.includes("saved") || m.includes("time")) return <Clock {...props} />;
  if (m.includes("killed")) return <Skull {...props} />;
  return <span className={cn("block size-1.5 rounded-full bg-current", className)} aria-hidden />;
}

const COMO: Record<string, string> = {
  bomb: "bomba explodiu",
  defused: "bomba desarmada",
  saved: "tempo esgotado",
  killed: "eliminação",
};
function comoAcabou(motivo: string | null): string {
  const m = motivo ?? "";
  if (m.includes("bomb_exploded") || m.includes("target_bombed")) return COMO.bomb;
  if (m.includes("defused")) return COMO.defused;
  if (m.includes("saved") || m.includes("time")) return COMO.saved;
  if (m.includes("killed")) return COMO.killed;
  return m || "fim do round";
}

const NIVEL: Record<ClasseEconomica, number> = { pistol: 1, eco: 1, meia: 2, cheia: 3 };
const ROTULO_COMPRA: Record<ClasseEconomica, string> = { pistol: "pistol", eco: "eco", meia: "meia", cheia: "cheia" };

export function RoundsDaPartida({
  linha,
  escalacoes,
  rotulos,
  meuTime,
}: {
  linha: LinhaDoTempo;
  /** SteamIDs do time A e do time B, na ordem do placar. */
  escalacoes: string[][];
  rotulos: [string, string];
  /** 0 ou 1 quando quem está vendo jogou a partida; o traço do placar fica do ponto de vista dele. */
  meuTime: number | null;
}) {
  if (linha.rounds.length === 0) return null;
  // Para cada time do placar (A, B), o índice do time da demo.
  const casados = conversaoDosTimes(
    linha.times.map((t, i) => ({ ...t, i })),
    escalacoes,
  );
  const demoDe = casados.map((c, i) => c?.i ?? i) as [number, number];
  const rounds = linha.rounds;

  const ladoDoTime = (r: RoundNaLinha, timeDoPlacar: number): Lado => {
    const d = demoDe[timeDoPlacar];
    return r.vencedor === d ? r.lado : oposto(r.lado);
  };
  const troca = (i: number) => i > 0 && ladoDoTime(rounds[i], 0) !== ladoDoTime(rounds[i - 1], 0);
  const temCompra = rounds.some((r) => r.compra);

  // Diferença do ponto de vista do meu time (ou do time A, para quem não jogou).
  const eu = meuTime ?? 0;
  const diff = rounds.map((r) => r.placar[demoDe[eu]] - r.placar[demoDe[1 - eu]]);
  const maxAbs = Math.max(1, ...diff.map(Math.abs));
  const final = rounds[rounds.length - 1].placar;

  return (
    <section className="mt-8 overflow-hidden rounded-2xl bg-surface ring-1 ring-line">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 pt-4 sm:px-5">
        <h2 className="hud">round a round</h2>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">
          <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: COR.CT }} aria-hidden /> CT</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: COR.T }} aria-hidden /> T</span>
          <span className="inline-flex items-center gap-1"><Skull className="size-3" aria-hidden /> eliminação</span>
          <span className="inline-flex items-center gap-1"><Bomb className="size-3" aria-hidden /> bomba</span>
          <span className="inline-flex items-center gap-1"><Scissors className="size-3" aria-hidden /> desarme</span>
          <span className="inline-flex items-center gap-1"><Clock className="size-3" aria-hidden /> tempo</span>
        </p>
      </div>

      <div className="overflow-x-auto px-4 pb-4 sm:px-5">
        <div className="min-w-max">
          <Placar diff={diff} maxAbs={maxAbs} troca={troca} rotulo={meuTime !== null ? "seu time" : rotulos[0]} />
          {[0, 1].map((t) => (
            <div key={t} className="mt-1.5 flex items-center gap-2">
              <span className="hud w-14 shrink-0 truncate">{rotulos[t]}</span>
              <span className="num w-6 shrink-0 text-right text-sm font-semibold">{final[demoDe[t]]}</span>
              <ol className="flex gap-1">
                {rounds.map((r, i) => {
                  const venceu = r.vencedor === demoDe[t];
                  const lado = ladoDoTime(r, t);
                  const compra = r.compra?.[demoDe[t]] ?? null;
                  const titulo = `Round ${r.n} · ${rotulos[t]} de ${lado}${venceu ? ` venceu (${comoAcabou(r.motivo)})` : " perdeu"}${compra ? ` · compra ${ROTULO_COMPRA[compra]}` : ""} · ${r.placar[demoDe[0]]}–${r.placar[demoDe[1]]}`;
                  return (
                    <li key={r.n} className={cn("flex flex-col items-center gap-1", troca(i) && "ml-3")} title={titulo}>
                      <span
                        className={cn(
                          "entrar grid size-6 place-items-center rounded-md sm:size-7",
                          venceu ? "text-canvas" : "bg-surface-2 text-ink-faint/50",
                        )}
                        style={{ ...(venceu ? { background: COR[lado] } : {}), "--i": i } as React.CSSProperties}
                      >
                        {venceu ? <Motivo motivo={r.motivo} className="size-3.5" /> : <span className="block size-1 rounded-full bg-current" aria-hidden />}
                        <span className="sr-only">{titulo}</span>
                      </span>
                      {temCompra && (
                        <span className="flex h-1.5 w-6 gap-px sm:w-7" aria-hidden>
                          {[1, 2, 3].map((nivel) => (
                            <span
                              key={nivel}
                              className="flex-1 rounded-full"
                              style={{ background: compra && NIVEL[compra] >= nivel ? COR[lado] : "var(--line-soft)", opacity: compra && NIVEL[compra] >= nivel ? 0.8 : 1 }}
                            />
                          ))}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
          <div className="mt-1 flex items-center gap-2">
            <span className="w-14 shrink-0" />
            <span className="w-6 shrink-0" />
            <ol className="flex gap-1" aria-hidden>
              {rounds.map((r, i) => (
                <li key={r.n} className={cn("tnum w-6 text-center text-[10px] text-ink-faint sm:w-7", troca(i) && "ml-3")}>
                  {r.n === 1 || troca(i) || r.n % 5 === 0 || i === rounds.length - 1 ? r.n : ""}
                </li>
              ))}
            </ol>
          </div>
          {temCompra && <p className="mt-2 pl-[5.5rem] text-[11px] text-ink-faint">traço = compra do time · ⅓ eco ou pistol · ⅔ meia · cheio compra cheia</p>}
        </div>
      </div>
    </section>
  );
}

/**
 * A diferença no placar depois de cada round, em colunas acima (na frente)
 * e abaixo (atrás) do zero — alinhadas com a faixa, uma por round. Sem
 * valência de cor: na frente é a cor da marca, atrás é neutro.
 */
function Placar({ diff, maxAbs, troca, rotulo }: { diff: number[]; maxAbs: number; troca: (i: number) => boolean; rotulo: string }) {
  const ALT = 28;
  return (
    <div className="mt-4 flex items-center gap-2">
      <span className="w-14 shrink-0 text-[10px] leading-tight text-ink-faint">{rotulo}<br />na frente</span>
      <span className="w-6 shrink-0" />
      <ol className="flex gap-1" aria-hidden>
        {diff.map((d, i) => {
          const h = Math.max(2, (Math.abs(d) / maxAbs) * ALT);
          return (
            <li key={i} className={cn("relative w-6 sm:w-7", troca(i) && "ml-3")} style={{ height: ALT * 2 }}>
              <span className="absolute inset-x-0 top-1/2 h-px bg-line" />
              {d !== 0 && (
                <span
                  className={cn("absolute inset-x-1 rounded-sm", d > 0 ? "bg-accent/80" : "bg-ink-faint/40")}
                  style={d > 0 ? { bottom: "50%", height: h } : { top: "50%", height: h }}
                />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
