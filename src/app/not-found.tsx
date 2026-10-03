import Link from "next/link";

/** 404 no tom do site, em vez da página padrão do Next. */
export default function NaoEncontrada() {
  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-md flex-col items-center justify-center px-6 text-center">
      <p className="num text-6xl font-semibold text-accent">404</p>
      <p className="mt-3 text-lg font-semibold tracking-tight">Esta página não existe.</p>
      <p className="mt-1.5 text-sm text-ink-muted">O link pode ter mudado, ou a partida ainda não chegou.</p>
      <Link href="/games/730" className="mt-5 text-sm text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-accent">
        Voltar para o CS2
      </Link>
    </div>
  );
}
