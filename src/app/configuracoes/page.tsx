import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Download, ExternalLink } from "lucide-react";
import { progressoDosPrimeirosPassos } from "@/lib/primeiros-passos";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { isAdmin, seloDe } from "@/lib/admin";
import { botEhAmigo } from "@/lib/bot";
import { SiteHeader } from "@/components/site-header";
import { Selo } from "@/components/selo";
import { BotAmigo } from "@/components/bot-amigo";
import { ApagarConta } from "@/components/apagar-conta";
import { PerfilPublicoToggle } from "@/components/perfil-publico-toggle";
import { CurvaVisivelToggle } from "@/components/curva-visivel-toggle";
import { AvisoSteamToggle } from "@/components/aviso-steam-toggle";
import { PartidasRevogar } from "@/components/partidas-revogar";
import { AtivarPartidas, PAGINA_STEAM } from "@/components/ativar-partidas";
import { shareCodeConhecido } from "@/lib/partidas";

export const dynamic = "force-dynamic";

/**
 * Configurações: tudo que a pessoa liga, desliga ou cola, num lugar só.
 *
 * Estava espalhado por três telas. Os dois códigos da Steam ficavam numa
 * aba do CS2 (Partidas), os interruptores no fim de uma página sobre
 * privacidade (Segurança), e o bot numa âncora no meio dela. Quem queria
 * "mexer numa configuração" tinha que saber de antemão qual das três era.
 *
 * A divisão com `/seguranca` passa a ser a óbvia: lá se **lê** o que o site
 * faz com os dados (um texto, que não muda por pessoa); aqui se **mexe**.
 * Cada bloco diz o estado atual antes de oferecer o controle, porque um
 * interruptor sem estado obriga a lembrar o que estava valendo.
 */
export default async function ConfiguracoesPage() {
  const session = await getSession();
  if (!session) redirect("/");

  const [user, selo, amigo, seguidores, temShare, passos] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.userId },
      select: {
        personaName: true,
        avatarUrl: true,
        profileUrl: true,
        steamId: true,
        lastSyncedAt: true,
        createdAt: true,
        perfilPublico: true,
        curvaVisivel: true,
        avisoSteam: true,
        partidasAtivadasEm: true,
        partidasErro: true,
      },
    }),
    seloDe(session.userId),
    botEhAmigo(session.steamId),
    prisma.follow.count({ where: { seguidoId: session.userId } }),
    shareCodeConhecido(session.userId, session.steamId).then(Boolean),
    progressoDosPrimeirosPassos(session.userId),
  ]);
  if (!user) redirect("/");
  const ativo = Boolean(user.partidasAtivadasEm);

  return (
    <div className="min-h-dvh">
      <SiteHeader {...user} admin={isAdmin(session.steamId)} selo={selo} passos={passos} />

      <main id="conteudo" tabIndex={-1} className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Configurações</h1>
        <p className="mt-1 text-sm text-ink-muted">
          O que você liga, desliga ou cola. O que o site faz com os dados está em{" "}
          <Link href="/seguranca" className="text-accent hover:underline">Segurança e dados</Link>.
        </p>

        <Secao titulo="Conta" sub="Nome e foto vêm da Steam — mudam lá, mudam aqui na próxima coleta.">
          <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-surface p-4 ring-1 ring-line">
            {user.avatarUrl && (
              <Image src={user.avatarUrl} alt="" width={56} height={56} className="size-14 rounded-xl ring-1 ring-line" unoptimized />
            )}
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {user.personaName}
                {selo && <Selo tipo={selo} />}
              </p>
              <p className="mt-0.5 font-mono text-[11px] text-ink-faint">{user.steamId}</p>
              <p className="mt-0.5 text-xs text-ink-faint" suppressHydrationWarning>
                no FragIQ desde {user.createdAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/p/${user.steamId}`} className={BOTAO}>Ver meu perfil</Link>
              {user.profileUrl && (
                <a href={user.profileUrl} target="_blank" rel="noreferrer" className={BOTAO}>
                  Steam <ExternalLink className="size-3.5" />
                </a>
              )}
            </div>
          </div>
          <PerfilPublicoToggle publico={user.perfilPublico} steamId={user.steamId} />
          <CurvaVisivelToggle visivel={user.curvaVisivel} seguidores={seguidores} />
        </Secao>

        <Secao
          titulo="Códigos da Steam"
          sub={
            temShare
              ? "O código de autenticação destrava o histórico de partidas oficiais: placar dos dez, ADR, KAST e CS Rating. Ele lê só a lista de partidas — nunca inventário, chat, amigos ou senha."
              : "Os dois códigos que destravam o histórico de partidas oficiais: placar dos dez, ADR, KAST e CS Rating. Eles leem só a lista de partidas — nunca inventário, chat, amigos ou senha."
          }
        >
          {user.partidasErro && (
            <div className="rounded-2xl border border-danger/30 bg-bad-soft p-4 text-sm">
              <p className="font-medium text-danger">A corrente parou.</p>
              <p className="mt-1 text-ink-muted">{user.partidasErro}</p>
              <p className="mt-1 text-xs text-ink-faint">
                Acontece quando o código é gerado de novo na Steam: o anterior deixa de valer. Cole o novo abaixo.
              </p>
            </div>
          )}

          {ativo && !user.partidasErro ? (
            <PartidasRevogar ativo={ativo} desde={user.partidasAtivadasEm} />
          ) : (
            <div className="rounded-2xl bg-surface p-5 ring-1 ring-line">
              <AtivarPartidas compacto={Boolean(user.partidasErro)} religar={temShare} />
            </div>
          )}

          <p className="text-xs text-ink-faint">
            <a href={PAGINA_STEAM} target="_blank" rel="noreferrer" className="underline decoration-line hover:text-ink">
              Gerar outro código na Steam
            </a>
            {" · "}
            <Link href="/games/730/partidas" className="underline decoration-line hover:text-ink">
              Ver as partidas
            </Link>
          </p>
        </Secao>

        <Secao titulo="Bot de presença" sub="É ele que sabe o modo e o mapa de cada partida — sem ele, a sessão fica sem contexto.">
          <BotAmigo amigo={amigo} />
          <AvisoSteamToggle ligado={user.avisoSteam} amigo={amigo} />
        </Secao>

        <Secao titulo="Os seus dados" sub="Levar embora ou apagar, sem fila e sem e-mail.">
          <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-surface p-4 ring-1 ring-line">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Baixar tudo</p>
              <p className="mt-0.5 text-xs text-ink-faint">Um JSON com cada coleta, sessão, análise e o resto. Sem filtro: é seu.</p>
            </div>
            <a href="/api/conta/exportar" className={BOTAO}>
              <Download className="size-4" /> Exportar
            </a>
          </div>
          <div className="rounded-2xl bg-surface p-4 ring-1 ring-line">
            <p className="text-sm font-medium">Apagar tudo</p>
            <p className="mt-0.5 mb-3 text-xs text-ink-faint">Conta, série, sessões, análises, comunidade. Na hora.</p>
            <ApagarConta />
          </div>
        </Secao>
      </main>
    </div>
  );
}

const BOTAO =
  "inline-flex items-center gap-2 rounded-lg bg-surface px-3 py-2 text-sm text-ink-muted ring-1 ring-line transition hover:text-ink hover:ring-accent/60";

function Secao({ titulo, sub, children }: { titulo: string; sub: string; children: React.ReactNode }) {
  return (
    <section className="mt-9">
      <h2 className="hud">{titulo}</h2>
      <p className="mt-1 mb-3 max-w-2xl text-xs text-ink-faint">{sub}</p>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
