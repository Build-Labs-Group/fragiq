"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCw } from "lucide-react";

/**
 * O que a pessoa vê quando uma tela quebra no servidor — banco fora do ar,
 * Steam lenta, um bug. Sem isto o Next mostra a página de erro dele, em
 * inglês e sem saída. Aqui: o que aconteceu em uma linha, tentar de novo
 * (que refaz só o trecho que falhou) e um caminho para casa. O `digest` é
 * o id que aparece nos logs do servidor (CloudWatch da Lambda `fragiq-site`),
 * para quem for reportar.
 */
export function Falha({ error, reset, compacto = false }: { error: Error & { digest?: string }; reset: () => void; compacto?: boolean }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div role="alert" className={compacto ? "rounded-2xl border border-dashed border-line px-6 py-10 text-center" : "mx-auto max-w-md px-6 py-24 text-center"}>
      <p className="hud">algo falhou</p>
      <p className="mt-2 text-lg font-semibold tracking-tight">Não conseguimos montar esta tela agora.</p>
      <p className="mt-1.5 text-sm text-ink-muted">Seus dados estão guardados — costuma ser momentâneo.</p>
      <div className="mt-5 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-canvas transition hover:opacity-90"
        >
          <RotateCw className="size-4" aria-hidden />
          Tentar de novo
        </button>
        <Link href="/games/730" className="text-sm text-ink-muted underline decoration-line underline-offset-4 hover:text-ink">
          Ir para o CS2
        </Link>
      </div>
      {error.digest && <p className="tnum mt-6 text-xs text-ink-faint">código {error.digest}</p>}
    </div>
  );
}
