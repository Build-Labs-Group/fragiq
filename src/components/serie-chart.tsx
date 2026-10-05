import type { PontoSerie } from "@/lib/series";
import { dominioRobusto, grampear } from "@/lib/dominio";
import { formatarDia, formatarQuando } from "@/lib/formato";
import { rotularModo } from "@/lib/cs2-labels";

/**
 * O gráfico de uma estatística, em página inteira.
 *
 * SVG à mão, renderizado no servidor, sem biblioteca: aparece junto com o
 * HTML. A série é inteira; a lente destaca os pontos do modo e apaga os
 * outros. O domínio é o robusto (`dominio.ts`): um outlier vira um
 * triângulo na borda com o valor real e a amostra — mostrado, nunca
 * omitido, e nunca mandando no eixo.
 *
 * Hover e foco sem JavaScript: cada ponto é um `<g tabindex>` com o rótulo
 * escondido, que `:hover` e `:focus-visible` mostram. Funciona no toque
 * (primeiro tap foca) e no teclado.
 */
const W = 720;
const H = 280;
const M = { top: 22, right: 20, bottom: 30, left: 56 };

type Props = {
  pontos: PontoSerie[];
  normal: { valor: number; rotulo: string } | null;
  lente?: string | null;
  formatar: (v: number) => string;
  emPct?: boolean;
  casas?: number;
  amostraDe?: "rounds" | "partidas";
};

