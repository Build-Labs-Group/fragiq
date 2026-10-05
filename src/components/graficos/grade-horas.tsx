import { formatarNumero } from "@/lib/formato";

/**
 * Grade dia × hora: quando se joga, num mapa de calor de 7 × 24.
 *
 * Mesma escala sequencial do calendário (a marca em degraus de opacidade
 * sobre `--surface-2`), mesmos quartis, mesmo hover nativo. As horas são
 * do horário de Brasília e o rótulo diz isso.
 */
const CEL = 13;
const GAP = 2;
const PASSO = CEL + GAP;
const ESQ = 28;
const TOPO = 14;
const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const OPACIDADE = [0, 0.3, 0.5, 0.75, 1];

export function GradeHoras({ grade, unidade = "partidas", className }: { grade: number[][]; unidade?: string; className?: string }) {
  const valores = grade.flat().filter((v) => v > 0).sort((a, b) => a - b);
  const q = (p: number) => valores[Math.min(valores.length - 1, Math.floor(p * valores.length))] ?? 0;
  const cortes = [q(0.25), q(0.5), q(0.75)];
  const nivel = (v: number) => (v <= 0 ? 0 : v <= cortes[0] ? 1 : v <= cortes[1] ? 2 : v <= cortes[2] ? 3 : 4);
  const W = ESQ + 24 * PASSO;
  const H = TOPO + 7 * PASSO;
  const total = valores.reduce((s, v) => s + v, 0);
  let pico = { d: 0, h: 0, v: 0 };
  grade.forEach((linha, d) => linha.forEach((v, h) => { if (v > pico.v) pico = { d, h, v }; }));

  return (
    <div className={className}>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="calendario h-auto w-full min-w-[26rem]" style={{ maxWidth: W * 1.6 }} role="img" aria-label={`${formatarNumero(total)} ${unidade} por dia da semana e hora; pico ${DIAS[pico.d]} às ${pico.h}h`}>
          {[0, 6, 12, 18, 23].map((h) => (
            <text key={h} x={ESQ + h * PASSO + CEL / 2} y={9} textAnchor="middle" fontSize="8.5" fill="var(--ink-faint)" fontFamily="var(--font-geist-mono)">
              {h}h
            </text>
          ))}
          {grade.map((linha, d) => (
            <g key={d}>
              <text x={0} y={TOPO + d * PASSO + CEL - 3} fontSize="8.5" fill="var(--ink-faint)" fontFamily="var(--font-geist-mono)">
                {DIAS[d]}
              </text>
              {linha.map((v, h) => {
                const n = nivel(v);
                return (
                  <rect
                    key={h}
                    className="cel"
                    x={ESQ + h * PASSO}
                    y={TOPO + d * PASSO}
                    width={CEL}
                    height={CEL}
                    rx="2.5"
                    fill={n === 0 ? "var(--surface-2)" : "var(--accent)"}
                    fillOpacity={n === 0 ? 1 : OPACIDADE[n]}
                    stroke="var(--line-soft)"
                    strokeWidth={n === 0 ? 1 : 0}
                  >
                    <title>{`${DIAS[d]}, ${h}h–${h + 1}h: ${v ? `${formatarNumero(v)} ${unidade}` : "nada"}`}</title>
                  </rect>
                );
              })}
            </g>
          ))}
        </svg>
      </div>
      <p className="mt-2 text-[11px] text-ink-faint">
        horário de Brasília{pico.v > 0 ? ` · pico ${DIAS[pico.d]} ${pico.h}h–${pico.h + 1}h (${formatarNumero(pico.v)})` : ""}
      </p>
    </div>
  );
}
