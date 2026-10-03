import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { carregarFonte } from "@/lib/fonte";
import { listarSessoes, marcaDeConfianca } from "@/lib/sessoes";
import { CS2_PANEL } from "@/lib/cs2-panel";
import type { Delta } from "@/lib/delta";
import { formatarDuracao, formatarNumero, formatarQuando, formatarStat } from "@/lib/formato";
import { filtroDoModo, rotuloDoModo } from "@/lib/modo";
import { abasDoUsuario, modoDaRequisicao, type SearchParams } from "@/lib/modo-servidor";
import { chipsDeSessao } from "@/lib/insights/ler";
import { DeltaChip } from "@/components/delta-chip";
import { MarcarModo } from "@/components/marcar-modo";
import { Estado } from "@/components/estado";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Cada sessão como uma linha, comparável com o normal.
 *
 * A lente não esconde: as sessões fora do modo ficam na tabela, apagadas,
 * e um rótulo diz quantas são do modo. Sete linhas cabem na tela; esconder
 * cinco delas não ajuda ninguém. Sessão sem modo tem o chip `modo? ▾`: é
 * aqui que a marcação em massa acontece.
 *
 * O chip de K/D é lido de `Insight` (`kd.vs.normal`, casado pela coleta que
 * fechou a sessão), não recalculado aqui — a página não chama `calcularDelta`
 * nem `normaisDoHero`. Isso muda o sentido do chip, e a legenda diz: a
 * referência passou a ser o normal do **modo da própria sessão** (o vitalício
 * da coleta enquanto não há base), em vez do normal da lente. É por isso que
 * a linha fora do modo também tem chip agora: a comparação dela não depende
 * mais da aba em que se está.
 */
