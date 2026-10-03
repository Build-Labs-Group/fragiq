import { cn } from "@/lib/utils";

/**
 * Peças de esqueleto para os `loading.tsx`: a mesma geometria dos blocos
 * reais (hero, cartão, tabela), para que a troca pelo conteúdo não mova
 * nada. Nenhum número, nenhum texto inventado — só a forma.
 */
export function Bloco({ className }: { className?: string }) {
  return <div className={cn("esqueleto", className)} aria-hidden />;
}

export function CartaoEsqueleto({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-2xl bg-surface p-5 ring-1 ring-line", className)} aria-hidden>
      <Bloco className="h-3 w-24" />
      <Bloco className="mt-4 h-8 w-28" />
      <Bloco className="mt-3 h-3 w-20" />
      <Bloco className="mt-5 h-10 w-full" />
      <Bloco className="mt-4 h-3 w-36" />
    </div>
  );
}

export function HeroEsqueleto() {
  return (
    <div className="rounded-2xl bg-surface p-5 ring-1 ring-line sm:p-7" aria-hidden>
      <Bloco className="h-3 w-40" />
      <div className="mt-6 grid grid-cols-3 gap-4 sm:gap-6">
        {[0, 1, 2].map((i) => (
          <div key={i}>
            <Bloco className="h-3 w-16" />
            <Bloco className="mt-3 h-12 w-24 sm:w-32" />
            <Bloco className="mt-3 h-3 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function TabelaEsqueleto({ linhas = 8 }: { linhas?: number }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-surface ring-1 ring-line" aria-hidden>
      <div className="px-4 py-3">
        <Bloco className="h-3 w-full max-w-md" />
      </div>
      {Array.from({ length: linhas }, (_, i) => (
        <div key={i} className="flex items-center gap-4 border-t border-line-soft px-4 py-3">
          <Bloco className="h-4 w-28" />
          <Bloco className="h-4 flex-1" />
          <Bloco className="h-4 w-12" />
        </div>
      ))}
    </div>
  );
}

/** Rótulo acessível: quem usa leitor de tela ouve que a página está carregando. */
export function Carregando({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Carregando…</span>
      {children}
    </div>
  );
}
