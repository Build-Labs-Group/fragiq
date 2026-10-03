import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRight, Lock } from "lucide-react";
import { getSession } from "@/lib/session";
import { listarPartidas } from "@/lib/partidas";
import { PartidasTabela } from "@/components/partidas-tabela";
import { PartidasAgregado } from "@/components/partidas-agregado";
import { carregarPerfilPublico, pareceSteamId, resolverEntrada } from "@/lib/perfil-publico";
import { SteamMark } from "@/components/steam-mark";
import { Selo } from "@/components/selo";
import { SeguirBotao } from "@/components/seguir-botao";
import { StatPanel } from "@/components/stat-panel";
import { CS2_PANEL } from "@/lib/cs2-panel";
import { carregarFonte } from "@/lib/fonte";
import { listarSessoes, formatarQuando } from "@/lib/sessoes";
import { estadoDeSeguir, type EstadoSeguir } from "@/lib/social";
import { prisma } from "@/lib/prisma";
import { cn } from "@/lib/utils";
import { listarInventario } from "@/lib/inventario";
import { InventarioGrade } from "@/components/inventario-grade";
import { carregarPerfilCS } from "@/lib/perfil-cs";
import { DemoPublicaBloco } from "@/components/demo-publica";
import { ArmaIcone } from "@/components/arma-icone";
import { MapaVisual } from "@/components/mapa-visual";

export const dynamic = "force-dynamic";

/**
 * A página pública de um jogador.
 *
 * Só o que a Steam já mostra a quem tem o SteamID — números vitalícios, por
 * arma, por mapa — **mais o que o CS2 já mostra a qualquer um dos dez de
 * cada partida**: o scoreboard do GC, a demo (ADR, KAST, CS Rating), o
 * inventário aberto, a última partida que o bot viu. Privacidade da Steam
 * esconde os contadores; não esconde o resto, e a página mostra o máximo
 * em qualquer estado.
 *
 * **Três fontes, três K/D.** O vitalício da Steam, o agregado do Game
 * Coordinator e o das demos são números diferentes da mesma coisa, e a
 * página empilhava os três em blocos de tiles idênticos, sem nada dizendo
 * qual era qual — quem olhava via K/D 0,94, depois 1,12, depois 1,08 e não
 * tinha como saber que não era erro. Agora existe uma régua só no topo,
 * com a fonte nomeada embaixo de cada número, e as outras duas fontes
 * ficam inteiras num `details`, para quem quiser conferir a conta.
 *
 * A ordem é: quem é → como vai indo (a régua) → as partidas, com o mapa
 * à vista → a curva, se o dono deixa → o resto, dobrado.
 */
