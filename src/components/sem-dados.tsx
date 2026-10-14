import { PrimeirosPassos } from "./primeiros-passos";

/**
 * Um usuário novo cujo perfil está restrito, ou que ainda não jogou CS2,
 * cairia num 404 — o que parece defeito do site em vez de estado do dado.
 * Em vez disso, os primeiros passos, com o que falta em aberto.
 */
export function SemDados({ botAmigo }: { botAmigo: boolean | null }) {
  return (
    <main id="conteudo" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
        Ainda não encontramos seu Counter-Strike 2
      </h1>
      <p className="mt-2 max-w-xl text-sm text-ink-muted">
        Quase sempre é a privacidade da Steam. Se o perfil já estiver público e isto continuar,
        pode ser que a conta ainda não tenha partidas registradas de CS2.
      </p>
      <div className="mt-6">
        <PrimeirosPassos statsVisiveis={false} botAmigo={botAmigo} coletas={0} partidasAtivas={false} />
      </div>
    </main>
  );
}
