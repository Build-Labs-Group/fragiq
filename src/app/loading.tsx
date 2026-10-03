import { Bloco, Carregando, CartaoEsqueleto, HeroEsqueleto } from "@/components/esqueleto";

/**
 * Esqueleto de qualquer página enquanto o servidor responde — inclusive a
 * primeira entrada no jogo, quando o layout (cabeçalho e abas) ainda está
 * lendo o banco. Tem a forma do cabeçalho do site e de um painel.
 */
export default function Loading() {
  return (
    <Carregando>
      <div className="border-b border-line/60">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3.5 sm:px-6">
          <Bloco className="h-5 w-16" />
          <Bloco className="h-7 w-12" />
          <Bloco className="ml-auto h-8 w-28" />
        </div>
      </div>
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <Bloco className="mb-8 h-6 w-48" />
        <HeroEsqueleto />
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <CartaoEsqueleto key={i} />
          ))}
        </div>
      </div>
    </Carregando>
  );
}
