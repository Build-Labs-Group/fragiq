"use client";

import { Falha } from "@/components/falha";

/** Dentro do jogo o erro fica no lugar do conteúdo: cabeçalho e abas continuam, e dá para trocar de aba. */
export default function Erro({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <Falha error={error} reset={reset} compacto />;
}