export default async function PerfilPublicoPage({
  params,
  searchParams,
}: {
  params: Promise<{ steamId: string }>;
  searchParams: Promise<{ erro?: string }>;
}) {
  const { steamId: bruto } = await params;
  const { erro } = await searchParams;
  const entrada = decodeURIComponent(bruto);

  if (!pareceSteamId(entrada)) {
    const resolvido = await resolverEntrada(entrada).catch(() => null);
    if (!resolvido) notFound();
    redirect(`/p/${resolvido}`);
  }

  const [perfil, session] = await Promise.all([carregarPerfilPublico(entrada), getSession()]);
  const souEu = session?.steamId === entrada;

  const comJogador = perfil.estado === "ok" || perfil.estado === "privado" || perfil.estado === "sem-cs2";
  // Seguir só existe entre contas: quem vê e quem é visto precisam estar no
  // FragIQ. E a curva só aparece depois de aceito. A conta existe em
  // qualquer estado da Steam — quem esconde os contadores continua tendo
  // inventário lido, selo e curva.
  const alvo = comJogador
    ? await prisma.user.findUnique({ where: { steamId: entrada }, select: { id: true, createdAt: true, curvaVisivel: true } })
    : null;
  const estado: EstadoSeguir | null =
    session && alvo && !souEu ? await estadoDeSeguir(session.userId, alvo.id) : null;
  // Seguir virou unilateral, então não é mais o aceite que abre a curva: é
  // a escolha do dono, uma vez, em Configurações. Seguir dá o acesso
  // quando ela está ligada e não dá nada quando não está.
  const curva = estado === "seguindo" && alvo?.curvaVisivel ? await carregarFonte(alvo.id, 730) : null;
  // O scoreboard de partida é público na Steam ("Suas partidas" de cada um
  // dos dez); mostramos o que já temos gravado deste SteamID.
  // O scoreboard do GC existe para os dez de cada partida, privados ou não:
  // é o que resta para quem a Steam esconde, e por isso vem antes do estado.
  const [partidas, cs] = comJogador
    ? await Promise.all([
        listarPartidas(entrada, 30),
        carregarPerfilCS(entrada, {
          userId: alvo?.id ?? null,
          horasConhecidas: perfil.estado === "ok",
          // Quem tem conta já tem o inventário lido pela coleta; quem não tem
          // é lido aqui, uma vez a cada 6 h, e só se o perfil não for privado.
          lerInventario: !alvo && perfil.estado !== "privado",
        }),
      ])
    : [[], null];
  // O inventário é público na Steam por escolha da pessoa. Sem preço: a
  // vitrine é o item, como no perfil da Steam.
  const inventarioDeConta = alvo ? await listarInventario(alvo.id) : null;
  const inventario = inventarioDeConta?.publico
    ? { total: inventarioDeConta.itens.length, itens: inventarioDeConta.itens.map((i) => ({ ...i, precoCents: null })) }
    : cs?.inventario?.publico
      ? { total: cs.inventario.total, itens: cs.inventario.itens }
      : null;
  const vitrine = inventario?.itens.slice(0, 40) ?? [];
  const jogador = comJogador ? perfil.jogador : null;
  const usuarioDoFragiq = alvo ? { desde: alvo.createdAt } : null;
  const horas = perfil.estado === "ok" ? perfil.horas : (cs?.horasBiblioteca ?? null);
  // A régua: quatro números e, embaixo de cada um, de onde ele veio. A
  // ordem de preferência é a da confiança — demo mede round a round, o GC
  // mede partida a partida, o vitalício mede uma vida inteira e não
  // distingue modo nenhum.
  const soma = partidas.reduce(
    (a, p) => ({ k: a.k + p.eu.kills, d: a.d + p.eu.deaths, hs: a.hs + p.eu.hs, v: a.v + (p.eu.venceu ? 1 : 0) }),
    { k: 0, d: 0, hs: 0, v: 0 },
  );
  const doVitalicio = (rotulo: string) => perfil.estado === "ok" ? perfil.resumo.find((r) => r.rotulo === rotulo)?.valor ?? null : null;
  const regua: { rotulo: string; valor: string; fonte: string }[] = [
    cs?.demo?.rating
      ? { rotulo: "CS Rating", valor: cs.demo.rating.atual.toLocaleString("pt-BR"), fonte: "Premier" }
      : { rotulo: "Horas", valor: horas === null ? "—" : horas.toLocaleString("pt-BR"), fonte: "biblioteca" },
    partidas.length > 0 && soma.d > 0
      ? { rotulo: "K/D", valor: (soma.k / soma.d).toFixed(2).replace(".", ","), fonte: `${partidas.length} partidas oficiais` }
      : { rotulo: "K/D", valor: doVitalicio("K/D") ?? "—", fonte: "vitalício" },
    cs?.demo
      ? { rotulo: "ADR", valor: cs.demo.adr.toLocaleString("pt-BR", { maximumFractionDigits: 1 }), fonte: `${cs.demo.partidas} demos` }
      : { rotulo: "Dano / round", valor: doVitalicio("Dano / round") ?? "—", fonte: "vitalício" },
    partidas.length > 0 && soma.k > 0
      ? { rotulo: "Headshot", valor: `${Math.round((soma.hs / soma.k) * 100)}%`, fonte: `${partidas.length} partidas oficiais` }
      : { rotulo: "Headshot", valor: doVitalicio("Headshot") ?? "—", fonte: "vitalício" },
  ];

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line/60 bg-canvas/70 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3.5">
          <Link href={session ? "/cs2" : "/"} className="font-mono text-sm font-bold tracking-tight">
            Frag<span className="text-accent">IQ</span>
          </Link>
          <span className="hud">perfil público</span>
          {!session && (
            <a
              href="/api/auth/steam"
              className="ml-auto inline-flex items-center gap-2 rounded-lg bg-surface px-3 py-1.5 text-sm font-medium ring-1 ring-line transition hover:ring-accent/60"
            >
              <SteamMark className="size-4" />
              Entrar
            </a>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        {perfil.estado === "oculto" && <Estado titulo="Perfil oculto" texto="Esta pessoa escolheu não ter página pública no FragIQ." />}
        {perfil.estado === "inexistente" && <Estado titulo="Perfil não encontrado" texto="A Steam não conhece esse SteamID." />}
        {jogador && (
          <>
            <section className="flex flex-wrap items-center gap-5">
              {jogador.avatarfull && (
                <Image src={jogador.avatarfull} alt="" width={72} height={72} className="size-18 rounded-2xl ring-1 ring-line" unoptimized />
              )}
              <div className="min-w-0 flex-1">
                <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">
                  {jogador.personaname}
                  {usuarioDoFragiq && <Selo tipo="beta" />}
                </h1>
                <p className="tnum mt-1 text-sm text-ink-muted">
                  {[
                    horas !== null ? `${horas.toLocaleString("pt-BR")} h ${perfil.estado === "ok" ? "em partida" : "de CS2"}` : null,
                    jogador.loccountrycode ?? null,
                    usuarioDoFragiq
                      ? `no FragIQ desde ${usuarioDoFragiq.desde.toLocaleDateString("pt-BR", { month: "short", year: "numeric" }).replace(".", "")}`
                      : null,
                    cs?.demo?.rating ? `CS Rating ${cs.demo.rating.atual.toLocaleString("pt-BR")}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  {jogador.profileurl && (
                    <>
                      {" · "}
                      <a href={jogador.profileurl} target="_blank" rel="noreferrer" className="underline decoration-line hover:text-ink">
                        Steam
                      </a>
                    </>
                  )}
                </p>
                {perfil.estado !== "ok" && (
                  <p className="mt-1 text-xs text-ink-faint">
                    {perfil.estado === "privado"
                      ? "Perfil privado na Steam: os contadores não aparecem. O que está abaixo é o que o CS2 já mostra a qualquer um dos dez de cada partida."
                      : "Contadores de CS2 escondidos (\u201cDetalhes do jogo\u201d privado, ou nunca jogou). O que está abaixo é o que o CS2 já mostra a qualquer um dos dez de cada partida."}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {session && !souEu && (
                  <Link
                    href={`/p/${session.steamId}/vs/${entrada}`}
                    className="rounded-lg bg-surface px-3 py-1.5 text-sm text-ink-muted ring-1 ring-line transition hover:text-ink hover:ring-accent/60"
                  >
                    Comparar comigo
                  </Link>
                )}
                {souEu ? (
                  <Link href="/cs2" className="inline-flex items-center gap-2 text-sm text-ink-muted transition hover:text-accent">
                    Ver a minha curva <ArrowRight className="size-4" />
                  </Link>
                ) : estado === "nada" ? (
                  <SeguirBotao steamId={entrada} acao="seguir" rotulo="Seguir" primario />
                ) : estado === "seguindo" ? (
                  <SeguirBotao steamId={entrada} acao="deixar" rotulo="Seguindo" />
                ) : usuarioDoFragiq ? (
                  <p className="flex items-center gap-1.5 text-xs text-ink-faint">
                    <Lock className="size-3" /> entre para seguir
                  </p>
                ) : null}
              </div>
            </section>

            {/* A régua. Quatro números, cada um dizendo de onde veio — é a
                única parte da página em que um número aparece grande. */}
            <section className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {regua.map((r) => (
                <div key={r.rotulo} className="rounded-2xl bg-surface p-4 ring-1 ring-line">
                  <p className="hud">{r.rotulo}</p>
                  <p className="num mt-1.5 text-2xl font-semibold">{r.valor}</p>
                  <p className="mt-1 truncate text-[11px] text-ink-faint" title={r.fonte}>{r.fonte}</p>
                </div>
              ))}
            </section>

            {cs?.presenca && (
              <p className="mt-3 text-xs text-ink-faint">
                <span className="hud">visto por último</span>{" "}
                <span suppressHydrationWarning>{formatarQuando(cs.presenca.quando)}</span>
                {[cs.presenca.modo, cs.presenca.mapa].filter(Boolean).length > 0 && ` · ${[cs.presenca.modo, cs.presenca.mapa].filter(Boolean).join(" · ")}`}
                {cs.presenca.placar && <span className="num"> · {cs.presenca.placar}</span>}
              </p>
            )}

            {partidas.length > 0 && (
              <section className="mt-9">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="hud">Partidas oficiais</h2>
                  <p className="text-[11px] text-ink-faint">placar dos dez, direto do Game Coordinator</p>
                </div>
                <div className="mt-3">
                  <PartidasTabela partidas={partidas.slice(0, 10)} publica />
                </div>
              </section>
            )}

            {curva && curva.rows.length >= 2 && (
              <section className="mt-9">
                <div className="flex flex-wrap items-baseline gap-3">
                  <h2 className="hud">A curva</h2>
                  <span className="text-xs text-ink-faint">{curva.rows.length} coletas · visível para quem segue</span>
                </div>
                <div className="mt-3">
                  <StatPanel stats={CS2_PANEL} snapshots={curva.rows} appId={730} limite={6} />
                </div>
                <h3 className="hud mt-8">Últimas sessões</h3>
                <ol className="mt-3 divide-y divide-line-soft rounded-2xl bg-surface ring-1 ring-line">
                  {listarSessoes(curva.rows).reverse().slice(0, 8).map((s) => (
                    <li key={s.ate.getTime()} className="num flex flex-wrap items-center gap-x-6 gap-y-1 px-5 py-3 text-sm">
                      <span className="text-ink-muted" suppressHydrationWarning>{formatarQuando(s.ate)}</span>
                      <span>{s.rounds} rounds</span>
                      <span className={cn(s.kd !== null && s.kd >= 1 && "text-accent")}>K/D {s.kd === null ? "—" : s.kd.toFixed(2).replace(".", ",")}</span>
                      <span>{s.danoPorRound === null ? "—" : Math.round(s.danoPorRound)} dano/round</span>
                      <span>{s.hs === null ? "—" : `${s.hs.toFixed(1).replace(".", ",")}%`} HS</span>
                      {(s.mapa || s.modo) && <span className="font-sans text-ink-faint">{[s.modo, s.mapa].filter(Boolean).join(" · ")}</span>}
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {estado === "seguindo" && alvo && !alvo.curvaVisivel && (
              <p className="mt-8 flex items-center gap-1.5 text-xs text-ink-faint">
                <Lock className="size-3" /> esta pessoa não mostra a curva para quem segue
              </p>
            )}

            {vitrine.length > 0 && (
              <section className="mt-9">
                <div className="flex items-baseline justify-between">
                  <h2 className="hud">Inventário</h2>
                  <p className="num text-xs text-ink-faint">
                    {inventario!.total} itens{inventario!.total > vitrine.length ? ` · os ${vitrine.length} mais raros` : ""}
                  </p>
                </div>
                <div className="mt-3">
                  <InventarioGrade itens={vitrine} />
                </div>
              </section>
            )}

            {/* Dobrado de propósito. Tudo abaixo é a mesma performance
                medida de outro jeito: quem quer conferir a conta abre, e
                quem só queria saber como o jogador vai indo já leu a régua
                e foi embora. Aberto, eram seis blocos de tiles repetindo
                K/D e headshot com números diferentes. */}
            {(perfil.estado === "ok" || cs?.demo || partidas.length > 0) && (
              <details className="group mt-9 rounded-2xl bg-surface ring-1 ring-line">
                <summary className="cursor-pointer px-5 py-4 text-sm text-ink-muted transition hover:text-ink">
                  Todos os números
                  <span className="ml-2 text-xs text-ink-faint">
                    {[
                      perfil.estado === "ok" ? "vitalício da Steam" : null,
                      partidas.length > 0 ? "agregado do GC" : null,
                      cs?.demo ? "demos" : null,
                    ].filter(Boolean).join(" · ")}
                  </span>
                </summary>

                <div className="space-y-9 border-t border-line-soft px-5 py-6">
                  {cs?.demo && <DemoPublicaBloco demo={cs.demo} />}

                  {partidas.length > 0 && <PartidasAgregado partidas={partidas} />}

                  {perfil.estado === "ok" && (
                    <>
                      <section>
                        <h3 className="hud">Vitalício, pela Steam</h3>
                        <p className="mt-1 text-[11px] text-ink-faint">
                          Desde sempre e somando todos os modos: casual, deathmatch e competitivo no mesmo número.
                        </p>
                        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                          {perfil.resumo.map((r) => (
                            <div key={r.rotulo} className="rounded-xl bg-surface-2 px-4 py-3">
                              <p className="hud text-[10px]">{r.rotulo}</p>
                              <p className="num mt-1 text-lg font-semibold">{r.valor}</p>
                            </div>
                          ))}
                        </div>
                      </section>

                      <div className="grid gap-8 lg:grid-cols-2">
                        <section>
                          <h3 className="hud">Por arma</h3>
                          <Tabela
                            cabecalho={["Arma", "Kills", "Tiros", "Precisão"]}
                            linhas={perfil.armas.slice(0, 12).map((a) => [
                              <span key="n" className="flex items-center gap-3">
                                <ArmaIcone arma={a.id} className="text-ink-muted" />
                                {a.arma}
                              </span>,
                              a.kills.toLocaleString("pt-BR"),
                              a.tiros.toLocaleString("pt-BR"),
                              a.precisao === null ? "—" : `${a.precisao.toFixed(1).replace(".", ",")}%`,
                            ])}
                          />
                        </section>
                        <section>
                          <h3 className="hud">Por mapa</h3>
                          <Tabela
                            cabecalho={["Mapa", "Rounds", "Ganhos", "Taxa"]}
                            linhas={perfil.mapas.slice(0, 12).map((m) => [
                              <span key="n" className="flex items-center gap-3">
                                <MapaVisual mapa={m.id} />
                                {m.mapa}
                              </span>,
                              m.rounds.toLocaleString("pt-BR"),
                              m.vitorias.toLocaleString("pt-BR"),
                              m.taxa === null ? "—" : `${m.taxa.toFixed(1).replace(".", ",")}%`,
                            ])}
                          />
                          <p className="mt-2 text-[11px] text-ink-faint">
                            A Steam só conta os mapas do pool antigo; Mirage, Ancient, Anubis e Overpass não aparecem.
                          </p>
                        </section>
                      </div>
                    </>
                  )}
                </div>
              </details>
            )}

            {session && !souEu && (
              <form action="/api/perfil/comparar" className="mt-9 flex max-w-lg items-center gap-2">
                <input type="hidden" name="a" value={entrada} />
                <input
                  name="q"
                  required
                  placeholder="Comparar com… link, apelido ou SteamID"
                  className="min-h-10 w-full rounded-xl bg-surface px-4 text-sm ring-1 ring-line outline-none transition placeholder:text-ink-faint focus:ring-accent/50"
                />
                <button type="submit" className="min-h-10 shrink-0 rounded-xl bg-surface px-4 text-sm font-medium ring-1 ring-line transition hover:ring-accent/60">
                  vs
                </button>
              </form>
            )}
            {erro && <p className="mt-2 text-sm text-danger">{erro}</p>}

            {!usuarioDoFragiq && !session && (
              <section className="mt-12 rounded-2xl bg-surface p-6 ring-1 ring-line">
                <p className="text-lg font-semibold tracking-tight">É você?</p>
                <p className="mt-1 max-w-lg text-sm text-ink-muted">
                  Estes números são o total desde sempre. O FragIQ grava a curva a partir de hoje e analisa
                  cada sessão contra o seu normal.
                </p>
                <a
                  href="/api/auth/steam"
                  className="borda-viva mt-4 inline-flex items-center gap-3 rounded-xl px-5 py-3 font-medium text-ink transition hover:text-accent"
                >
                  <SteamMark />
                  Entrar com Steam
                </a>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Estado({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{titulo}</h1>
      <p className="mt-3 text-sm text-ink-muted">{texto}</p>
      <Link href="/" className="mt-6 inline-block text-sm text-ink-faint transition hover:text-accent">
        ← FragIQ
      </Link>
    </div>
  );
}

function Tabela({ cabecalho, linhas }: { cabecalho: string[]; linhas: React.ReactNode[][] }) {
  if (linhas.length === 0) {
    return <p className="mt-3 rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm text-ink-faint">Sem dados.</p>;
  }
  return (
    <div className="mt-3 overflow-hidden rounded-2xl bg-surface ring-1 ring-line">
      <table className="w-full text-sm">
        <thead>
          <tr>
            {cabecalho.map((c, i) => (
              <th key={c} className={cn("hud px-4 py-2.5 font-normal", i === 0 ? "text-left" : "text-right")}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="num">
          {linhas.map((l, i) => (
            <tr key={i} className="border-t border-line-soft">
              {l.map((c, j) => (
                <td key={j} className={cn("px-4 py-2", j === 0 ? "font-sans text-left" : "text-right")}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
