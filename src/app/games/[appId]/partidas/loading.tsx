import { Carregando, TabelaEsqueleto } from "@/components/esqueleto";

/** Listas carregam com a forma de lista, não com a do Resumo. */
export default function Loading() {
  return (
    <Carregando>
      <TabelaEsqueleto linhas={10} />
    </Carregando>
  );
}
