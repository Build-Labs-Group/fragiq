import type { Sessao } from "@/lib/sessoes";
import type { Normal } from "@/lib/series";
import type { Leitura } from "@/lib/leituras";
import { CS2_PANEL } from "@/lib/cs2-panel";
import { calcularDelta } from "@/lib/delta";
import { formatarDuracao, formatarQuando, formatarStat } from "@/lib/formato";
import { DeltaChip } from "./delta-chip";
import { MarcarModo } from "./marcar-modo";
import { cn } from "@/lib/utils";

/**
 * A última sessão em três números, grandes.
 *
 * É a primeira coisa que a página mostra porque é a primeira pergunta de
 * quem acabou de jogar: "como foi?". Contexto em cima (modo, mapa, placar,
 * partidas, rounds, duração; o fim da sessão à direita), os três números
 * com o chip de delta e uma linha de referência cada, e no rodapé as
 * notas que qualificam a leitura — amostra curta, rounds em mapa que a
 * Steam não conta. O único `glow` da tela é este.
 */
export type NormaisDoHero = { kd: Normal; adr: Normal; hs: Normal };

export function SessaoHero({ sessao, normais, notas = [], lente }: { sessao: Sessao; normais: NormaisDoHero; notas?: Leitura[]; lente: string | null }) {
  const stats = {
    kd: CS2_PANEL.find((s) => s.key === "kd")!,
    adr: CS2_PANEL.find((s) => s.key === "adr")!,
    hs: CS2_PANEL.find((s) => s.key === "hs")!,
  };
  const fraco = sessao.rounds < stats.kd.amostra.minimo;
  const numeros = [
    { rotulo: "K/D", stat: stats.kd, valor: sessao.kd, normal: normais.kd },
    { rotulo: "Dano / round", stat: stats.adr, valor: sessao.danoPorRound, normal: normais.adr },
    { rotulo: "Headshot", stat: stats.hs, valor: sessao.hs, normal: normais.hs },
  ];

  return (
    <section className="glow relative overflow-hidden rounded-2xl bg-surface">
      <div className="grid-bg pointer-events-none absolute inset-0 opacity-60" aria-hidden />
      <div className="relative p-5 sm:p-7">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="hud">Última sessão</span>
          {sessao.modo ? (
            <span className={cn("rounded-full px-2.5 py-0.5 text-xs ring-1", lente && lente === sessao.modoId ? "bg-accent-soft text-accent ring-accent/40" : "text-ink-muted ring-line")}>
              ● {sessao.modo}
            </span>
          ) : (
            sessao.snapshotId && <MarcarModo snapshotId={sessao.snapshotId} />
          )}
          {sessao.mapa && <Chip>{sessao.mapa}</Chip>}
          {sessao.placar && <Chip>{sessao.placar}</Chip>}
          <span className="tnum text-xs text-ink-faint">
            {sessao.partidas ? `${sessao.partidas} ${sessao.partidas === 1 ? "partida" : "partidas"} · ` : ""}
            {sessao.rounds} r · {formatarDuracao(sessao.minutos)}
          </span>
          <time className="tnum ml-auto text-xs text-ink-faint" dateTime={sessao.ate.toISOString()} title={`${formatarQuando(sessao.de)} → ${formatarQuando(sessao.ate)}`} suppressHydrationWarning>
            {formatarQuando(sessao.ate)}
          </time>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-4 sm:gap-6">
          {numeros.map((n) => {
            const delta = calcularDelta(n.stat, n.valor, n.normal, fraco);
            return (
              <div key={n.rotulo} className="min-w-0">
                <p className="hud">{n.rotulo}</p>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <p className="num text-3xl font-semibold sm:text-5xl">{n.valor === null ? "—" : formatarStat(n.stat, n.valor)}</p>
                  <DeltaChip delta={delta} tamanho="md" />
                </div>
                <p className="num mt-1 truncate text-xs text-ink-faint" title={referencia(n.normal, n.stat)}>
                  {referencia(n.normal, n.stat)}
                </p>
              </div>
            );
          })}
        </div>

        {notas.length > 0 && (
          <div className="mt-5 flex flex-wrap gap-2">
            {notas.map((nota) => (
              <span key={nota.id} className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs ring-1", nota.tom === "aviso" ? "text-warn ring-warn/30" : "text-ink-muted ring-line")} title={nota.texto}>
                <span className="num font-medium">{nota.numero}</span>
                <span className="text-ink-faint">{nota.id === "amostra" ? "amostra curta" : "em mapa não contado"}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function referencia(normal: Normal, stat: (typeof CS2_PANEL)[number]): string {
  switch (normal.tipo) {
    case "vitalicio":
      return `vitalício ${formatarStat(stat, normal.valor)}`;
    case "modo":
      return `normal ${formatarStat(stat, normal.valor)} · ${normal.sessoes} sessões`;
    case "vitalicio-fraco":
      return `vs vitalício ${formatarStat(stat, normal.valor)} · ${normal.progresso.sessoes} de ${normal.progresso.minimo} sessões`;
    default:
      return "sem base";
  }
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full px-2.5 py-0.5 text-xs text-ink-muted ring-1 ring-line">{children}</span>;
}
