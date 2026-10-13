"use client";

import { Falha } from "@/components/falha";

export default function Erro({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="conteudo" tabIndex={-1}>
      <Falha error={error} reset={reset} />
    </main>
  );
}
