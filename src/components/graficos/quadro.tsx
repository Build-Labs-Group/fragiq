import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { Recorte } from "@/lib/recortes";
import { RecorteChip } from "./recorte";
import { cn } from "@/lib/utils";

/**
 * A moldura de todo gráfico do site.
 *
 * Antes cada gráfico tinha a sua: título em lugares diferentes, legenda às
 * vezes no topo, às vezes no rodapé, às vezes nenhuma, e a contagem de
 * pontos ora em cima, ora embaixo. Agora são quatro zonas, sempre nesta
 * ordem: **título e recorte** (o que é, e de onde vem) · **legenda** (só com
 * duas séries ou mais; uma série o título já nomeia) · **o desenho** ·
 * **rodapé** (quantos pontos, desde quando — a escassez declarada).
 */
export type ItemDeLegenda = {
  rotulo: string;
  /** Cor do traço; texto da legenda fica sempre em tinta neutra. */
  cor: string;
  forma?: "linha" | "tracejado" | "barra" | "ponto" | "faixa";
};

export function Quadro({
  titulo,
  recorte,
  legenda,
  rodape,
  href,
  className,
  children,
  extra,
}: {
  titulo: string;
  recorte?: Recorte | null;
  legenda?: ItemDeLegenda[];
  rodape?: React.ReactNode;
  href?: string;
  className?: string;
  children: React.ReactNode;
  /** Algo à direita do título (um total, um seletor). */
  extra?: React.ReactNode;
}) {
  return (
    <figure className={cn("group/quadro min-w-0 rounded-2xl bg-surface p-4 ring-1 ring-line sm:p-5", href && "transition hover:ring-accent/50", className)}>
      <figcaption className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {href ? (
          <Link href={href} className="hud inline-flex items-center gap-1 hover:text-ink">
            {titulo}
            <ArrowUpRight className="size-3 opacity-0 transition group-hover/quadro:opacity-100" aria-hidden />
          </Link>
        ) : (
          <span className="hud">{titulo}</span>
        )}
        {recorte && <RecorteChip recorte={recorte} />}
        {extra && <span className="tnum ml-auto text-xs text-ink-faint">{extra}</span>}
      </figcaption>
      {legenda && legenda.length > 1 && <Legenda itens={legenda} className="mt-2" />}
      <div className="mt-3">{children}</div>
      {rodape && <p className="num mt-2 text-[11px] text-ink-faint">{rodape}</p>}
    </figure>
  );
}

export function Legenda({ itens, className }: { itens: ItemDeLegenda[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-muted", className)}>
      {itens.map((i) => (
        <li key={i.rotulo} className="inline-flex items-center gap-1.5">
          <Amostra cor={i.cor} forma={i.forma ?? "linha"} />
          {i.rotulo}
        </li>
      ))}
    </ul>
  );
}

function Amostra({ cor, forma }: { cor: string; forma: NonNullable<ItemDeLegenda["forma"]> }) {
  return (
    <svg viewBox="0 0 16 8" className="h-2 w-4 shrink-0" aria-hidden>
      {forma === "linha" && <line x1="1" x2="15" y1="4" y2="4" stroke={cor} strokeWidth="2" strokeLinecap="round" />}
      {forma === "tracejado" && <line x1="1" x2="15" y1="4" y2="4" stroke={cor} strokeWidth="1.5" strokeDasharray="3 2" />}
      {forma === "barra" && <rect x="3" y="0" width="10" height="8" rx="2" fill={cor} />}
      {forma === "ponto" && <circle cx="8" cy="4" r="3.5" fill={cor} />}
      {forma === "faixa" && <rect x="0" y="1" width="16" height="6" rx="1" fill={cor} opacity="0.35" />}
    </svg>
  );
}
