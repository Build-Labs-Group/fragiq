import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Lock, TriangleAlert } from "lucide-react";
import { getSession } from "@/lib/session";
import { SteamMark } from "@/components/steam-mark";
import { ThesisChart } from "@/components/thesis-chart";
import { Comparison } from "@/components/landing/comparison";
import { Particulas } from "@/components/landing/particulas";
import { Revelar } from "@/components/landing/revelar";
import { Contador } from "@/components/landing/contador";
import { Tilt } from "@/components/landing/tilt";
import { DemoHud } from "@/components/landing/demo-hud";

export const dynamic = "force-dynamic";

/**
 * Landing.
 *
 * Quem chega aqui joga CS2 e reconhece um HUD à distância. A página fala
 * pouco e mostra muito: o hero é o produto em miniatura, com os mesmos
 * componentes do dashboard; o resto são três frases e uma comparação
 * honesta. O movimento é contido — partículas atrás do hero, o gráfico se
 * desenhando, números contando — e para quando a pessoa pede menos.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  if (await getSession()) redirect("/cs2");
  const { erro } = await searchParams;

  return (
    <div className="min-h-dvh overflow-x-hidden">
      <TopBar />
      <main>
        <Hero erro={erro} />
        <Numeros />
        <Pilares />
        <Tese />
        <Comparacao />
        <ComoComecar />
        <Chamada />
      </main>
      <Footer />
    </div>
  );
}

/* ---------------------------------- topo ---------------------------------- */

function TopBar() {
  return (
    <header className="sticky top-0 z-20 border-b border-line/60 bg-canvas/70 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3.5">
        <span className="font-mono text-sm font-bold tracking-tight">
          Frag<span className="text-accent">IQ</span>
        </span>
        <span className="hud rounded-full border border-accent/30 px-2 py-0.5 text-[10px] text-accent">beta</span>
        <nav className="ml-auto hidden items-center gap-6 text-sm text-ink-muted sm:flex">
          <a href="#tese" className="transition hover:text-ink">A tese</a>
          <a href="#comparacao" className="transition hover:text-ink">Comparação</a>
          <Link href="/comunidade" className="transition hover:text-ink">Comunidade</Link>
          <Link href="/seguranca" className="transition hover:text-ink">Segurança</Link>
        </nav>
        <a
          href="/api/auth/steam"
          className="inline-flex items-center gap-2 rounded-lg bg-surface px-3 py-1.5 text-sm font-medium ring-1 ring-line transition hover:ring-accent/60 sm:ml-2"
        >
          <SteamMark className="size-4" />
          Entrar
        </a>
      </div>
    </header>
  );
}

/* ---------------------------------- hero ---------------------------------- */

function Hero({ erro }: { erro?: string }) {
  return (
    <section className="relative overflow-hidden border-b border-line">
      <div className="aurora -top-40 -left-32 size-[34rem] bg-accent/40" aria-hidden />
      <div className="aurora top-40 -right-40 size-[28rem] bg-steam/25 [animation-delay:-6s]" aria-hidden />
      <Particulas className="pointer-events-none absolute inset-0 size-full" />
      <div className="varredura" aria-hidden />

      <div className="relative mx-auto max-w-6xl px-6 pt-20 pb-16 sm:pt-28">
        <p className="hud">Counter-Strike 2 · análise temporal</p>
        <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
          A Steam guarda o total.
          <br />
          <span className="text-accent">O FragIQ guarda a curva.</span>
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-muted">
          Depois de mil horas, seu K/D vitalício não se move. Cada sessão sua, comparada com o
          seu normal, analisada sozinha.
        </p>

        {erro && (
          <p className="mt-6 flex max-w-xl items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            {erro}
          </p>
        )}

        <div className="mt-9 flex flex-wrap items-center gap-4">
          <a
            href="/api/auth/steam"
            className="borda-viva group inline-flex items-center gap-3 rounded-xl px-6 py-3.5 font-medium text-ink transition hover:text-accent"
          >
            <SteamMark />
            Entrar com Steam
            <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
          </a>
          <span className="flex items-center gap-1.5 text-xs text-ink-faint">
            <Lock className="size-3" />
            senha na Valve; recebemos só o SteamID
          </span>
        </div>

        <form action="/api/perfil/buscar" className="mt-5 flex max-w-xl items-center gap-2">
          <input
            name="q"
            required
            placeholder="Ou veja qualquer perfil: link da Steam, apelido ou SteamID"
            className="min-h-11 w-full rounded-xl bg-surface/80 px-4 text-sm ring-1 ring-line outline-none transition placeholder:text-ink-faint focus:ring-accent/50"
          />
          <button
            type="submit"
            className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-surface px-4 text-sm font-medium ring-1 ring-line transition hover:ring-accent/60"
          >
            Ver
            <ArrowRight className="size-4" />
          </button>
        </form>

        <Revelar className="mt-14">
          <DemoHud />
        </Revelar>
      </div>
    </section>
  );
}

