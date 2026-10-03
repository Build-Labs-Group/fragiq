import { Bloco, Carregando, CartaoEsqueleto, HeroEsqueleto } from "@/components/esqueleto";

/**
 * O que aparece entre o clique numa aba e a resposta do servidor. O
 * cabeçalho do jogo e as abas são do layout e continuam na tela; só o
 * conteúdo vira esqueleto — com a forma do Resumo, que é a aba mais aberta.
 */
export default function Loading() {
  return (
    <Carregando>
      <HeroEsqueleto />
      <Bloco className="mt-10 h-3 w-24" />
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <Bloco key={i} className="h-11 rounded-xl" />
        ))}
      </div>
      <Bloco className="mt-10 h-3 w-24" />
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <CartaoEsqueleto key={i} />
        ))}
      </div>
    </Carregando>
  );
}