export default async function SessoesPage({ params, searchParams }: { params: Promise<{ appId: string }>; searchParams: SearchParams }) {
  const session = await requireSession();
  const appId = Number((await params).appId);
  const fonte = await carregarFonte(session.userId, appId);
  if (!fonte) notFound();
  const modo = await modoDaRequisicao(searchParams, await abasDoUsuario(session.userId, appId));
  const lente = filtroDoModo(modo)?.mode ?? null;

  const sessoes = listarSessoes(fonte.rows).reverse();
  if (sessoes.length === 0) {
    return <Estado titulo="Nenhuma sessão ainda" texto="Uma sessão é o que mudou entre duas leituras da Steam. Jogue uma partida de CS2 e ela aparece aqui." acao={{ rotulo: "Ver os primeiros passos", href: `/games/${appId}` }} />;
  }
  const kd = CS2_PANEL.find((s) => s.key === "kd")!;
  const adr = CS2_PANEL.find((s) => s.key === "adr")!;
  const hs = CS2_PANEL.find((s) => s.key === "hs")!;
  const doModo = lente ? sessoes.filter((s) => s.modoId === lente).length : sessoes.length;
  const chips = await chipsDeSessao(session.userId, appId);
  /** O chip materializado da linha, e a linha inteira do insight para o `title`. */
  const chipDe = (s: (typeof sessoes)[number]) => {
    const i = s.snapshotId ? chips.get(s.snapshotId) : undefined;
    return { delta: (i?.dados.delta as Delta | null) ?? null, titulo: i?.linha };
  };

  return (
    <div className="space-y-3">
      {lente && (
        <p className="num text-xs text-ink-faint">
          {doModo} de {sessoes.length} {sessoes.length === 1 ? "sessão" : "sessões"} em {rotuloDoModo(modo)}
          {doModo === 0 && <> · <a href={`/games/${appId}/sessoes`} className="text-accent hover:underline">ver todas</a></>}
        </p>
      )}
      {chips.size > 0 && (
        <p className="hud text-xs text-ink-faint">
          chip de K/D: cada sessão contra o normal do modo dela (vitalício enquanto não há base) — não muda com a aba
        </p>
      )}

      <div className="hidden overflow-x-auto rounded-2xl bg-surface ring-1 ring-line sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left">
              {["Quando", "Modo", "Mapa", "Placar", "Part.", "Rounds", "K/D", "Dano/round", "HS", "Min"].map((c, i) => (
                <th key={c} className={cn("hud px-4 py-3 font-normal whitespace-nowrap", i >= 4 && "text-right")}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="num">
            {sessoes.map((s) => {
              const fora = lente !== null && s.modoId !== lente;
              const { delta, titulo } = chipDe(s);
              return (
                <tr
                  key={s.ate.getTime()}
                  className={cn("border-t border-line-soft", fora && "text-ink-faint")}
                  title={`${s.kills ?? "—"} kills · ${s.deaths ?? "—"} deaths · ${s.mvps ?? "—"} MVP`}
                >
                  <td className="px-4 py-2.5 whitespace-nowrap text-ink-muted" suppressHydrationWarning>
                    {formatarQuando(s.ate)}
                  </td>
                  <td className="px-4 py-2.5 font-sans whitespace-nowrap">
                    {s.modo ? (
                      <span
                        className={cn(!fora && lente ? "text-accent" : "")}
                        title={s.confianca === "EXATA" ? "modo exato: uma partida, com prova" : "modo inferido: várias partidas, todas provadas do mesmo modo"}
                      >
                        {marcaDeConfianca(s.confianca)} {s.modo}
                      </span>
                    ) : s.confianca === "MISTA" && (s.partidas ?? 0) > 1 ? (
                      <span className="text-ink-faint" title="várias partidas sem prova de modo: não entra em nenhuma aba">○ misto</span>
                    ) : s.snapshotId ? (
                      <MarcarModo snapshotId={s.snapshotId} />
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-2.5 font-sans">{s.mapa ?? <span className="text-ink-faint">—</span>}</td>
                  <td className="px-4 py-2.5">{s.placar ?? <span className="text-ink-faint">—</span>}</td>
                  <td className="px-4 py-2.5 text-right">{s.partidas ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right">{s.rounds}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap" title={titulo}>
                    <span className="font-medium">{s.kd === null ? "—" : formatarStat(kd, s.kd)}</span>
                    {delta && <DeltaChip delta={delta} className="ml-2" />}
                  </td>
                  <td className="px-4 py-2.5 text-right">{s.danoPorRound === null ? "—" : formatarStat(adr, s.danoPorRound)}</td>
                  <td className="px-4 py-2.5 text-right">{s.hs === null ? "—" : formatarStat(hs, s.hs)}</td>
                  <td className="px-4 py-2.5 text-right text-ink-muted">{formatarNumero(s.minutos)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ol className="space-y-2 sm:hidden">
        {sessoes.map((s) => {
          const fora = lente !== null && s.modoId !== lente;
          const { delta, titulo } = chipDe(s);
          return (
            <li key={s.ate.getTime()} className={cn("rounded-2xl bg-surface p-4 ring-1 ring-line", fora && "opacity-60")}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
                <span className="tnum" suppressHydrationWarning>
                  {formatarQuando(s.ate)}
                </span>
                {s.modo ? <span className={cn(!fora && lente && "text-accent")}>● {s.modo}</span> : s.snapshotId ? <MarcarModo snapshotId={s.snapshotId} /> : null}
                {s.mapa && <span>{s.mapa}</span>}
                {s.placar && <span className="num">{s.placar}</span>}
              </div>
              <div className="num mt-2 flex flex-wrap items-baseline gap-x-3 text-sm" title={titulo}>
                <span className="text-lg font-semibold">{s.kd === null ? "—" : formatarStat(kd, s.kd)}</span>
                {delta && <DeltaChip delta={delta} />}
                <span className="text-ink-muted">{s.danoPorRound === null ? "—" : formatarStat(adr, s.danoPorRound)}</span>
                <span className="text-ink-muted">{s.hs === null ? "—" : formatarStat(hs, s.hs)}</span>
                <span className="text-ink-faint">{s.rounds} r · {formatarDuracao(s.minutos)}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
