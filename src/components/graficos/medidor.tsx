import type { Valencia } from "@/lib/delta";

/**
 * Medidor: uma proporção (0–100) num arco de 240°, com a referência como
 * um traço no arco.
 *
 * Para taxas que a pessoa lê como "quanto do tanque": vitórias, headshot,
 * rounds ganhos. O número fica no centro, em mono; o arco é magnitude, então
 * a cor é a da marca — a não ser que exista referência e valência, e aí o
 * arco diz se está acima ou abaixo dela, como a régua.
 */
const R = 44;
const CX = 60;
const CY = 54;
const INICIO = 150; // graus, sentido horário a partir do eixo x
const VARREDURA = 240;

function ponto(graus: number, r = R) {
  const rad = (graus * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

function arco(de: number, ate: number) {
  const a = ponto(de);
  const b = ponto(ate);
  const grande = ate - de > 180 ? 1 : 0;
  return `M${a.x.toFixed(2)},${a.y.toFixed(2)} A${R},${R} 0 ${grande} 1 ${b.x.toFixed(2)},${b.y.toFixed(2)}`;
}

export function Medidor({
  pct,
  referencia = null,
  valencia = null,
  centro,
  sub,
  rotulo,
  className,
}: {
  pct: number | null;
  referencia?: number | null;
  valencia?: Valencia | null;
  /** O texto grande do meio; por padrão, a porcentagem arredondada. */
  centro?: string;
  sub?: string;
  /** Para leitor de tela: o que o medidor mede. */
  rotulo: string;
  className?: string;
}) {
  const p = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  const fim = INICIO + (VARREDURA * p) / 100;
  const cor = valencia === "good" ? "var(--good)" : valencia === "bad" ? "var(--bad)" : valencia === "neutral" ? "var(--ink-muted)" : "var(--accent)";
  const ref = referencia === null ? null : Math.max(0, Math.min(100, referencia));
  const texto = centro ?? (pct === null ? "—" : `${Math.round(p)}%`);

  return (
    <svg viewBox="0 0 120 96" className={className} role="img" aria-label={`${rotulo}: ${texto}${ref !== null ? `, referência ${Math.round(ref)}%` : ""}`}>
      <path d={arco(INICIO, INICIO + VARREDURA)} fill="none" stroke="var(--surface-2)" strokeWidth="9" strokeLinecap="round" />
      <path d={arco(INICIO, INICIO + VARREDURA)} fill="none" stroke="var(--line)" strokeWidth="9" strokeLinecap="round" opacity="0.5" />
      {pct !== null && p > 0 && <path className="medidor-arco" d={arco(INICIO, Math.max(fim, INICIO + 0.5))} fill="none" stroke={cor} strokeWidth="9" strokeLinecap="round" />}
      {ref !== null && (() => {
        const g = INICIO + (VARREDURA * ref) / 100;
        const a = ponto(g, R - 8);
        const b = ponto(g, R + 8);
        return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--ink)" strokeWidth="2" strokeLinecap="round" />;
      })()}
      <text x={CX} y={CY + 4} textAnchor="middle" fontSize="20" fontWeight="600" fill="var(--ink)" fontFamily="var(--font-geist-mono)" className="tnum">
        {texto}
      </text>
      {sub && (
        <text x={CX} y={CY + 19} textAnchor="middle" fontSize="8.5" fill="var(--ink-faint)" fontFamily="var(--font-geist-mono)">
          {sub}
        </text>
      )}
    </svg>
  );
}
