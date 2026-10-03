import { Bloco, Carregando, TabelaEsqueleto } from "@/components/esqueleto";

/** A forma da partida: título e placar, a faixa dos rounds e os dois times. */
export default function Loading() {
  return (
    <Carregando>
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex items-end justify-between gap-6">
          <div>
            <Bloco className="h-3 w-48" />
            <Bloco className="mt-3 h-8 w-40" />
          </div>
          <Bloco className="h-12 w-32" />
        </div>
        <Bloco className="mt-8 h-40 w-full rounded-2xl" />
        <div className="mt-8 grid gap-6">
          <TabelaEsqueleto linhas={5} />
          <TabelaEsqueleto linhas={5} />
        </div>
      </div>
    </Carregando>
  );
}