/* --------------------------------- números -------------------------------- */

const NUMEROS = [
  { ate: 178, rotulo: "estatísticas em série temporal" },
  { ate: 94, rotulo: "por arma" },
  { ate: 30, rotulo: "por mapa" },
  { ate: 1, sufixo: "/dia", rotulo: "coleta automática, sem instalar nada" },
];

function Numeros() {
  return (
    <section className="border-b border-line">
      <div className="mx-auto grid max-w-6xl gap-8 px-6 py-12 sm:grid-cols-4">
        {NUMEROS.map((n, i) => (
          <Revelar key={n.rotulo} atraso={i * 80}>
            <p className="num text-4xl font-semibold text-accent">
              <Contador ate={n.ate} sufixo={n.sufixo} />
            </p>
            <p className="mt-1 text-sm text-ink-muted">{n.rotulo}</p>
          </Revelar>
        ))}
      </div>
    </section>
  );
}

/* --------------------------------- pilares -------------------------------- */

const PILARES = [
  {
    titulo: "Cada sessão, analisada sozinha",
    texto: "Terminou de jogar, a leitura já está lá: o que mudou, o que pesou, o que fazer. Sem digitar nada.",
  },
  {
    titulo: "Você contra o seu normal",
    texto: "Nenhum número aparece sem o seu vitalício ao lado. A distância entre os dois é a informação.",
  },
  {
    titulo: "Cada gráfico, uma página",
    texto: "Um tile é um olhar; a página é a série inteira, com a granularidade que você escolher.",
  },
];

function Pilares() {
  return (
    <section className="border-b border-line">
      <div className="mx-auto grid max-w-6xl gap-4 px-6 py-16 sm:grid-cols-3">
        {PILARES.map((p, i) => (
          <Revelar key={p.titulo} atraso={i * 100}>
            <Tilt className="h-full rounded-2xl bg-surface p-6 ring-1 ring-line">
              <p className="hud">0{i + 1}</p>
              <h2 className="mt-3 text-lg font-semibold tracking-tight">{p.titulo}</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">{p.texto}</p>
            </Tilt>
          </Revelar>
        ))}
      </div>
    </section>
  );
}

/* ---------------------------------- tese ---------------------------------- */

function Tese() {
  return (
    <section id="tese" className="scroll-mt-14 border-b border-line">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <Revelar>
          <p className="hud">A tese</p>
          <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-balance">
            A média vitalícia esconde a queda. A curva por período mostra.
          </h2>
        </Revelar>
        <Revelar className="mt-8" atraso={120}>
          <ThesisChart />
        </Revelar>
      </div>
    </section>
  );
}

/* ------------------------------- comparação ------------------------------- */

