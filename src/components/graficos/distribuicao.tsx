import { histograma, percentil, quantil } from "@/lib/estatistica";

/**
 * Distribuição: um histograma da comunidade com um marcador "você".
 *
 * Responde "isso é bom?" para um número sem referência óbvia — um K/D de
 * 1,12 não diz nada até se ver onde ele cai entre todos os jogadores que o
 * FragIQ já viu em partida oficial. As barras são a comunidade (cinza: é
 * contexto, não informação); o marcador é a pessoa, na cor da marca, com o
 * percentil escrito. A mediana fica tracejada, para a leitura "acima ou
 * abaixo do meio" não depender de contar barras.
 *
 * Outliers não esticam o eixo: os extremos ficam no 2º e no 98º percentil
 * e o que passa disso entra na primeira ou na última barra.
 */
const W = 360;
const H = 120;
const M = { top: 22, right: 8, bottom: 20, left: 8 };

export function Distribuicao({
  valores,
  voce,
  formatar,
  rotuloVoce = "você",
  faixas = 24,
  className,
}: {
  /** Valores da comunidade, em ordem crescente. */
  valores: number[];
  voce: number | null;
  formatar: (v: number) => string;
  rotuloVoce?: string;
  faixas?: number;
  className?: string;
}) {
  if (valores.length < 20) {
    return <p className="py-8 text-center text-xs text-ink-faint">Poucos jogadores ainda para uma distribuição ({valores.length}).</p>;
  }
  const min = quantil(valores, 0.02)!;
  const max = Math.max(quantil(valores, 0.98)!, min + 1e-6);
  const barras = histograma(valores, min, max, faixas);
  const topo = Math.max(...barras.map((b) => b.n), 1);
  const largura = (W - M.left - M.right) / faixas;
  const x = (v: number) => M.left + ((Math.max(min, Math.min(max, v)) - min) / (max - min)) * (W - M.left - M.right);
  const alt = (n: number) => ((H - M.top - M.bottom) * n) / topo;
  const mediana = quantil(valores, 0.5)!;
  const pctVoce = voce === null ? null : percentil(valores, voce);
  const xVoce = voce === null ? null : x(voce);
  const ancora = xVoce === null ? "middle" : xVoce < 60 ? "start" : xVoce > W - 60 ? "end" : "middle";

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={className ?? "h-auto w-full"}
      role="img"
      aria-label={`Distribuição de ${valores.length} jogadores; mediana ${formatar(mediana)}${voce !== null && pctVoce !== null ? `; ${rotuloVoce} ${formatar(voce)}, acima de ${Math.round(pctVoce)}%` : ""}`}
    >
      {barras.map((b, i) => {
        const h = alt(b.n);
        const dentro = voce !== null && voce >= b.de && (voce < b.ate || i === barras.length - 1);
        return (
          <rect
            key={i}
            className="crescer"
            style={{ "--i": i } as React.CSSProperties}
            x={M.left + i * largura + 1}
            y={H - M.bottom - h}
            width={Math.max(1, largura - 2)}
            height={Math.max(h, b.n ? 1 : 0)}
            rx="2"
            fill={dentro ? "var(--accent)" : "var(--ink-faint)"}
            opacity={dentro ? 0.9 : 0.35}
          >
            <title>{`${formatar(b.de)} a ${formatar(b.ate)}: ${b.n} ${b.n === 1 ? "jogador" : "jogadores"}`}</title>
          </rect>
        );
      })}
      <line x1={M.left} x2={W - M.right} y1={H - M.bottom} y2={H - M.bottom} stroke="var(--line)" />
      <line x1={x(mediana)} x2={x(mediana)} y1={M.top - 4} y2={H - M.bottom} stroke="var(--ink-muted)" strokeDasharray="3 3" />
      <text x={x(mediana)} y={H - 5} textAnchor="middle" fontSize="9.5" fill="var(--ink-faint)" fontFamily="var(--font-geist-mono)">
        mediana {formatar(mediana)}
      </text>
      <text x={M.left} y={H - 5} fontSize="9" fill="var(--ink-faint)" fontFamily="var(--font-geist-mono)">
        {formatar(min)}
      </text>
      <text x={W - M.right} y={H - 5} textAnchor="end" fontSize="9" fill="var(--ink-faint)" fontFamily="var(--font-geist-mono)">
        {formatar(max)}
      </text>
      {xVoce !== null && voce !== null && (
        <g>
          <line x1={xVoce} x2={xVoce} y1={M.top - 2} y2={H - M.bottom} stroke="var(--accent)" strokeWidth="2" />
          <circle cx={xVoce} cy={M.top - 2} r="3.5" fill="var(--accent)" />
          <text x={xVoce + (ancora === "start" ? -3 : ancora === "end" ? 3 : 0)} y={M.top - 10} textAnchor={ancora} fontSize="10.5" fontWeight="600" fill="var(--ink)" fontFamily="var(--font-geist-mono)">
            {rotuloVoce} {formatar(voce)}
            {pctVoce !== null ? (pctVoce >= 50 ? ` · top ${Math.max(1, Math.round(100 - pctVoce))}%` : ` · melhor que ${Math.round(pctVoce)}%`) : ""}
          </text>
        </g>
      )}
    </svg>
  );
}
