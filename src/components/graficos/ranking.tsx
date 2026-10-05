import Link from "next/link";
import type { Valencia } from "@/lib/delta";
import { cn } from "@/lib/utils";

/**
 * Ranking: uma linha por item (mapa, arma, jogador), barra horizontal fina.
 *
 * O formato para "qual é o meu melhor/pior X": rótulo à esquerda, a barra
 * no meio, o valor e a amostra à direita, sempre nas mesmas colunas. A
 * referência, quando há, é o mesmo traço da régua — a mesma linha vertical
 * em todas as barras, para os olhos compararem sem ler números. A amostra
 * pequena (`fraco`) apaga a barra: o número fica, a confiança não.
 */
export type LinhaDeRanking = {
  id: string;
  rotulo: string;
  icone?: React.ReactNode;
  valor: number;
  texto: string;
  /** "12 rounds", "7–6": sobre o que o valor se apoia. */
  base?: string;
  valencia?: Valencia | null;
  fraco?: boolean;
  href?: string;
};

export function Ranking({
  linhas,
  escala,
  referencia,
  rotuloReferencia,
  className,
}: {
  linhas: LinhaDeRanking[];
  /** Teto da barra; padrão, o maior valor (ou a referência). */
  escala?: number;
  referencia?: number | null;
  rotuloReferencia?: string;
  className?: string;
}) {
  const teto = escala ?? (Math.max(...linhas.map((l) => l.valor), referencia ?? 0) || 1);
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / teto) * 100))}%`;

  return (
    <div className={className}>
      <ul className="space-y-1">
        {linhas.map((l) => {
          const cor = l.valencia === "good" ? "var(--good)" : l.valencia === "bad" ? "var(--bad)" : "var(--accent)";
          const conteudo = (
            <>
              <span className="flex min-w-0 items-center gap-2 text-sm">
                {l.icone}
                <span className="truncate">{l.rotulo}</span>
              </span>
              <span className="relative h-1.5 rounded-full bg-surface-2" aria-hidden>
                <span className="ranking-barra absolute inset-y-0 left-0 rounded-full" style={{ width: pct(l.valor), background: cor, opacity: l.fraco ? 0.35 : 1 }} />
                {referencia != null && <span className="absolute -inset-y-1 w-px bg-ink/70" style={{ left: pct(referencia) }} />}
              </span>
              <span className="num text-right text-sm">{l.texto}</span>
              <span className="tnum hidden text-right text-[11px] text-ink-faint sm:block">{l.base}</span>
            </>
          );
          const classe = "grid grid-cols-[minmax(0,8.5rem)_1fr_3.5rem] items-center gap-3 rounded-lg px-2 py-1.5 sm:grid-cols-[minmax(0,9rem)_1fr_3.5rem_5.5rem]";
          return (
            <li key={l.id} title={[l.rotulo, l.texto, l.base, l.fraco ? "amostra pequena" : null].filter(Boolean).join(" · ")}>
              {l.href ? (
                <Link href={l.href} className={cn(classe, "transition hover:bg-surface-2")}>
                  {conteudo}
                </Link>
              ) : (
                <div className={classe}>{conteudo}</div>
              )}
            </li>
          );
        })}
      </ul>
      {referencia != null && rotuloReferencia && (
        <p className="mt-2 flex items-center gap-1.5 px-2 text-[11px] text-ink-faint">
          <span className="inline-block h-3 w-px bg-ink/70" aria-hidden /> {rotuloReferencia}
        </p>
      )}
    </div>
  );
}
