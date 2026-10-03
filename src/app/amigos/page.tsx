import Image from "next/image";
import Link from "next/link";
import { progressoDosPrimeirosPassos } from "@/lib/primeiros-passos";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { isAdmin, seloDe } from "@/lib/admin";
import { amigosNoFragiq, quemMeSegue, quemSigo, type Pessoa } from "@/lib/social";
import { SiteHeader } from "@/components/site-header";
import { SeguirBotao } from "@/components/seguir-botao";

export const dynamic = "force-dynamic";

/**
 * Amigos: quem da sua lista da Steam já está aqui, quem você segue e quem
 * te segue.
 *
 * A fila de pedidos saiu com a aprovação: seguir é imediato, então não há
 * nada para julgar. Sobraram duas perguntas — "com quem eu jogo que está
 * aqui?" e "quem é o meu círculo?" — e uma seção para cada.
 *
 * A lista de amigos vem da Steam e só aparece para você; o que se mostra
 * dela é a interseção com quem tem conta — ninguém descobre por aqui quem
 * são os seus amigos que não entraram.
 */
export default async function AmigosPage() {
  const session = await requireSession();
  const [user, selo, amigos, sigo, seguem, passos] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.userId },
      select: { personaName: true, avatarUrl: true, lastSyncedAt: true, steamId: true, curvaVisivel: true },
    }),
    seloDe(session.userId),
    amigosNoFragiq(session.userId, session.steamId),
    quemSigo(session.userId),
    quemMeSegue(session.userId),
    progressoDosPrimeirosPassos(session.userId),
  ]);
  if (!user) return null;

  return (
    <>
      <SiteHeader {...user} admin={isAdmin(session.steamId)} selo={selo} passos={passos} />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Amigos</h1>
          <p className="text-xs text-ink-faint">
            {user.curvaVisivel ? "Quem te segue vê a sua curva." : "A sua curva está fechada para seguidores."}{" "}
            <Link href="/configuracoes" className="text-accent hover:underline">mudar</Link>
          </p>
        </div>

        <Secao titulo="Da sua lista da Steam" n={amigos.amigos.length}>
          {amigos.leituraFalhou ? (
            <Vazio texto="Não deu para ler a sua lista de amigos da Steam agora. Tente de novo em alguns minutos; quem você segue e quem te segue está logo abaixo." />
          ) : amigos.listaPrivada ? (
            <Vazio texto="Sua lista de amigos está privada na Steam. Em Editar perfil → Privacidade, deixe 'Lista de amigos' pública e volte aqui." />
          ) : amigos.amigos.length === 0 ? (
            <Vazio texto={`Nenhum dos seus ${amigos.totalAmigos} amigos entrou ainda.`} />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {amigos.amigos.map((a) => (
                <Cartao key={a.id} pessoa={a} nota={a.meSegue ? "te segue" : undefined}>
                  {a.estado === "seguindo" ? (
                    <SeguirBotao steamId={a.steamId} acao="deixar" rotulo="Seguindo" />
                  ) : (
                    <SeguirBotao steamId={a.steamId} acao="seguir" rotulo="Seguir" primario />
                  )}
                  <Link href={`/p/${session.steamId}/vs/${a.steamId}`} className={BOTAO}>
                    Comparar
                  </Link>
                </Cartao>
              ))}
            </ul>
          )}
        </Secao>

        <div className="grid gap-8 lg:grid-cols-2">
          <Secao titulo="Seguindo" n={sigo.length}>
            {sigo.length === 0 ? (
              <Vazio texto="Ninguém ainda. Siga alguém na página pública dessa pessoa." />
            ) : (
              <ul className="grid gap-3">
                {sigo.map((p) => (
                  <Cartao key={p.id} pessoa={p}>
                    <Link href={`/p/${p.steamId}`} className={BOTAO}>Ver perfil</Link>
                    <SeguirBotao steamId={p.steamId} acao="deixar" rotulo="Deixar de seguir" />
                  </Cartao>
                ))}
              </ul>
            )}
          </Secao>
          <Secao titulo="Seguidores" n={seguem.length}>
            {seguem.length === 0 ? (
              <Vazio texto="Ninguém ainda." />
            ) : (
              <ul className="grid gap-3">
                {seguem.map((p) => (
                  <Cartao key={p.id} pessoa={p}>
                    <Link href={`/p/${p.steamId}`} className={BOTAO}>Ver perfil</Link>
                    <SeguirBotao steamId={p.steamId} acao="remover" rotulo="Remover" />
                  </Cartao>
                ))}
              </ul>
            )}
          </Secao>
        </div>
      </main>
    </>
  );
}

const BOTAO =
  "rounded-lg bg-surface px-3 py-1.5 text-sm text-ink-muted ring-1 ring-line transition hover:text-ink hover:ring-accent/60";

function Secao({ titulo, n, children }: { titulo: string; n: number; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <div className="mb-3 flex items-baseline gap-3">
        <h2 className="hud">{titulo}</h2>
        <span className="num text-xs text-ink-faint">{n}</span>
      </div>
      {children}
    </section>
  );
}

function Cartao({ pessoa, nota, children }: { pessoa: Pessoa; nota?: string; children: React.ReactNode }) {
  return (
    <li className="rounded-2xl bg-surface p-4 ring-1 ring-line">
      <Link href={`/p/${pessoa.steamId}`} className="flex items-center gap-3">
        {pessoa.avatarUrl ? (
          <Image src={pessoa.avatarUrl} alt="" width={40} height={40} className="size-10 rounded-full ring-1 ring-line" unoptimized />
        ) : (
          <span className="size-10 rounded-full bg-surface-2" />
        )}
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{pessoa.personaName}</span>
          {nota && <span className="block text-xs text-ink-faint">{nota}</span>}
        </span>
      </Link>
      <div className="mt-3 flex flex-wrap gap-2">{children}</div>
    </li>
  );
}

function Vazio({ texto }: { texto: string }) {
  return <p className="rounded-2xl border border-dashed border-line px-6 py-8 text-center text-sm text-ink-faint">{texto}</p>;
}
