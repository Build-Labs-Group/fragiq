import type { LeituraPublica } from "@/lib/leituras-publicas";
import { cn } from "@/lib/utils";

/**
 * As leituras públicas em cartões: título HUD, o valor grande, uma linha.
 *
 * O tom pinta só o valor (verde/vermelho/neutro); a linha fica em tinta
 * neutra, porque é a prova, não o julgamento. As leituras de posição levam
 * uma faixa de 0 a 100 com o ponto onde a pessoa cai — o mesmo desenho do
 * marcador da distribuição, em miniatura.
 */
export function LeiturasPublicasGrade({ leituras }: { leituras: LeituraPublica[] }) {
  if (leituras.length === 0) return null;
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {leituras.map((l, i) => (
        <li key={l.id} className="entrar rounded-2xl bg-surface p-4 ring-1 ring-line" style={{ "--i": i } as React.CSSProperties}>
          <p className="hud">{l.titulo}</p>
          <p className={cn("num mt-1.5 text-2xl font-semibold capitalize", l.tom === "bom" && "text-good", l.tom === "ruim" && "text-bad")}>{l.valor}</p>
          {l.pct !== undefined && (
            <div className="relative mt-2 h-1.5 rounded-full bg-gradient-to-r from-bad-soft via-surface-2 to-good-soft ring-1 ring-line-soft" aria-hidden>
              <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-surface" style={{ left: `${Math.max(2, Math.min(98, l.pct))}%` }} />
            </div>
          )}
          <p className="mt-2 truncate text-xs text-ink-muted" title={l.linha}>
            {l.linha}
          </p>
        </li>
      ))}
    </ul>
  );
}