function Comparacao() {
  return (
    <section id="comparacao" className="scroll-mt-14 border-b border-line">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <Revelar>
          <p className="hud">Comparação</p>
          <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-balance">
            Onde ganhamos, e onde ainda não.
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-muted">
            csstats, csrep e Leetify parseiam demos: têm ADR e rating, e nós ainda não. Nenhum
            deles grafica a sua evolução.
          </p>
        </Revelar>
        <Revelar className="mt-8" atraso={120}>
          <Comparison />
        </Revelar>
      </div>
    </section>
  );
}

/* --------------------------------- chamada -------------------------------- */

/* ------------------------------ como começar ------------------------------ */

/**
 * O que vem depois do botão. Sem isto, "Entrar com Steam" era um salto no
 * escuro: quem entrava encontrava uma lista de passos que ninguém tinha
 * anunciado. Com o tempo de cada um à vista, a lista vira o combinado.
 */
const PASSOS_INICIAIS = [
  { titulo: "Entre com a Steam", texto: "Login pela própria Valve. Recebemos só o seu SteamID.", tempo: "10 s" },
  { titulo: "Abra os detalhes do jogo", texto: "Um ajuste de privacidade na Steam para as estatísticas do CS2 chegarem.", tempo: "30 s" },
  { titulo: "Adicione o bot", texto: "Ele avisa quando a partida termina, com mapa e modo. Opcional.", tempo: "20 s" },
  { titulo: "Ligue as partidas oficiais", texto: "Dois códigos de uma página da Steam: placar dos dez em cada partida. Opcional.", tempo: "1 min" },
];

function ComoComecar() {
  return (
    <section className="border-b border-line">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <Revelar>
          <p className="hud">Como começar</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">Uns dois minutos, uma vez só.</h2>
          <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PASSOS_INICIAIS.map((p, i) => (
              <li key={p.titulo} className="rounded-2xl bg-surface p-5 ring-1 ring-line">
                <div className="flex items-baseline justify-between">
                  <span className="num text-accent">{i + 1}</span>
                  <span className="num text-xs text-ink-faint">{p.tempo}</span>
                </div>
                <p className="mt-3 font-medium">{p.titulo}</p>
                <p className="mt-1 text-sm text-ink-muted">{p.texto}</p>
              </li>
            ))}
          </ol>
          <p className="mt-6 text-sm text-ink-muted">Depois disso, cada partida chega sozinha. Dentro do site, uma lista mostra o que falta.</p>
        </Revelar>
      </div>
    </section>
  );
}

function Chamada() {
  return (
    <section className="relative overflow-hidden border-b border-line">
      <div className="aurora -bottom-40 left-1/3 size-[30rem] bg-accent/30" aria-hidden />
      <div className="relative mx-auto max-w-6xl px-6 py-20 text-center">
        <Revelar>
          <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Seu histórico começa a ser gravado hoje.
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-ink-muted">
            E não é recuperável depois: a Steam só sabe o total de hoje.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <a
              href="/api/auth/steam"
              className="borda-viva group inline-flex items-center gap-3 rounded-xl px-6 py-3.5 font-medium text-ink transition hover:text-accent"
            >
              <SteamMark />
              Entrar com Steam
              <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
            </a>
            <Link
              href="/comunidade"
              className="text-sm text-ink-muted transition hover:text-ink"
            >
              Participar do desenvolvimento →
            </Link>
          </div>
        </Revelar>
      </div>
    </section>
  );
}

/* ---------------------------------- rodapé -------------------------------- */

function Footer() {
  return (
    <footer className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-8 text-xs text-ink-faint">
      <span className="font-mono font-bold text-ink-muted">
        Frag<span className="text-accent">IQ</span>
      </span>
      <Link href="/seguranca" className="transition hover:text-ink">
        Só leitura do que já é público no seu perfil. Nada na sua conta é alterado. Como →
      </Link>
      <span className="ml-auto">beta · gratuito</span>
    </footer>
  );
}
