import type { PontoSerie } from "@/lib/series";
import { dominioRobusto, grampear } from "@/lib/dominio";

/**
 * A linha de dentro de um cartão de estatística.
 *
 * SVG à mão e sem animação: doze cartões se desenhando ao mesmo tempo era
 * ruído. A série é sempre inteira; a lente só destaca. O domínio é o
 * robusto (`dominio.ts`), então um outlier vira um marcador na borda em vez
 * de achatar a linha; pontos com pouca amostra saem vazados. Nunca vazia:
 * com zero pontos desenha a baseline e diz que não há sessões; com um ou
 * dois, desenha os pontos.
 */
type Props = {
  pontos: PontoSerie[];
  normal: number | null;
  lente?: string | null;
  emPct?: boolean;
  casas?: number;
  className?: string;
};

const W = 240;
const H = 40;
const PAD = 5;

export function Sparkline({ pontos, normal, lente = null, emPct = false, casas = 2, className }: Props) {
  const d = dominioRobusto(pontos, normal, emPct, casas);
  const y = (v: number) => PAD + (1 - (v - d.min) / (d.max - d.min)) * (H - PAD * 2);
  const x = (i: number) => (pontos.length < 2 ? W / 2 : PAD + (i / (pontos.length - 1)) * (W - PAD * 2));
  const temNormal = normal !== null && Number.isFinite(normal);

  const desenhados = pontos.map((p, i) => {
    const g = grampear(p.valor, d);
    return { p, x: x(i), y: y(g.y), fora: g.fora, noModo: lente ? p.modo === lente : true };
  });
  const caminho = desenhados.map((q, i) => `${i ? "L" : "M"}${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(" ");
  const corLinha = lente ? "var(--line)" : "var(--accent)";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} preserveAspectRatio="none" aria-hidden>
      {temNormal && (
        <line x1={0} x2={W} y1={y(normal)} y2={y(normal)} stroke="var(--ink-faint)" strokeWidth="1" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      )}
      {pontos.length === 0 && (
        <text x={W / 2} y={H / 2 + 4} textAnchor="middle" fontSize="10" fill="var(--ink-faint)" fontFamily="var(--font-geist-mono)">
          sem sessões
        </text>
      )}
      {pontos.length >= 2 && !lente && (
        <>
          <defs>
            <linearGradient id="fragiq-area-spark" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.18" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${caminho} L${desenhados[desenhados.length - 1].x.toFixed(1)},${H} L${desenhados[0].x.toFixed(1)},${H} Z`} fill="url(#fragiq-area-spark)" />
        </>
      )}
      {pontos.length >= 2 && (
        <path d={caminho} fill="none" stroke={corLinha} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      )}
      {desenhados.map((q, i) => {
        const ultimo = i === desenhados.length - 1;
        const raio = q.noModo && (lente || ultimo || pontos.length <= 2) ? 4 : lente ? 2.5 : 0;
        if (raio === 0 && !q.fora) return null;
        const cor = q.noModo ? "var(--accent)" : "var(--ink-faint)";
        if (q.fora) {
          // Grampeado na borda: um traço vertical curto no lugar do ponto.
          // O viewBox é esticado só na horizontal, então um triângulo sairia
          // deformado; o traço, medido em pixels de tela, não.
          const dy = q.fora === "acima" ? 6 : -6;
          return (
            <path
              key={i}
              d={`M${q.x.toFixed(1)},${q.y.toFixed(1)} l0,${dy}`}
              stroke="var(--ink-faint)"
              strokeWidth="2"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              fill="none"
            />
          );
        }
        return (
          <path
            key={i}
            d={`M${q.x.toFixed(1)},${q.y.toFixed(1)} l0,0`}
            stroke={q.p.fraco ? "var(--ink-faint)" : cor}
            strokeWidth={q.p.fraco ? raio : raio * 1.6}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            fill="none"
            opacity={q.p.fraco ? 0.7 : 1}
          />
        );
      })}
    </svg>
  );
}
