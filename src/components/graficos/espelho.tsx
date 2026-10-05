/**
 * Espelho (butterfly): duas colunas de barras que nascem do centro, uma
 * métrica por linha. Para "quem foi melhor em quê" entre dois lados — os
 * dois times de uma partida, duas pessoas num comparativo.
 *
 * Cada linha tem a sua escala (o maior dos dois lados enche a metade): o
 * que se compara é a proporção dentro da linha, nunca uma linha com a outra.
 * O lado que vence a linha fica na cor dele; o outro, apagado. Os valores
 * ficam escritos nas pontas, em tinta neutra.
 */
export type LinhaDeEspelho = {
  rotulo: string;
  a: number;
  b: number;
  formatar: (v: number) => string;
  /** "desce": o menor vence (mortes). Padrão: o maior vence. */
  melhor?: "sobe" | "desce";
};

export function Espelho({
  linhas,
  rotulos,
  cores,
  className,
}: {
  linhas: LinhaDeEspelho[];
  rotulos: [string, string];
  cores: [string, string];
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="mb-2 grid grid-cols-[1fr_7rem_1fr] items-center gap-2 text-[11px] text-ink-muted">
        <span className="inline-flex items-center gap-1.5 justify-self-end">
          {rotulos[0]} <span className="size-2 rounded-sm" style={{ background: cores[0] }} aria-hidden />
        </span>
        <span />
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-sm" style={{ background: cores[1] }} aria-hidden /> {rotulos[1]}
        </span>
      </div>
      <ul className="space-y-1.5">
        {linhas.map((l, i) => {
          const teto = Math.max(l.a, l.b) || 1;
          const venceA = l.melhor === "desce" ? l.a < l.b : l.a > l.b;
          const venceB = l.melhor === "desce" ? l.b < l.a : l.b > l.a;
          return (
            <li key={l.rotulo} className="grid grid-cols-[1fr_7rem_1fr] items-center gap-2" title={`${l.rotulo}: ${rotulos[0]} ${l.formatar(l.a)} · ${rotulos[1]} ${l.formatar(l.b)}`}>
              <span className="flex items-center justify-end gap-2">
                <span className="num text-xs text-ink-muted">{l.formatar(l.a)}</span>
                <span className="flex h-2 w-full max-w-48 justify-end rounded-full bg-surface-2">
                  <span className="espelho-esq h-full rounded-full" style={{ width: `${(l.a / teto) * 100}%`, background: cores[0], opacity: venceA ? 1 : 0.35, "--i": i } as React.CSSProperties} />
                </span>
              </span>
              <span className="hud truncate text-center text-[10px]">{l.rotulo}</span>
              <span className="flex items-center gap-2">
                <span className="flex h-2 w-full max-w-48 rounded-full bg-surface-2">
                  <span className="ranking-barra h-full rounded-full" style={{ width: `${(l.b / teto) * 100}%`, background: cores[1], opacity: venceB ? 1 : 0.35 }} />
                </span>
                <span className="num text-xs text-ink-muted">{l.formatar(l.b)}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
