import { CalendarDays, Clapperboard, Infinity as Infinito, Swords, Timer, Users } from "lucide-react";
import type { Recorte, TipoDeRecorte } from "@/lib/recortes";
import { cn } from "@/lib/utils";

/**
 * O chip que diz de onde um número vem (`lib/recortes.ts`).
 *
 * Um ícone por fonte, sempre o mesmo, e o texto em tinta neutra: o chip
 * identifica, não julga — por isso nunca é verde, vermelho ou laranja. O
 * detalhe completo vai no `title` e no texto para leitor de tela.
 */
const ICONE: Record<TipoDeRecorte, typeof Timer> = {
  sessao: Timer,
  partidas: Swords,
  demos: Clapperboard,
  vitalicio: Infinito,
  periodo: CalendarDays,
  comunidade: Users,
};

export function RecorteChip({ recorte, className }: { recorte: Recorte; className?: string }) {
  const Icone = ICONE[recorte.tipo];
  return (
    <span
      className={cn("inline-flex max-w-full items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] whitespace-nowrap text-ink-muted ring-1 ring-line", className)}
      title={recorte.detalhe}
    >
      <Icone className="size-3 shrink-0 text-ink-faint" aria-hidden />
      <span className="truncate">{recorte.rotulo}</span>
      <span className="sr-only">. {recorte.detalhe}</span>
    </span>
  );
}
