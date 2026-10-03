import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { comparar, type Linha } from "@/lib/comparar";
import { pareceSteamId } from "@/lib/perfil-publico";
import { getSession } from "@/lib/session";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Dois jogadores, uma coluna cada, e em cada linha quem está na frente. */
export default async function ComparacaoPage({ params }: { params: Promise<{ steamId: string; outro: string }> }) {
  const { steamId, outro } = await params;
  if (!pareceSteamId(steamId) || !pareceSteamId(outro) || steamId === outro) notFound();

  const [c, session] = await Promise.all([comparar(steamId, outro), getSession()]);

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line/60 bg-canvas/70 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3.5">
          <Link href={session ? "/cs2" : "/"} className="font-mono text-sm font-bold tracking-tight">
            Frag<span className="text-accent">IQ</span>
          </Link>
          <span className="hud">comparação</span>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10">
        {"erro" in c ? (
          <p className="mx-auto max-w-lg py-16 text-center text-sm text-ink-muted">{c.erro}</p>
        ) : (
          <>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
              <Jogador nome={c.a.jogador.personaname} avatar={c.a.jogador.avatarfull} href={`/p/${steamId}`} horas={c.a.horas} lado="a" />
              <span className="hud text-accent">vs</span>
              <Jogador nome={c.b.jogador.personaname} avatar={c.b.jogador.avatarfull} href={`/p/${outro}`} horas={c.b.horas} lado="b" />
            </div>

            <Bloco titulo="Vitalício" linhas={c.resumo} />
            {c.armas.length > 0 && <Bloco titulo="Armas em comum" linhas={c.armas} />}
            {c.mapas.length > 0 && <Bloco titulo="Mapas em comum" linhas={c.mapas} />}

            <p className="mt-6 text-[11px] text-ink-faint">
              Totais (kills, rounds, partidas) não têm vencedor: favorecem quem jogou mais. Armas com menos de 200 tiros e mapas com menos de 100 rounds de um dos dois ficam de fora.
            </p>
          </>
        )}
      </main>
    </div>
  );
}

function Jogador({ nome, avatar, href, horas, lado }: { nome: string; avatar?: string; href: string; horas: number; lado: "a" | "b" }) {
  return (
    <Link href={href} className={cn("flex items-center gap-3", lado === "b" && "flex-row-reverse text-right")}>
      {avatar && <Image src={avatar} alt="" width={48} height={48} className="size-12 rounded-xl ring-1 ring-line" unoptimized />}
      <span className="min-w-0">
        <span className="block truncate text-lg font-semibold tracking-tight">{nome}</span>
        <span className="num block text-xs text-ink-faint">{horas.toLocaleString("pt-BR")} h em partida</span>
      </span>
    </Link>
  );
}

/**
 * Cada linha é um cabo de guerra: duas barras saem do centro, uma para cada
 * lado, com comprimento proporcional à parte de cada um na soma. Quem está
 * na frente fica em laranja. Não há eixo nem legenda porque o rótulo está
 * no meio e o número na ponta — o gráfico só torna a diferença visível de
 * longe, que é o que uma tabela de números não faz.
 */
function Bloco({ titulo, linhas }: { titulo: string; linhas: Linha[] }) {
  return (
    <section className="mt-8">
      <h2 className="hud">{titulo}</h2>
      <ol className="mt-3 divide-y divide-line-soft rounded-2xl bg-surface ring-1 ring-line">
        {linhas.map((l) => {
          const [pa, pb] = proporcao(l.a, l.b);
          return (
            <li key={l.rotulo} className="px-5 py-3">
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
                <span className={cn("num text-lg font-semibold", l.vencedor === 1 ? "text-accent" : l.vencedor === -1 ? "text-ink-muted" : "")}>{l.a}</span>
                <span className="text-center text-xs text-ink-faint">{l.rotulo}</span>
                <span className={cn("num text-right text-lg font-semibold", l.vencedor === -1 ? "text-accent" : l.vencedor === 1 ? "text-ink-muted" : "")}>{l.b}</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1" aria-hidden>
                <div className="flex justify-end">
                  <div
                    className={cn("h-1.5 rounded-l-full transition-[width]", l.vencedor === 1 ? "bg-accent" : "bg-line")}
                    style={{ width: `${pa}%` }}
                  />
                </div>
                <div>
                  <div
                    className={cn("h-1.5 rounded-r-full transition-[width]", l.vencedor === -1 ? "bg-accent" : "bg-line")}
                    style={{ width: `${pb}%` }}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Parte de cada lado na soma, em % da metade; empate é 50/50 e "—" é zero. */
function proporcao(a: string, b: string): [number, number] {
  const n = (v: string) => Number(v.replace(/\./g, "").replace(",", ".").replace("%", ""));
  const na = n(a);
  const nb = n(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb) || na + nb <= 0) return [0, 0];
  const total = na + nb;
  return [Math.max(4, (na / total) * 100), Math.max(4, (nb / total) * 100)];
}
