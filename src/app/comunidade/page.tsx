import Image from "next/image";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { SteamMark } from "@/components/steam-mark";
import { Participar } from "@/components/participar";
import { PerfilPublicoToggle } from "@/components/perfil-publico-toggle";
import { Selo } from "@/components/selo";

export const dynamic = "force-dynamic";

/**
 * Comunidade: quem constrói o FragIQ junto.
 *
 * Pública para ler, login para entrar. Três coisas: como participar, quem
 * já participa, e o que essas pessoas disseram em público. O selo de beta
 * tester é o reconhecimento — aparece aqui e no cabeçalho de quem tem.
 */
export default async function ComunidadePage() {
  const session = await getSession();

  const [testers, feedbacks, eu, conta] = await Promise.all([
    // Todo mundo que entrou no beta, do primeiro ao último; quem pediu para
    // não aparecer some da lista, mas o selo continua sendo dele.
    prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        personaName: true,
        avatarUrl: true,
        steamId: true,
        createdAt: true,
        participant: { select: { githubLogin: true, papeis: true, mensagem: true, visivel: true } },
      },
    }),
    prisma.feedback.findMany({
      where: { publico: true },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, message: true, createdAt: true, user: { select: { personaName: true, avatarUrl: true } } },
    }),
    session
      ? prisma.participant.findUnique({
          where: { userId: session.userId },
          select: { githubLogin: true, papeis: true, mensagem: true, visivel: true },
        })
      : null,
    session
      ? prisma.user.findUnique({ where: { id: session.userId }, select: { perfilPublico: true, steamId: true } })
      : null,
  ]);

  const visiveis = testers
    .map((t, ordem) => ({ ...t, ordem }))
    .filter((t) => t.participant?.visivel !== false);

  return (
    <main className="mx-auto max-w-6xl px-6 py-12 sm:py-16">
      <Link href={session ? "/cs2" : "/"} className="inline-flex items-center gap-1.5 text-sm text-ink-muted transition hover:text-accent">
        <ArrowLeft className="size-4" /> FragIQ
      </Link>

      <section className="mt-10 grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:items-start">
        <div>
          <p className="hud">Comunidade</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Construído com quem joga.
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-ink-muted">
            O FragIQ é beta aberto. Quem testa, desenvolve ou traz
            dados entra aqui — com selo no perfil e voz no que vem depois.
          </p>

          <ul className="mt-8 space-y-4">
            <Beneficio titulo="Selo de beta tester" texto="No cabeçalho e nesta página, permanente para quem entrou no beta." />
            <Beneficio titulo="Voz no roadmap" texto="O que a comunidade pede vem antes do que a gente acha." />
            <Beneficio titulo="Convite ao repositório" texto="Para quem deixa o GitHub: issues abertas, PRs bem-vindos." />
          </ul>
        </div>

        <div>
          {session && conta ? (
            <div className="space-y-4">
              <Participar inicial={eu} />
              <PerfilPublicoToggle publico={conta.perfilPublico} steamId={conta.steamId} />
            </div>
          ) : (
            <div className="rounded-2xl bg-surface p-6 ring-1 ring-line">
              <p className="text-sm text-ink-muted">Entrou no beta? Você já é beta tester. Entre com a Steam para completar o perfil.</p>
              <a
                href="/api/auth/steam"
                className="borda-viva mt-4 inline-flex items-center gap-3 rounded-xl px-5 py-3 font-medium text-ink transition hover:text-accent"
              >
                <SteamMark />
                Entrar com Steam
              </a>
            </div>
          )}
        </div>
      </section>

      <section className="mt-16">
        <div className="flex items-baseline gap-3">
          <h2 className="hud">Beta testers</h2>
          <span className="num text-xs text-ink-faint">{testers.length}</span>
        </div>
        {visiveis.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-dashed border-line px-6 py-10 text-center text-sm text-ink-faint">
            Ninguém ainda. A primeira pessoa fica no topo desta lista para sempre.
          </p>
        ) : (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visiveis.map((p) => (
              <li key={p.steamId} className="rounded-2xl bg-surface p-4 ring-1 ring-line">
                <div className="flex items-center gap-3">
                  {p.avatarUrl ? (
                    <Image src={p.avatarUrl} alt="" width={40} height={40} className="size-10 rounded-full ring-1 ring-line" unoptimized />
                  ) : (
                    <span className="size-10 rounded-full bg-surface-2" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p.personaName}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Selo tipo={p.ordem < 100 ? "fundador" : "beta"} />
                      {p.participant?.githubLogin && <Selo tipo="dev" />}
                    </div>
                  </div>
                  {p.participant?.githubLogin && (
                    <a
                      href={`https://github.com/${p.participant.githubLogin}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`GitHub de ${p.personaName}`}
                      className="text-ink-faint transition hover:text-ink"
                    >
                      <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
                        <path d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.6-1.4-1.4-1.8-1.4-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5z" />
                      </svg>
                    </a>
                  )}
                </div>
                {p.participant?.mensagem && (
                  <p className="mt-3 text-sm leading-relaxed text-ink-muted">{p.participant.mensagem}</p>
                )}
                <p className="mt-3 text-[11px] text-ink-faint">
                  {p.participant?.papeis.length ? `${p.participant.papeis.join(" · ")} · ` : ""}
                  #{p.ordem + 1} · desde{" "}
                  {p.createdAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-16">
        <h2 className="hud">Feedback público</h2>
        {feedbacks.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-dashed border-line px-6 py-10 text-center text-sm text-ink-faint">
            Nenhum ainda. O botão de feedback no app tem a opção de publicar aqui.
          </p>
        ) : (
          <ol className="mt-4 divide-y divide-line-soft rounded-2xl bg-surface ring-1 ring-line">
            {feedbacks.map((f) => (
              <li key={f.id} className="flex gap-4 px-5 py-4">
                {f.user.avatarUrl ? (
                  <Image src={f.user.avatarUrl} alt="" width={28} height={28} className="size-7 shrink-0 rounded-full ring-1 ring-line" unoptimized />
                ) : (
                  <span className="size-7 shrink-0 rounded-full bg-surface-2" />
                )}
                <div className="min-w-0">
                  <p className="text-xs text-ink-faint">
                    <span className="font-medium text-ink-muted">{f.user.personaName}</span> ·{" "}
                    {f.createdAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "")}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap">{f.message}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}

function Beneficio({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <li className="flex gap-3">
      <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
      <span>
        <span className="block text-sm font-medium">{titulo}</span>
        <span className="block text-sm text-ink-muted">{texto}</span>
      </span>
    </li>
  );
}
