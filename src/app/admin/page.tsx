import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { isAdmin } from "@/lib/admin";
import { carregarPainel, FUSO } from "@/lib/admin-dados";
import { estadoDoBot, haQuanto, REPOUSO_DO_BOT_MS } from "@/lib/saude-do-bot";
import { medirPendencias } from "@/lib/saude-dos-dados";
import { SiteHeader } from "@/components/site-header";
import { BarrasPorDia } from "@/components/barras-por-dia";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Painel de operação: quem entrou, o que fizeram, a coleta está saudável.
 *
 * Restrito por SteamID (ADMIN_STEAM_IDS). Quem não é admin recebe 404, não
 * 403 — a URL não precisa anunciar que existe.
 */
export default async function AdminPage() {
  const session = await getSession();
  if (!session) redirect("/");
  if (!isAdmin(session.steamId)) notFound();

  const [user, painel, pendencias] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.userId },
      select: { personaName: true, avatarUrl: true, lastSyncedAt: true, steamId: true },
    }),
    carregarPainel(),
    medirPendencias(),
  ]);
  if (!user) redirect("/");

  const { totais, usuarios, porDia, funil, saude, eventos, bot } = painel;
  const tickHa = saude.bot ? Date.now() - saude.bot.ultimoTickEm.getTime() : null;
  const estadoBot = estadoDoBot(saude.bot && tickHa !== null ? { tickHaMs: tickHa, logado: saude.bot.logado } : null);
  const botVivo = estadoBot === "vivo" || estadoBot === "repouso";
  const botDeslogado = estadoBot === "deslogado";
  const foraHa = saude.bot?.desconectadoDesde ? Math.round((Date.now() - saude.bot.desconectadoDesde.getTime()) / 60_000) : null;

  return (
    <>
      <SiteHeader {...user} admin />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="flex items-baseline justify-between">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Painel</h1>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/admin/bruto" className="text-ink-muted hover:text-accent">Cru</Link>
            <Link href="/admin/dados" className="text-accent hover:underline">Dados →</Link>
          </nav>
        </div>
        <p className="mt-1 text-sm text-ink-muted">
          Quem entrou, o que aconteceu e se a coleta está saudável. Horários em Brasília.
        </p>

        <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile rotulo="Jogadores" valor={totais.usuarios} nota={`${totais.novos7d} novos em 7 dias`} />
          <Tile rotulo="Ativos em 7 dias" valor={totais.ativos7d} nota="sincronizaram na semana" />
          <Tile
            rotulo="Coletas"
            valor={totais.coletas}
            nota={`${totais.coletasComContexto} com mapa e modo`}
          />
          <Tile
            rotulo="Análises"
            valor={totais.analises}
            nota={`${totais.analisesRespondidas} respondidas · ${totais.feedbacks} feedback${totais.feedbacks === 1 ? "" : "s"}`}
          />
        </section>

        <Secao
          titulo="Saúde"
          sub={`O bot conta como está a cada 30 s quando há trabalho e a cada ${REPOUSO_DO_BOT_MS / 60_000} min em repouso; o resto são as filas que ele e o site compartilham.`}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile
              rotulo="Bot"
              valor={estadoBot === "repouso" ? "vivo, em repouso" : estadoBot}
              nota={
                botDeslogado && saude.bot
                  ? `fora da Steam há ${foraHa ?? 0} min · ${saude.bot.motivo ?? "sem motivo registrado"}`
                  : saude.bot
                    ? `tick ${haQuanto(tickHa ?? 0)} · ${saude.bot.amigos} amigos · GC ${saude.bot.gcConectado ? "ok" : "fora"}`
                    : "nenhum tick recebido"
              }
              alerta={!botVivo}
            />
            <Tile
              rotulo="Capturas pendentes"
              valor={saude.capturasPendentes.total}
              nota={
                saude.capturasPendentes.maisAntigaEm
                  ? `mais antiga há ${Math.round((Date.now() - saude.capturasPendentes.maisAntigaEm.getTime()) / 60_000)} min · tentativa ${saude.capturasPendentes.maxTentativa}`
                  : "nada esperando a Steam"
              }
              alerta={saude.capturasPendentes.maxTentativa >= 3}
            />
            <Tile
              rotulo="Partidas na fila"
              valor={saude.partidasNaFila}
              nota={`${saude.partidasExpiradas} expiradas/falhas no total`}
              alerta={saude.partidasNaFila > 5}
            />
            <Tile
              rotulo="Chat 24 h"
              valor={saude.chat24h.enviadas}
              nota={`${saude.chat24h.falhas} falha${saude.chat24h.falhas === 1 ? "" : "s"} · ${saude.chat24h.pendentes} pendente${saude.chat24h.pendentes === 1 ? "" : "s"} · ${saude.erros24h} erro${saude.erros24h === 1 ? "" : "s"} no diário`}
              alerta={saude.chat24h.falhas > 0 || saude.erros24h > 0}
            />
          </div>
        </Secao>

        <Secao
          titulo="Dados em dia"
          sub="O que terminou e ainda não apareceu para o jogador. É a mesma checagem que roda de 30 em 30 min e dispara o alarme (src/lib/saude-dos-dados.ts)."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <Tile
              rotulo="Partidas sem sessão"
              valor={pendencias.partidasSemSessao.length}
              nota={
                pendencias.partidasSemSessao.length
                  ? `terminadas há mais de 24 h · a mais antiga há ${Math.round((Date.now() - Math.min(...pendencias.partidasSemSessao.map((p) => p.fim.getTime()))) / 3_600_000)} h`
                  : "toda partida com mais de 24 h está numa sessão"
              }
              alerta={pendencias.partidasSemSessao.length > 0}
            />
            <Tile
              rotulo="Análises sem resposta"
              valor={pendencias.analisesSemResposta.length}
              nota={pendencias.analisesSemResposta.length ? "abertas há mais de 30 min no cogniflow" : "o analista respondeu tudo"}
              alerta={pendencias.analisesSemResposta.length > 0}
            />
            <Tile
              rotulo="Capturas vencidas"
              valor={pendencias.capturasVencidas.length}
              nota={pendencias.capturasVencidas.length ? "deviam ter rodado há mais de 1 h: o tick parou?" : "o tick está em dia"}
              alerta={pendencias.capturasVencidas.length > 0}
            />
          </div>
        </Secao>

        <Secao titulo="Funil de ativação" sub="Derivado do estado de cada conta, não de cliques. Quem parou numa etapa aparece pelo nome.">
          <ol className="grid gap-2">
            {funil.map((e, i) => {
              const base = funil[0].chegaram || 1;
              return (
                <li key={e.id} className="rounded-xl border border-line bg-surface px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="num w-6 text-xs text-ink-faint">{i + 1}</span>
                    <span className="flex-1 text-sm">{e.rotulo}</span>
                    <span className="num text-sm font-medium">{e.chegaram}</span>
                    <span className="num w-12 text-right text-xs text-ink-faint">{Math.round((e.chegaram / base) * 100)}%</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${(e.chegaram / base) * 100}%` }} />
                  </div>
                  {e.presos.length > 0 && (
                    <p className="mt-2 text-xs text-ink-faint">
                      Presos aqui: <span className="text-ink-muted">{e.presos.join(", ")}</span>
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        </Secao>

        <section className="mt-8 grid gap-3 lg:grid-cols-2">
          <BarrasPorDia titulo="Cadastros por dia" pontos={porDia.cadastros} />
          <BarrasPorDia titulo="Sincronizações por dia" pontos={porDia.syncs} />
          <BarrasPorDia titulo="Coletas por dia" pontos={porDia.coletas} />
          <BarrasPorDia titulo="Análises por dia" pontos={porDia.analises} />
        </section>

        <Secao titulo="Jogadores" sub="Todo mundo que entrou com a Steam, do mais recente ao mais antigo.">
          <Tabela
            cabecalho={["Jogador", "País", "Cadastro", "Último sync", "Logins", "Syncs", "CS2", "Coletas", "Última coleta", "Análises", "Feedback"]}
            linhas={usuarios.map((u) => [
              <span key="p" className="flex items-center gap-2">
                {u.avatarUrl && (
                  <Image src={u.avatarUrl} alt="" width={24} height={24} className="size-6 rounded-full ring-1 ring-line" unoptimized />
                )}
                <a
                  href={`https://steamcommunity.com/profiles/${u.steamId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-accent"
                >
                  {u.personaName}
                </a>
              </span>,
              u.countryCode ?? "—",
              dataHora(u.createdAt),
              u.lastSyncedAt ? dataHora(u.lastSyncedAt) : "nunca",
              u.logins,
              u.syncs,
              u.cs2 ? `${u.cs2.horas} h` : "—",
              u.cs2?.coletas ?? "—",
              u.cs2?.ultimaColeta ? dataHora(u.cs2.ultimaColeta) : "—",
              u.analises,
              u.feedbacks,
            ])}
            vazio="Ninguém entrou ainda."
          />
        </Secao>

        <Secao titulo="Coleta agendada" sub="Uma linha por execução do cron. `skipped` > 0 significa que a fila não está sendo vazada no ritmo.">
          <Tabela
            cabecalho={["Início", "Status", "Candidatos", "Sincronizados", "Falhas", "Pulados", "Pontos", "Duração", "Erro"]}
            linhas={painel.cronRecentes.map((c) => [
              dataHora(c.startedAt),
              <Status key="s" valor={c.status} />,
              c.candidates,
              c.synced,
              c.failed,
              c.skipped,
              c.snapshots,
              duracao(c.duracaoMs),
              c.error ? <span className="text-danger">{c.error}</span> : "",
            ])}
            vazio="O cron ainda não rodou."
          />
        </Secao>

        <Secao titulo="Sincronizações recentes" sub="Manual, login, cron ou evento do bot.">
          <Tabela
            cabecalho={["Início", "Jogador", "Gatilho", "Status", "Jogos", "Duração", "Erro"]}
            linhas={painel.syncsRecentes.map((s) => [
              dataHora(s.startedAt),
              s.persona,
              s.trigger,
              <Status key="s" valor={s.status} />,
              s.gamesStored,
              duracao(s.duracaoMs),
              s.error ? <span className="text-danger">{s.error}</span> : "",
            ])}
            vazio="Nenhuma sincronização ainda."
          />
        </Secao>

        <Secao titulo="Analista" sub="Pedidos ao cogniflow e quanto demoraram para voltar.">
          <Tabela
            cabecalho={["Quando", "Jogador", "Tipo", "Status", "Latência", "Pergunta / erro"]}
            linhas={painel.analisesRecentes.map((a) => [
              dataHora(a.createdAt),
              a.persona,
              a.kind === "SESSION" ? "sessão" : "pergunta",
              <Status key="s" valor={a.status} />,
              duracao(a.latenciaMs),
              <span key="q" className="block max-w-md truncate" title={a.error ?? a.question}>
                {a.error ? <span className="text-danger">{a.error}</span> : a.question}
              </span>,
            ])}
            vazio="Nenhuma análise pedida ainda."
          />
        </Secao>

        <Secao titulo="Bot" sub={`O que o bot viu e o que ele disse, sem SSH. ${bot.erros24h} erro${bot.erros24h === 1 ? "" : "s"} em 24 h.`}>
          <h3 className="mb-2 text-xs font-semibold text-ink-muted">Observações</h3>
          <Tabela
            cabecalho={["Quando", "Quem", "Evento", "Modo · mapa · placar", "Ponto", "Trace"]}
            vazio="Nenhuma observação ainda (o bot passa a gravá-las a partir de 17/09)."
            linhas={bot.observacoes.map((o) => [
              <span key="q" className="whitespace-nowrap text-ink-muted" suppressHydrationWarning>{dataHora(o.observedAt)}</span>,
              o.persona ?? <span key="p" className="font-mono text-xs text-ink-faint">{o.steamId}</span>,
              <span key="k" className="font-mono text-xs">{o.kind === "MATCH_ENDED" ? "fim de partida" : "saiu do jogo"}</span>,
              <span key="c" className="text-xs">{[o.mode, o.map, o.score].filter(Boolean).join(" · ") || "—"}</span>,
              <span key="v" className={cn("text-xs", o.virouPonto ? "text-good" : "text-ink-faint")}>{o.virouPonto ? "gravado" : "ainda não"}</span>,
              <Link key="t" href={`/admin/trace/${o.traceId}`} className="font-mono text-[10px] text-accent hover:underline">{o.traceId.slice(0, 8)}</Link>,
            ])}
          />
          <h3 className="mt-6 mb-2 text-xs font-semibold text-ink-muted">Log</h3>
          <Tabela
            cabecalho={["Quando", "Nível", "Quem", "Mensagem", "Trace"]}
            vazio="Nenhuma linha recebida ainda."
            linhas={bot.logs.map((l) => [
              <span key="q" className="whitespace-nowrap text-ink-muted" suppressHydrationWarning>{dataHora(l.em)}</span>,
              <span key="n" className={cn("font-mono text-xs", l.nivel === "ERROR" && "text-danger", l.nivel === "WARN" && "text-warn")}>{l.nivel}</span>,
              <span key="s" className="font-mono text-[10px] text-ink-faint">{l.steamId ? l.steamId.slice(-6) : "—"}</span>,
              <span key="m" className="block max-w-lg truncate text-xs" title={l.mensagem}>{l.mensagem}</span>,
              l.traceId ? <Link key="t" href={`/admin/trace/${l.traceId}`} className="font-mono text-[10px] text-accent hover:underline">{l.traceId.slice(0, 8)}</Link> : <span key="t" />,
            ])}
          />
        </Secao>

        <Secao titulo="Diário" sub="Erros e transições que antes só existiam no log: quem, o quê, quando.">
          <Tabela
            cabecalho={["Quando", "Evento", "Quem", "Detalhe"]}
            vazio="Nada registrado ainda."
            linhas={eventos.map((e) => [
              <span key="q" className="whitespace-nowrap text-ink-muted" suppressHydrationWarning>{dataHora(e.createdAt)}</span>,
              <span key="n" className={cn("font-mono text-xs", e.nome === "erro" && "text-danger")}>{e.nome}</span>,
              e.persona ?? <span key="p" className="text-ink-faint">—</span>,
              <span key="d" className="font-mono text-xs text-ink-muted">{e.dados ? JSON.stringify(e.dados).slice(0, 140) : ""}</span>,
            ])}
          />
        </Secao>

        <Secao titulo="Feedback" sub="O que as pessoas escreveram, e de onde.">
          {painel.feedbacks.length === 0 ? (
            <Vazio texto="Nenhum feedback ainda." />
          ) : (
            <ol className="space-y-3">
              {painel.feedbacks.map((f) => (
                <li key={f.id} className="rounded-xl border border-line bg-surface p-4">
                  <p className="flex flex-wrap gap-x-3 text-xs text-ink-faint">
                    <span>{dataHora(f.createdAt)}</span>
                    <span>{f.persona}</span>
                    {f.path && <span className="font-mono">{f.path}</span>}
                  </p>
                  <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap">{f.message}</p>
                </li>
              ))}
            </ol>
          )}
        </Secao>
      </main>
    </>
  );
}

