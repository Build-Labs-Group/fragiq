import type { Delta } from "@/lib/delta";
import { formatarNumero } from "@/lib/formato";
import { marcaDeConfianca } from "@/lib/sessoes";
import { pontosSimples } from "@/lib/series";
import { DeltaChip } from "./delta-chip";
import { Sparkline } from "./sparkline";
import { cn } from "@/lib/utils";

/**
 * Um insight materializado na tela: o visual, e a única linha de texto.
 *
 * O componente não calcula nada — recebe a linha de `insights` como o
 * banco a guarda e escolhe o desenho pelo `visual`. Toda linha cabe em
 * uma; o que não couber corta com reticências e vai inteiro no `title`
 * (docs/dados-confiaveis.md §4). A confiança vai como marca ao lado.
 */
export type InsightLinha = {
  id: string;
  regra: string;
  tom: "BOM" | "RUIM" | "NEUTRO" | "AVISO";
  confianca: "EXATA" | "INFERIDA" | "MISTA" | null;
  base: { rounds?: number; sessoes?: number; partidas?: number | null };
  visual: "CHIP" | "SELO" | "BARRA" | "SPARKLINE" | "RANK" | "ANEL";
  dados: Record<string, unknown>;
  linha: string;
  valor: number | null;
  referencia: number | null;
};

/**
 * O tom vai num filete à esquerda, não no texto inteiro. Com a linha toda
 * colorida, "K/D caindo 4%" em vermelho ao lado de "forma +85%" em verde
 * gritava duas coisas opostas com o mesmo volume; o filete diz a direção e
 * o texto fica legível e neutro, com o número em destaque pela tinta.
 */
const TOM: Record<InsightLinha["tom"], string> = {
  BOM: "bg-good",
  RUIM: "bg-bad",
  NEUTRO: "bg-ink-faint/50",
  AVISO: "bg-warn",
};
const TOM_NOME: Record<InsightLinha["tom"], string> = { BOM: "bom", RUIM: "ruim", NEUTRO: "neutro", AVISO: "aviso" };

export function Insight({ insight: i, className }: { insight: InsightLinha; className?: string }) {
  return (
    <div className={cn("relative flex items-center gap-3 overflow-hidden rounded-xl bg-surface py-2 pr-3 pl-4 ring-1 ring-line", className)}>
      <span className={cn("absolute inset-y-1.5 left-1.5 w-1 rounded-full", TOM[i.tom])} aria-hidden />
      <Visual insight={i} />
      <p className={cn("min-w-0 flex-1 truncate text-sm", i.tom === "AVISO" ? "text-ink-muted" : "text-ink")} title={`${i.linha}${base(i)}`}>
        <span className="sr-only">{TOM_NOME[i.tom]}: </span>
        {i.linha}
      </p>
      {i.confianca && (
        <span className="text-xs text-ink-faint" title={i.confianca === "EXATA" ? "modo exato" : i.confianca === "INFERIDA" ? "modo inferido" : "sem modo provado"}>
          {marcaDeConfianca(i.confianca)}
        </span>
      )}
    </div>
  );
}

function base(i: InsightLinha): string {
  const partes = [i.base.rounds ? `${i.base.rounds} rounds` : null, i.base.sessoes ? `${i.base.sessoes} sessões` : null].filter(Boolean);
  return partes.length ? ` · ${partes.join(" · ")}` : "";
}

