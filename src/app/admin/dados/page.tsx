import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { isAdmin } from "@/lib/admin";
import { carregarCobertura } from "@/lib/admin-dados-confiaveis";
import { Secao, Tabela, Tile, dataHora } from "../_pecas";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * O painel de dados: quanto do que está gravado tem modo provado, quem
 * está preso em sessões mistas, e se o que está materializado foi feito
 * pelas regras em vigor (docs/dados-confiaveis.md, fase 5).
 */
export default async function DadosPage() {
  const session = await getSession();
  if (!session) redirect("/");
  if (!isAdmin(session.steamId)) notFound();
  const c = await carregarCobertura();

  const totalRounds = c.porConfianca.reduce((a, x) => a + x.rounds, 0);
  const provados = c.porConfianca.filter((x) => x.confianca !== "MISTA").reduce((a, x) => a + x.rounds, 0);
  const pct = totalRounds ? Math.round((provados / totalRounds) * 100) : 0;
  const atrasados = c.regras.reduce((a, r) => a + r.atrasados, 0) + c.sessoesRegra.atrasadas;

  return (
    <main id="conteudo" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <p className="text-xs text-ink-faint"><Link href="/admin" className="hover:underline">Painel</Link> · Dados · <Link href="/admin/bruto" className="hover:underline">Cru</Link></p>
      <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">Dados</h1>
      <p className="mt-1 text-sm text-ink-muted">Cobertura de modo, regras em vigor e o que está atrás delas.</p>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile rotulo="Rounds com modo provado" valor={`${pct}%`} nota={`${provados} de ${totalRounds} rounds`} alerta={pct < 40} />
        {c.porConfianca.map((x) => (
          <Tile key={x.confianca} rotulo={x.confianca} valor={x.sessoes} nota={`${x.rounds} rounds · ${x.partidas} partidas`} />
        ))}
      </section>

      <Secao titulo="Por jogador" sub="Sessões mistas são as que o cron fechou sem prova de modo; o buraco é o maior intervalo sem coleta.">
        <Tabela
          cabecalho={["Jogador", "Sessões", "Mistas", "Rounds provados", "Última sessão", "Maior buraco"]}
          vazio="Nenhuma sessão materializada."
          linhas={c.porJogador.map((j) => [
            j.persona,
            <span key="s" className="num">{j.sessoes}</span>,
            <span key="m" className={cn("num", j.mistas / Math.max(1, j.sessoes) > 0.5 && "text-warn")}>{j.mistas}</span>,
            <span key="r" className="num">{j.roundsProvados} / {j.rounds}</span>,
            <span key="u" className="whitespace-nowrap text-ink-muted" suppressHydrationWarning>{j.ultima ? dataHora(j.ultima) : "—"}</span>,
            <span key="b" className={cn("num", (j.maiorBuracoH ?? 0) > 48 && "text-warn")}>{j.maiorBuracoH === null ? "—" : `${j.maiorBuracoH} h`}</span>,
          ])}
        />
      </Secao>

      <Secao titulo="Regras" sub={`Versão em vigor de cada regra e o que ainda está em versão antiga (${atrasados} ${atrasados === 1 ? "linha" : "linhas"}). Atrasado = rodar recompute.`}>
        <Tabela
          cabecalho={["Regra", "Escopo", "Versão", "Em dia", "Atrasados"]}
          vazio="Nenhuma regra."
          linhas={[
            ["atribuirModo (sessão)", "SESSAO", <span key="v" className="num">v{c.sessoesRegra.versao}</span>, <span key="e" className="num">{c.sessoesRegra.emDia}</span>, <span key="a" className={cn("num", c.sessoesRegra.atrasadas > 0 && "text-warn")}>{c.sessoesRegra.atrasadas}</span>],
            ...c.regras.map((r) => [
              <span key="r" className="font-mono text-xs">{r.regra}</span>,
              r.escopo,
              <span key="v" className="num">v{r.versao}</span>,
              <span key="e" className="num">{r.emDia}</span>,
              <span key="a" className={cn("num", r.atrasados > 0 && "text-warn")}>{r.atrasados}</span>,
            ]),
          ]}
        />
      </Secao>
    </main>
  );
}