export function SerieChart({ pontos, normal, lente = null, formatar, emPct = false, casas = 2, amostraDe = "rounds" }: Props) {
  const d = dominioRobusto(pontos, normal?.valor ?? null, emPct, casas);
  const t0 = pontos[0]?.t ?? 0;
  const t1 = pontos[pontos.length - 1]?.t ?? 1;
  const spanT = t1 - t0 || 1;
  const x = (t: number) => (pontos.length < 2 ? (M.left + W - M.right) / 2 : M.left + ((t - t0) / spanT) * (W - M.left - M.right));
  const y = (v: number) => M.top + (1 - (v - d.min) / (d.max - d.min)) * (H - M.top - M.bottom);

  const desenhados = pontos.map((p) => {
    const g = grampear(p.valor, d);
    return { p, x: x(p.t), y: y(g.y), fora: g.fora, noModo: lente ? p.modo === lente : true };
  });
  const caminho = desenhados.map((q, i) => `${i ? "L" : "M"}${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(" ");
  const ticksY = escalaY(d.min, d.max);
  const ticksT = marcasDeTempo(t0, t1);
  const rotulados = new Set(
    pontos.length <= 8
      ? pontos.map((_, i) => i)
      : [0, pontos.length - 1, indiceExtremo(desenhados, "max"), indiceExtremo(desenhados, "min")],
  );

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="serie h-auto w-full" role="img">
      {ticksY.map((v) => (
        <g key={v}>
          <line x1={M.left} x2={W - M.right} y1={y(v)} y2={y(v)} stroke="var(--line-soft)" strokeWidth="1" />
          <text x={M.left - 8} y={y(v)} textAnchor="end" dominantBaseline="middle" fontSize="11" fill="var(--ink-faint)" className="tnum">
            {formatar(v)}
          </text>
        </g>
      ))}

      {normal && (
        <>
          <line x1={M.left} x2={W - M.right} y1={y(normal.valor)} y2={y(normal.valor)} stroke="var(--ink-faint)" strokeWidth="1" strokeDasharray="4 4" />
          <text x={W - M.right} y={y(normal.valor) - 6} textAnchor="end" fontSize="11" fill="var(--ink-faint)">
            {normal.rotulo} {formatar(normal.valor)}
          </text>
        </>
      )}

      {pontos.length >= 2 && !lente && (
        <>
          <defs>
            <linearGradient id="fragiq-area-serie" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            className="area-surgir"
            d={`${caminho} L${desenhados[desenhados.length - 1].x.toFixed(1)},${H - M.bottom} L${desenhados[0].x.toFixed(1)},${H - M.bottom} Z`}
            fill="url(#fragiq-area-serie)"
          />
        </>
      )}

      {pontos.length >= 2 && (
        <path d={caminho} fill="none" stroke={lente ? "var(--line)" : "var(--accent)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={lente ? undefined : "tracar"} />
      )}

      {desenhados.map((q, i) => {
        const cor = q.noModo ? "var(--accent)" : "var(--ink-faint)";
        const amostra = amostraDe === "rounds" ? q.p.rounds : q.p.partidas;
        const legenda = [
          formatar(q.p.valor),
          formatarQuando(new Date(q.p.t)),
          q.p.modo ? rotularModo(q.p.modo) : null,
          Number.isFinite(amostra) ? `${amostra} ${amostraDe === "rounds" ? "r" : "partidas"}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        const anchor = i === 0 ? "start" : i === desenhados.length - 1 ? "end" : "middle";
        return (
          <g key={q.p.t} tabIndex={0} className="ponto" aria-label={legenda}>
            <line x1={q.x} x2={q.x} y1={M.top} y2={H - M.bottom} stroke="var(--ink-faint)" strokeWidth="1" className="guia" />
            {q.fora ? (
              <path
                d={q.fora === "acima" ? `M${q.x},${q.y + 1} l-5,8 l10,0 z` : `M${q.x},${q.y - 1} l-5,-8 l10,0 z`}
                fill="var(--ink-faint)"
              />
            ) : (
              <circle cx={q.x} cy={q.y} r={q.noModo ? 4 : 2.5} fill={q.p.fraco ? "var(--surface)" : cor} stroke={cor} strokeWidth={q.p.fraco ? 1.5 : 0} />
            )}
            {(rotulados.has(i) || q.fora) && (
              <text x={q.x} y={q.fora === "abaixo" ? q.y + 20 : q.y - 11} textAnchor={anchor} fontSize="11" fill={q.fora ? "var(--ink-faint)" : "var(--ink)"} className="tnum rotulo">
                {formatar(q.p.valor)}
                {q.fora ? ` ${q.fora === "acima" ? "▲" : "▼"} · ${Number.isFinite(amostra) ? amostra : "?"} ${amostraDe === "rounds" ? "r" : "p"}` : ""}
              </text>
            )}
            <text x={q.x} y={M.top - 8} textAnchor={anchor} fontSize="11" fill="var(--ink)" className="tnum legenda">
              {legenda}
            </text>
          </g>
        );
      })}

      {ticksT.map((t, i) => (
        <text key={t} x={i === 0 ? M.left : i === ticksT.length - 1 ? W - M.right : x(t)} y={H - 8} textAnchor={i === 0 ? "start" : i === ticksT.length - 1 ? "end" : "middle"} fontSize="11" fill="var(--ink-faint)">
          {formatarDia(new Date(t))}
        </text>
      ))}
    </svg>
  );
}

function indiceExtremo(qs: { p: PontoSerie; fora: string | null }[], qual: "max" | "min"): number {
  let melhor = -1;
  qs.forEach((q, i) => {
    if (q.fora || q.p.fraco) return;
    if (melhor === -1 || (qual === "max" ? q.p.valor > qs[melhor].p.valor : q.p.valor < qs[melhor].p.valor)) melhor = i;
  });
  return melhor;
}

/** Quatro marcas em números redondos, não em frações do domínio. */
function escalaY(min: number, max: number): number[] {
  const passoBruto = (max - min) / 4;
  const mag = 10 ** Math.floor(Math.log10(passoBruto || 1));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((p) => p >= passoBruto) ?? mag * 10;
  const inicio = Math.ceil(min / passo) * passo;
  const ticks: number[] = [];
  for (let v = inicio; v <= max + passo * 0.001; v += passo) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

const DIA = 86_400_000;

/** Primeiro e último instante; entre eles, uma marca por semana quando o intervalo passa de 14 dias. */
function marcasDeTempo(t0: number, t1: number): number[] {
  if (t1 <= t0) return [t0];
  const marcas = [t0];
  if (t1 - t0 > 14 * DIA) {
    for (let t = t0 + 7 * DIA; t < t1 - 3 * DIA; t += 7 * DIA) marcas.push(t);
  }
  marcas.push(t1);
  return marcas;
}