/* ------------------------------ peças ----------------------------------- */

function Tile({ rotulo, valor, nota, alerta = false }: { rotulo: string; valor: number | string; nota: string; alerta?: boolean }) {
  return (
    <div className={cn("rounded-xl border bg-surface p-4", alerta ? "border-danger/50" : "border-line")}>
      <p className="text-xs text-ink-muted">{rotulo}</p>
      <p className={cn("tnum mt-1.5 text-2xl font-semibold", alerta && "text-danger")}>
        {typeof valor === "number" ? valor.toLocaleString("pt-BR") : valor}
      </p>
      <p className="mt-1 text-[11px] text-ink-faint">{nota}</p>
    </div>
  );
}

function Secao({ titulo, sub, children }: { titulo: string; sub: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-sm font-semibold tracking-wide text-ink-muted uppercase">{titulo}</h2>
      <p className="mt-1 text-sm text-ink-faint">{sub}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Tabela({
  cabecalho,
  linhas,
  vazio,
}: {
  cabecalho: string[];
  linhas: React.ReactNode[][];
  vazio: string;
}) {
  if (linhas.length === 0) return <Vazio texto={vazio} />;
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] tracking-wide text-ink-faint uppercase">
            {cabecalho.map((c) => (
              <th key={c} className="px-3 py-2 font-medium whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha, i) => (
            <tr key={i} className="border-t border-line-soft">
              {linha.map((celula, j) => (
                <td key={j} className="tnum px-3 py-2 whitespace-nowrap align-top">
                  {celula}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Vazio({ texto }: { texto: string }) {
  return (
    <p className="rounded-xl border border-dashed border-line px-6 py-8 text-center text-sm text-ink-faint">
      {texto}
    </p>
  );
}

function Status({ valor }: { valor: string }) {
  const ruim = valor === "FAILED";
  const andando = valor === "RUNNING" || valor === "PENDING" || valor === "ACKNOWLEDGED";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs",
        ruim ? "text-danger" : andando ? "text-warn" : "text-ink-muted",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full",
          ruim ? "bg-danger" : andando ? "bg-warn" : "bg-accent",
        )}
      />
      {valor.toLowerCase()}
    </span>
  );
}

function dataHora(d: Date) {
  return d
    .toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: FUSO })
    .replace(",", "");
}

function duracao(ms: number | null) {
  if (ms === null) return "—";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}
