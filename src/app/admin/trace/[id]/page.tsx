import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { isAdmin } from "@/lib/admin";
import { carregarCadeia } from "@/lib/admin-dados-confiaveis";
import { dataHora, Vazio } from "../../_pecas";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Um trace, do "o bot viu" ao "o número na tela": cada linha é um fato que
 * carrega o mesmo `traceId`, na ordem em que aconteceu.
 */
export default async function TracePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) redirect("/");
  if (!isAdmin(session.steamId)) notFound();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const c = await carregarCadeia(id);

  type Passo = { em: Date; etapa: string; linha: string; tom?: "ok" | "erro" | "aviso" };
  const passos: Passo[] = [
    ...c.observacoes.map((o) => ({ em: o.observedAt, etapa: "observação", linha: `${o.kind === "MATCH_ENDED" ? "fim de partida" : "saiu do jogo"} · ${[o.mode, o.map, o.score].filter(Boolean).join(" · ") || "sem contexto"} · ${o.steamId.slice(-6)}` })),
    ...c.logs.map((l) => ({ em: l.em, etapa: "bot", linha: l.mensagem, tom: l.nivel === "ERROR" ? ("erro" as const) : l.nivel === "WARN" ? ("aviso" as const) : undefined })),
    ...(c.captura ? [{ em: c.captura.createdAt, etapa: "captura", linha: `pendente · tentativa ${c.captura.tentativa} · próxima ${dataHora(c.captura.proximaEm)}`, tom: "aviso" as const }] : []),
    ...c.runs.map((r) => ({ em: r.startedAt, etapa: "coleta", linha: `${r.trigger} · ${r.status}${r.error ? ` · ${r.error}` : ""}`, tom: r.status === "FAILED" ? ("erro" as const) : r.status === "SUCCESS" ? ("ok" as const) : undefined })),
    ...c.snapshots.map((s) => ({ em: s.capturedAt, etapa: "ponto", linha: `app ${s.gameAppId} · ${s.trigger ?? "?"} · modo ${s.matchMode ?? "—"}`, tom: "ok" as const })),
    ...c.sessoes.map((s) => ({ em: s.ate, etapa: "sessão", linha: `${s.rounds} rounds · ${s.modo ?? "sem modo"} · ${s.modoConfianca} · regra v${s.regraVersao}`, tom: s.modoConfianca === "MISTA" ? ("aviso" as const) : ("ok" as const) })),
    ...c.insights.map((i) => ({ em: c.sessoes[0]?.ate ?? new Date(0), etapa: "insight", linha: `${i.regra} v${i.regraVersao} · ${i.linha}` })),
    ...c.eventos.map((e) => ({ em: e.createdAt, etapa: "evento", linha: `${e.nome}${e.dados ? ` · ${JSON.stringify(e.dados).slice(0, 80)}` : ""}` })),
  ].sort((a, b) => a.em.getTime() - b.em.getTime());

  return (
    <main id="conteudo" tabIndex={-1} className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <p className="text-xs text-ink-faint"><Link href="/admin" className="hover:underline">Painel</Link> · trace</p>
      <h1 className="mt-1 font-mono text-lg">{id}</h1>
      <p className="mt-1 text-sm text-ink-muted">
        {c.observacoes.length} obs · {c.runs.length} coletas · {c.snapshots.length} pontos · {c.sessoes.length} sessões · {c.insights.length} insights
      </p>
      {passos.length === 0 ? (
        <div className="mt-6"><Vazio texto="Nada carrega este trace." /></div>
      ) : (
        <ol className="mt-6 space-y-1">
          {passos.map((p, i) => (
            <li key={i} className="grid grid-cols-[110px_90px_minmax(0,1fr)] items-baseline gap-3 rounded-lg px-3 py-1.5 text-sm odd:bg-surface">
              <span className="num text-xs text-ink-faint" suppressHydrationWarning>{dataHora(p.em)}</span>
              <span className={cn("font-mono text-xs", p.tom === "erro" && "text-danger", p.tom === "aviso" && "text-warn", p.tom === "ok" && "text-good")}>{p.etapa}</span>
              <span className="truncate" title={p.linha}>{p.linha}</span>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