function Visual({ insight: i }: { insight: InsightLinha }) {
  switch (i.visual) {
    case "CHIP": {
      const delta = i.dados.delta as Delta | null;
      return delta ? <DeltaChip delta={delta} /> : <span className="num w-10 text-center text-xs text-ink-faint">—</span>;
    }
    case "SELO": {
      const classe = i.dados.classe as string;
      const cor = classe === "acima" ? "bg-good-soft text-good" : classe === "abaixo" ? "bg-bad-soft text-bad" : "bg-surface-2 text-ink-muted";
      const icone = classe === "acima" ? "▲" : classe === "abaixo" ? "▼" : classe === "no-ruido" ? "≈" : "·";
      return <span className={cn("num inline-flex h-7 w-7 items-center justify-center rounded-full text-sm", cor)}>{icone}</span>;
    }
    case "SPARKLINE": {
      const pontos = (i.dados.pontos as { valor: number }[] | undefined) ?? [];
      return (
        <span className="w-24 shrink-0">
          <Sparkline pontos={pontosSimples(pontos.map((p) => p.valor))} normal={(i.dados.normal as number | null) ?? null} className="h-6 w-24" />
        </span>
      );
    }
    case "BARRA": {
      if ("cv" in i.dados) return <Faixa valor={(i.dados.cv as number | null) ?? null} faixas={i.dados.faixas as number[]} />;
      const atual = (i.dados.atual as number | null) ?? null;
      // A segunda barra é o que a regra usou como referência: o vitalício em
      // `forma.vs.vitalicio`, o normal da janela anterior em `arma.destaque`.
      const ref = ((i.dados.vitalicio ?? i.dados.referencia) as number | null) ?? null;
      return <BarraDupla atual={atual} referencia={ref} />;
    }
    case "RANK": {
      const linhas = (i.dados.linhas as { rotulo: string; delta: number }[] | undefined) ?? [];
      return <Rank linhas={linhas} />;
    }
    case "ANEL":
      return <Anel pct={(i.dados.pct as number | null) ?? null} />;
  }
}

function BarraDupla({ atual, referencia }: { atual: number | null; referencia: number | null }) {
  const max = Math.max(atual ?? 0, referencia ?? 0) || 1;
  const w = (v: number | null) => `${Math.round(((v ?? 0) / max) * 100)}%`;
  return (
    <span className="flex w-24 shrink-0 flex-col gap-0.5" aria-hidden>
      <span className="h-1.5 rounded bg-accent" style={{ width: w(atual) }} />
      <span className="h-1.5 rounded bg-ink-faint/60" style={{ width: w(referencia) }} />
    </span>
  );
}

function Faixa({ valor, faixas }: { valor: number | null; faixas: number[] }) {
  // Três faixas (baixa · média · alta); o marcador fica onde o CV caiu.
  const teto = (faixas[1] ?? 0.3) * 1.5;
  const pos = valor === null ? null : Math.min(100, (valor / teto) * 100);
  return (
    <span className="relative flex h-2 w-24 shrink-0 overflow-hidden rounded bg-surface-2" aria-hidden>
      <span className="h-full bg-good-soft" style={{ width: `${((faixas[0] ?? 0.15) / teto) * 100}%` }} />
      <span className="h-full bg-surface-2" style={{ width: `${(((faixas[1] ?? 0.3) - (faixas[0] ?? 0.15)) / teto) * 100}%` }} />
      <span className="h-full flex-1 bg-bad-soft" />
      {pos !== null && <span className="absolute top-0 h-full w-0.5 bg-ink" style={{ left: `${pos}%` }} />}
    </span>
  );
}

function Rank({ linhas }: { linhas: { rotulo: string; delta: number }[] }) {
  const top = linhas.slice(0, 3);
  const max = Math.max(...top.map((l) => Math.abs(l.delta)), 1);
  return (
    <span className="flex w-24 shrink-0 flex-col gap-0.5" aria-hidden>
      {top.map((l) => (
        <span key={l.rotulo} className="flex items-center gap-1">
          <span className={cn("h-1.5 rounded", l.delta >= 0 ? "bg-good" : "bg-bad")} style={{ width: `${Math.max(8, (Math.abs(l.delta) / max) * 70)}%` }} />
          <span className="num text-[9px] leading-none text-ink-faint">{l.rotulo.slice(0, 6)}</span>
        </span>
      ))}
    </span>
  );
}

function Anel({ pct }: { pct: number | null }) {
  const r = 10;
  const c = 2 * Math.PI * r;
  const p = pct ?? 0;
  return (
    <svg viewBox="0 0 28 28" className="h-7 w-7 shrink-0" aria-hidden>
      <circle cx="14" cy="14" r={r} fill="none" stroke="var(--line)" strokeWidth="4" />
      <circle cx="14" cy="14" r={r} fill="none" stroke="var(--accent)" strokeWidth="4" strokeDasharray={`${(p / 100) * c} ${c}`} transform="rotate(-90 14 14)" strokeLinecap="round" />
      <text x="14" y="17" textAnchor="middle" fontSize="8" fill="var(--ink-muted)" fontFamily="var(--font-geist-mono)">
        {pct === null ? "—" : formatarNumero(pct, 0)}
      </text>
    </svg>
  );
}
