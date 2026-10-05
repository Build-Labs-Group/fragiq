import type { Valencia } from "@/lib/delta";
import { quantil } from "@/lib/estatistica";
import { formatarDia } from "@/lib/formato";

/**
 * Pirulitos divergentes: cada item contra a sua própria referência.
 *
 * Feito para "cada sessão contra o normal": a haste vai do normal daquela
 * sessão (o traço pequeno) até o valor dela (a bola). Haste para cima e
 * verde é sessão acima do normal; para baixo e vermelha, abaixo. Lê-se a
 * semana inteira de relance — sequências, a sessão que destoou — sem ler
 * uma tabela. Amostra fraca sai vazada, como no resto do site; com lente,
 * o que é de outro modo fica apagado (a série é inteira; o modo destaca).
 *
 * O eixo é o mesmo para todos (um só, nunca dois); os extremos ficam no
 * 2º e no 98º percentil e o que passa disso encosta na borda.
 */
export type Pirulito = {
  id: string;
  quando: Date;
  valor: number;
  referencia: number | null;
  valencia: Valencia | null;
  fraco?: boolean;
  apagado?: boolean;
  titulo: string;
};

const W = 720;
const H = 170;
const M = { top: 14, right: 10, bottom: 22, left: 40 };

export function Pirulitos({ itens, formatar, className }: { itens: Pirulito[]; formatar: (v: number) => string; className?: string }) {
  if (itens.length === 0) return null;
  const todos = itens.flatMap((i) => (i.referencia === null ? [i.valor] : [i.valor, i.referencia])).sort((a, b) => a - b);
  let min = quantil(todos, 0.02)!;
  let max = quantil(todos, 0.98)!;
  const folga = (max - min || Math.abs(max) * 0.2 || 1) * 0.12;
  min = Math.max(0, min - folga);
  max += folga;
  const y = (v: number) => M.top + (1 - (Math.max(min, Math.min(max, v)) - min) / (max - min)) * (H - M.top - M.bottom);
  const passo = (W - M.left - M.right) / itens.length;
  const x = (i: number) => M.left + passo * (i + 0.5);
  const raio = Math.max(2.5, Math.min(5, passo * 0.28));
  const marcas = [min + (max - min) * 0.1, (min + max) / 2, max - (max - min) * 0.1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className ?? "h-auto w-full"} role="img" aria-label={`${itens.length} sessões contra o normal de cada uma`}>
      {marcas.map((v) => (
        <g key={v}>
          <line x1={M.left} x2={W - M.right} y1={y(v)} y2={y(v)} stroke="var(--line-soft)" />
          <text x={M.left - 6} y={y(v)} textAnchor="end" dominantBaseline="middle" fontSize="10" fill="var(--ink-faint)" className="tnum">
            {formatar(v)}
          </text>
        </g>
      ))}
      {itens.map((it, i) => {
        const cor = it.valencia === "good" ? "var(--good)" : it.valencia === "bad" ? "var(--bad)" : "var(--ink-faint)";
        const yv = y(it.valor);
        const yr = it.referencia === null ? null : y(it.referencia);
        return (
          <g key={it.id} className="pirulito" opacity={it.apagado ? 0.3 : 1}>
            <title>{it.titulo}</title>
            <rect x={x(i) - passo / 2} y={M.top} width={passo} height={H - M.top - M.bottom} fill="transparent" />
            {yr !== null && (
              <>
                <line className="haste" x1={x(i)} x2={x(i)} y1={yr} y2={yv} stroke={cor} strokeWidth="2" strokeLinecap="round" style={{ "--i": i } as React.CSSProperties} />
                <line x1={x(i) - raio} x2={x(i) + raio} y1={yr} y2={yr} stroke="var(--ink-muted)" strokeWidth="1.5" strokeLinecap="round" />
              </>
            )}
            <circle cx={x(i)} cy={yv} r={raio} fill={it.fraco ? "var(--surface)" : cor} stroke={cor} strokeWidth={it.fraco ? 1.5 : 0} />
          </g>
        );
      })}
      <text x={M.left} y={H - 6} fontSize="10" fill="var(--ink-faint)">
        {formatarDia(itens[0].quando)}
      </text>
      <text x={W - M.right} y={H - 6} textAnchor="end" fontSize="10" fill="var(--ink-faint)">
        {formatarDia(itens[itens.length - 1].quando)}
      </text>
    </svg>
  );
}
