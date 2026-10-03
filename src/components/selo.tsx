import { cn } from "@/lib/utils";

/**
 * O selo. Três tipos: fundador (entrou entre os cem primeiros), beta
 * (entrou durante o beta) e dev (deixou o GitHub). É pequeno de propósito:
 * é reconhecimento, não medalha.
 */
const SELOS = {
  fundador: { rotulo: "Fundador", classe: "border-accent/50 text-accent" },
  beta: { rotulo: "Beta tester", classe: "border-line text-ink-muted" },
  dev: { rotulo: "Dev", classe: "border-steam/50 text-steam" },
} as const;

export function Selo({ tipo, className }: { tipo: keyof typeof SELOS; className?: string }) {
  const s = SELOS[tipo];
  return (
    <span className={cn("hud rounded-full border px-2 py-0.5 text-[10px]", s.classe, className)}>
      {s.rotulo}
    </span>
  );
}
