import { Suspense } from "react";
import Image from "next/image";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { progressoDosPrimeirosPassos } from "@/lib/primeiros-passos";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { gameHeaderUrl } from "@/lib/steam/api";
import { formatPlaytime } from "@/lib/stats";
import { isAdmin, seloDe } from "@/lib/admin";
import { SiteHeader } from "@/components/site-header";
import { NavJogo } from "@/components/nav-jogo";
import { botEhAmigo } from "@/lib/bot";
import { COOKIE_MODO } from "@/lib/modo";
import { lenteDoUsuario } from "@/lib/modo-servidor";

/**
 * Cabeçalho do jogo e as abas, uma vez só, para todas as áreas.
 *
 * O que muda entre Resumo, Estatísticas, Sessões, Métricas e Analista é o
 * conteúdo; o nome do jogo, as horas e o menu são a mesma coisa em todas —
 * e ficam aqui para que trocar de aba não redesenhe a página inteira.
 *
 * A lente de modo fica na linha das abas e vale para todas elas; o que
 * falta compartilhar na Steam aparece onde o dado falta (linha de
 * cobertura, rodapé de cartão, onboarding), não num aviso repetido.
 */
export default async function GameLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ appId: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/");

  const appId = Number((await params).appId);
  if (!Number.isInteger(appId)) notFound();

  const [user, userGame, selo, lente, jar, passos] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.userId },
      select: { personaName: true, avatarUrl: true, lastSyncedAt: true, steamId: true },
    }),
    prisma.userGame.findUnique({
      where: { userId_gameAppId: { userId: session.userId, gameAppId: appId } },
      select: {
        playtimeForeverMin: true,
        playtimeTwoWeeksMin: true,
        game: { select: { name: true } },
        _count: { select: { snapshots: true } },
      },
    }),
    seloDe(session.userId),
    lenteDoUsuario(session.userId, appId),
    cookies(),
    progressoDosPrimeirosPassos(session.userId),
  ]);
  if (!user) redirect("/");

  return (
    <>
      <SiteHeader {...user} admin={isAdmin(session.steamId)} selo={selo} passos={passos} />

      {userGame ? (
        <>
          <div className="border-b border-line bg-surface">
            <div className="mx-auto max-w-6xl px-4 sm:px-6">
              <div className="flex items-center gap-4 pt-6">
                <Image
                  src={gameHeaderUrl(appId)}
                  alt=""
                  width={92}
                  height={43}
                  className="hidden rounded-md sm:block"
                  unoptimized
                />
                <div className="min-w-0">
                  <h1 className="text-lg font-semibold tracking-tight sm:text-xl">
                    {userGame.game.name}
                  </h1>
                  <p className="tnum text-sm text-ink-muted">
                    {formatPlaytime(userGame.playtimeForeverMin)}
                    {userGame.playtimeTwoWeeksMin > 0 && (
                      <> · {formatPlaytime(userGame.playtimeTwoWeeksMin)} em 2 semanas</>
                    )}
                    {" · "}
                    {userGame._count.snapshots} coleta{userGame._count.snapshots === 1 ? "" : "s"}
                  </p>
                </div>
              </div>
              <div className="mt-4">
                <Suspense>
                  <NavJogo appId={appId} abas={lente.abas} cobertura={lente.cobertura} doCookie={jar.get(COOKIE_MODO)?.value} botAmigo={appId === 730 ? await botEhAmigo(session.steamId) : true} />
                </Suspense>
              </div>
            </div>
          </div>
          <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
        </>
      ) : (
        children
      )}
    </>
  );
}
