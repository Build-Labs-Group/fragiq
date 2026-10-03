import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { listarPartidas, shareCodeConhecido } from "@/lib/partidas";
import { AtivarPartidas, PAGINA_STEAM } from "@/components/ativar-partidas";
import { PartidasTabela } from "@/components/partidas-tabela";
import { Estado } from "@/components/estado";
import { filtroDoModo, rotuloDoModo, TUDO } from "@/lib/modo";
import { abasDoUsuario, modoDaRequisicao, type SearchParams } from "@/lib/modo-servidor";

export const dynamic = "force-dynamic";

/**
 * Partidas oficiais, uma a uma — o que a Web API não dá.
 *
 * Sem a corrente ligada a página é o convite: por que vale, o que a Steam
 * pede e a garantia do que NÃO abrimos. Com ela ligada, é a tabela, mais o
 * estado da fila (o bot pergunta ao GC em até um minuto) e o erro, se a
 * Steam parou de aceitar o código.
 */
export default async function PartidasPage({ params, searchParams }: { params: Promise<{ appId: string }>; searchParams: SearchParams }) {
  const session = await requireSession();
  const appId = Number((await params).appId);
  if (appId !== 730) notFound();
  const modo = await modoDaRequisicao(searchParams, await abasDoUsuario(session.userId, appId));

  const [user, partidas, pendentes, temShare] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.userId },
      select: { partidasAtivadasEm: true, partidasErro: true },
    }),
    listarPartidas(session.steamId, 50, filtroDoModo(modo)?.mode),
    prisma.match.count({ where: { status: "PENDING", descobertaPorId: session.userId } }),
    shareCodeConhecido(session.userId, session.steamId).then(Boolean),
  ]);
  const ativo = Boolean(user?.partidasAtivadasEm);
  const ligou = ativo ? Number((await searchParams)?.ligou) : NaN;

  if (!ativo && partidas.length === 0 && modo === TUDO) {
    return (
      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <section className="rounded-2xl bg-surface p-6 ring-1 ring-line">
          <p className="hud">Partidas oficiais</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight">Cada partida com placar e os dez jogadores.</h2>
          <p className="mt-3 text-sm text-ink-muted">Dois códigos de uma mesma página da Steam, colados uma vez.</p>
          <ul className="mt-4 space-y-1.5 text-sm text-ink-muted">
            <li>· Só histórico de partidas</li>
            <li>· Cifrado; revogável aqui</li>
            <li>· FACEIT e Gamers Club não entram</li>
          </ul>
        </section>
        <section className="rounded-2xl bg-surface p-6 ring-1 ring-line">
          <AtivarPartidas />
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {Number.isInteger(ligou) && ligou >= 0 && !user?.partidasErro && (
        <div className="rounded-2xl bg-accent/5 p-4 text-sm ring-1 ring-accent/30">
          <p className="font-medium text-accent">Partidas oficiais ligadas.</p>
          <p className="mt-1 text-ink-muted">
            {ligou > 0
              ? `A Steam já devolveu ${ligou} ${ligou === 1 ? "partida nova" : "partidas novas"}; o placar de cada uma chega em até um minuto.`
              : "Começamos pela sua partida mais recente que conhecemos: o placar dela chega em até um minuto, e as próximas entram sozinhas."}
          </p>
        </div>
      )}
      {user?.partidasErro && (
        <div className="rounded-2xl border border-danger/30 bg-danger/10 p-4 text-sm">
          <p className="font-medium text-danger">A corrente parou.</p>
          <p className="mt-1 text-ink-muted">{user.partidasErro}</p>
          <div className="mt-3">
            <AtivarPartidas compacto religar={temShare} />
          </div>
        </div>
      )}
      {!ativo && partidas.length > 0 && (
        <div className="rounded-2xl bg-surface p-4 text-sm ring-1 ring-line">
          <p className="text-ink-muted">
            Estas partidas chegaram pela corrente de outras pessoas do FragIQ que jogaram com você. Para receber
            todas as suas, ligue a sua:
          </p>
          <div className="mt-3">
            <AtivarPartidas compacto religar={temShare} />
          </div>
        </div>
      )}
      {pendentes > 0 && (
        <p className="text-sm text-ink-muted">
          <span className="text-accent">{pendentes}</span> {pendentes === 1 ? "partida na fila" : "partidas na fila"} — o bot
          pergunta ao Game Coordinator em até um minuto. Recarregue a página em instantes.
        </p>
      )}
      {partidas.length === 0 ? (
        <Estado
          titulo={pendentes > 0 ? "Buscando o scoreboard" : modo === TUDO ? "Nenhuma partida ainda" : `Nenhuma partida em ${rotuloDoModo(modo)}`}
          texto={pendentes > 0 ? "O bot pergunta ao Game Coordinator em até um minuto." : modo === TUDO ? "A próxima que você jogar entra depois da coleta." : "Partidas sem modo conhecido ficam em Tudo."}
          acao={modo === TUDO ? undefined : { rotulo: "Ver todas", href: `/games/${appId}/partidas` }}
        />
      ) : (
        <PartidasTabela partidas={partidas} />
      )}
      {ativo && (
        <p className="text-xs text-ink-faint">
          Corrente ligada · <Link href="/seguranca" className="underline decoration-line hover:text-ink">Revogar</Link>
          {" · "}
          <a href={PAGINA_STEAM} target="_blank" rel="noreferrer" className="underline decoration-line hover:text-ink">
            gerar outro código
          </a>
        </p>
      )}
    </div>
  );
}
