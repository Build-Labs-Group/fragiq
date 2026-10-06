"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { AnaliseDTO, NumeroDaSessao } from "@/lib/analises";
import type { AchadoDaTela, LeituraLimpa } from "@/lib/achados";
import type { AnaliseLida } from "@/lib/analise-texto";
import type { EstadoDaAnalise } from "@/lib/analise-sessao";
import { formatarQuando } from "@/lib/formato";
import { DeltaChip } from "@/components/delta-chip";
import { Regua } from "@/components/graficos/regua";
import { cn } from "@/lib/utils";

/**
 * A análise de cada sessão, um cartão por sessão.
 *
 * Toda coleta que fecha uma sessão dispara uma leitura do analista — no
 * sync, no cron, no bot, e quando o scoreboard da partida chega do GC.
 * Não há caixa de pergunta: as análises são disparadas por nós.
 *
 * O cartão é desenhado, não lido (docs/dados-confiaveis.md §4), e todo
 * número nele é nosso: os três da sessão vêm dos insights materializados
 * (os mesmos da tabela de Sessões), e os achados do modelo chegam
 * recalculados da sessão, com a direção da tabela do código
 * (`lib/achados.ts`, `lib/direcao.ts`). Do modelo ficam a escolha do que
 * destacar, a manchete, a causa e a ação, já limpas.
 *
 * O texto só aparece quando o servidor diz `estado: "ok"`: análise de uma
 * sessão que mudou, com números de outra sessão ou ilegível não vai para a
 * tela — o cartão diz por quê e a análise é pedida de novo (sozinha, para a
 * mais recente; por botão, para as outras). JSON nunca chega aqui.
 *
 * A resposta vem por callback, então a lista é consultada enquanto há algo
 * em aberto e para quando não há.
 */

const INTERVALO_MS = 2500;

export function Analista({
  appId,
  iniciais,
  sessaoSemAnalise,
  apresentacao = "completa",
  modo,
}: {
  appId: number;
  iniciais: AnaliseDTO[];
  /** A sessão mais recente ainda não tem análise: pedir ao montar. */
  sessaoSemAnalise: boolean;
  /** "resumo" mostra só a mais recente, colapsada, com o atalho para o histórico. */
  apresentacao?: "resumo" | "completa";
  /** O modo do submenu, para a consulta de atualização trazer a mesma lista. */
  modo?: string;
}) {
  const [analises, setAnalises] = useState<AnaliseDTO[]>(iniciais);
  const pediuSessao = useRef(false);
  const refeitaSozinha = useRef<string | null>(null);

  useEffect(() => setAnalises(iniciais), [iniciais]);

  const emAberto = analises.some((a) => a.estado === "pendente");

  const recarregar = useCallback(async () => {
    const query = new URLSearchParams({ appId: String(appId) });
    if (modo && modo !== "tudo") query.set("modo", modo);
    const res = await fetch(`/api/analises?${query}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { analyses: AnaliseDTO[] };
    setAnalises(data.analyses);
  }, [appId, modo]);

  const pedir = useCallback(
    async (analiseId?: string) => {
      await fetch("/api/analises", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(analiseId ? { appId, analiseId } : { appId }),
      }).catch(() => {});
      await recarregar();
    },
    [appId, recarregar],
  );

  useEffect(() => {
    if (!sessaoSemAnalise || pediuSessao.current) return;
    pediuSessao.current = true;
    void pedir();
  }, [sessaoSemAnalise, pedir]);

  const sessoes = analises.filter((a) => a.kind === "SESSION");
  const [ultima, ...anteriores] = sessoes;

  // A mais recente que não pode ir para a tela é pedida de novo uma vez,
  // sem clique: é a que a pessoa veio ver.
  useEffect(() => {
    if (!ultima?.podePedirDeNovo || refeitaSozinha.current === ultima.id) return;
    refeitaSozinha.current = ultima.id;
    void pedir(ultima.id);
  }, [ultima, pedir]);

  useEffect(() => {
    if (!emAberto) return;
    const id = setInterval(recarregar, INTERVALO_MS);
    return () => clearInterval(id);
  }, [emAberto, recarregar]);

  const aguardandoSessao = !ultima && sessaoSemAnalise;

  return (
    <div>
      {ultima ? (
        <Cartao analise={ultima} pedir={pedir} />
      ) : (
        <div className="rounded-2xl bg-surface p-5 ring-1 ring-line">
          {aguardandoSessao ? <Skeleton /> : <p className="text-sm text-ink-faint">Sem sessão para analisar ainda.</p>}
        </div>
      )}

      {apresentacao === "resumo" ? (
        anteriores.length > 0 && (
          <Link
            href={`/games/${appId}/analista${modo && modo !== "tudo" ? `?modo=${modo}` : ""}`}
            className="mt-3 inline-flex items-center gap-2 text-sm text-ink-faint transition hover:text-ink"
          >
            Análises anteriores ({anteriores.length}) <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        )
      ) : (
        anteriores.length > 0 && (
          <>
            <p className="hud mt-8 mb-3">Anteriores</p>
            <ol className="space-y-3">
              {anteriores.map((a) => (
                <li key={a.id}>
                  <Cartao analise={a} pedir={pedir} />
                </li>
              ))}
            </ol>
          </>
        )
      )}
    </div>
  );
}

/* --------------------------------- cartão -------------------------------- */

function Cartao({ analise, pedir }: { analise: AnaliseDTO; pedir: (analiseId?: string) => Promise<void> }) {
  const data = new Date(analise.sessaoEm ?? analise.createdAt);
  const s = analise.sessao;

  return (
    <article className="rounded-2xl bg-surface p-5 ring-1 ring-line">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {s?.modoRotulo && <Chip forte>● {s.modoRotulo}</Chip>}
        {s?.mapa && <Chip>{s.mapa}</Chip>}
        {s?.placar && <Chip>{s.placar}</Chip>}
        {s && (
          <span className="tnum text-xs text-ink-faint">
            {s.partidas ? `${s.partidas} ${s.partidas === 1 ? "partida" : "partidas"} · ` : ""}
            {s.rounds} r
          </span>
        )}
        <time className="tnum ml-auto text-xs text-ink-faint" dateTime={data.toISOString()} suppressHydrationWarning>
          {formatarQuando(data)}
        </time>
      </header>

      <div className="mt-3">
        {s && <Tiles numeros={s.numeros} />}
        <Corpo analise={analise} pedir={pedir} />
      </div>
    </article>
  );
}

function Chip({ children, forte = false }: { children: React.ReactNode; forte?: boolean }) {
  return (
    <span className={cn("rounded-full px-2.5 py-0.5 text-xs ring-1", forte ? "bg-accent-soft text-accent ring-accent/40" : "text-ink-muted ring-line")}>
      {children}
    </span>
  );
}

/** Por que o texto não está na tela, dito em uma linha. */
const SEM_TEXTO: Record<Exclude<EstadoDaAnalise, "ok" | "pendente">, string> = {
  falhou: "O analista não respondeu desta vez.",
  desatualizada: "A sessão mudou depois da análise (partidas reagrupadas); a análise antiga não vale mais.",
  "outra-sessao": "A análise citava números de outra sessão e foi descartada.",
  ilegivel: "A resposta do analista veio num formato que não dá para ler.",
  incompleta: "Contadores incompletos da Steam nesta sessão: não há o que analisar.",
};

function Corpo({ analise, pedir }: { analise: AnaliseDTO; pedir: (analiseId?: string) => Promise<void> }) {
  if (analise.estado === "pendente") return <Skeleton />;
  if (analise.estado === "ok" && analise.leitura) {
    return analise.leitura.forma === "estruturada" ? <Resposta leitura={analise.leitura.leitura} /> : <RespostaLegada lida={analise.leitura.lida} />;
  }
  const estado = analise.estado === "ok" ? "ilegivel" : analise.estado;
  return <SemTexto motivo={SEM_TEXTO[estado]} podePedir={analise.podePedirDeNovo} pedir={() => pedir(analise.id)} />;
}

function Skeleton() {
  return (
    <div className="space-y-2" aria-label="Lendo a sua série…" role="status">
      <div className="h-6 w-1/2 animate-pulse rounded bg-surface-2" />
      <div className="h-3 w-4/5 animate-pulse rounded bg-surface-2" />
      <div className="h-3 w-full animate-pulse rounded bg-surface-2" />
      <div className="h-3 w-2/3 animate-pulse rounded bg-surface-2" />
    </div>
  );
}

function SemTexto({ motivo, podePedir, pedir }: { motivo: string; podePedir: boolean; pedir: () => Promise<void> }) {
  const [ocupado, setOcupado] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <p className="text-sm text-ink-faint">{motivo}</p>
      {podePedir && (
        <button
          type="button"
          disabled={ocupado}
          onClick={() => {
            setOcupado(true);
            void pedir().finally(() => setOcupado(false));
          }}
          className="text-sm text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-accent disabled:opacity-50"
        >
          Pedir de novo
        </button>
      )}
    </div>
  );
}

/**
 * Os três números da sessão, como a tabela de Sessões os mostra: o valor,
 * o chip do insight e a referência por extenso. Sem número, o motivo.
 */
function Tiles({ numeros }: { numeros: NumeroDaSessao[] }) {
  return (
    <div className="mb-3 grid grid-cols-3 gap-2">
      {numeros.map((n) => (
        <div key={n.chave} className="min-w-0 rounded-xl bg-surface-2/60 px-3 py-2">
          <p className="hud text-[10px]">{n.rotulo}</p>
          <p className="num flex flex-wrap items-baseline gap-x-2 text-lg font-semibold">
            {n.texto}
            {n.delta && <DeltaChip delta={n.delta} />}
          </p>
          {(n.referencia ?? n.motivo) && (
            <p className="truncate text-[11px] text-ink-faint" title={n.referencia ?? n.motivo ?? undefined}>
              {n.referencia ?? n.motivo}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

/** Um achado: rótulo, a régua (sessão × normal na hora), o número, o chip e a base. */
function AchadoLinha({ achado: a }: { achado: AchadoDaTela }) {
  const valencia = a.delta.estado === "ok" ? a.delta.valencia : null;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-1.5">
      <div className="min-w-0">
        <p className="truncate text-sm" title={`${a.rotulo} · ${a.base}`}>
          <span className="font-medium text-ink">{a.rotulo}</span>
          <span className="text-ink-faint"> · {a.base}</span>
        </p>
        <Regua className="mt-1.5" valor={a.valor} referencia={a.referencia} valencia={valencia} emPct={a.emPct} />
      </div>
      <p className="num flex items-center gap-2 text-sm whitespace-nowrap">
        <span className="font-semibold">{a.texto}</span>
        {a.textoReferencia && <span className="text-ink-faint">{a.textoReferencia}</span>}
        <DeltaChip delta={a.delta} />
      </p>
    </li>
  );
}

function Resposta({ leitura }: { leitura: LeituraLimpa }) {
  return (
    <div>
      <p className="truncate text-xl font-semibold tracking-tight text-ink" title={leitura.manchete}>
        {leitura.manchete}
      </p>
      {leitura.achados.length > 0 && (
        <ul className="mt-2 divide-y divide-line-soft">
          {leitura.achados.map((a) => (
            <AchadoLinha key={a.id} achado={a} />
          ))}
        </ul>
      )}
      {leitura.causa && (
        <p className="mt-2 truncate text-sm text-ink-muted" title={leitura.causa}>
          <span className="hud mr-2">porque</span>
          {leitura.causa}
        </p>
      )}
      {leitura.acao && <Acao texto={leitura.acao} />}
    </div>
  );
}

function Acao({ texto }: { texto: string }) {
  return (
    <p className="mt-3 flex items-center gap-2.5 rounded-xl border border-accent/30 bg-accent-soft/60 px-4 py-2.5 text-sm text-ink">
      <ArrowRight className="size-4 shrink-0 text-accent" aria-hidden />
      <span className="hud text-accent">próxima</span>
      <span className="truncate" title={texto}>
        {comNegrito(texto)}
      </span>
    </p>
  );
}

/**
 * Análises anteriores a 17/09/2026 vieram em prosa. Ficam numa linha —
 * manchete ou primeira frase — com "ler" para abrir o texto; a ação, que
 * sempre foi uma linha, continua em destaque.
 */
function RespostaLegada({ lida }: { lida: AnaliseLida }) {
  const { manchete, paragrafos, acao } = lida;
  const [aberto, setAberto] = useState(false);
  const primeira = manchete ?? paragrafos[0]?.split(/(?<=[.!?])\s/)[0] ?? "";
  return (
    <div>
      <p className="flex items-baseline gap-2">
        <span className="min-w-0 truncate text-base font-medium text-ink" title={primeira}>
          {comNegrito(primeira)}
        </span>
        {paragrafos.length > 0 && (
          <button type="button" onClick={() => setAberto((v) => !v)} className="shrink-0 text-xs text-ink-faint transition hover:text-ink">
            {aberto ? "fechar ▴" : "ler ▾"}
          </button>
        )}
      </p>
      {aberto && (
        <div className="mt-2 space-y-2 text-sm leading-relaxed text-ink-muted">
          {paragrafos.map((bloco, i) => (
            <p key={i}>{comNegrito(bloco.replace(/^\s*[-•*]\s+/gm, "").split("\n").join(" "))}</p>
          ))}
        </div>
      )}
      {acao && <Acao texto={acao} />}
    </div>
  );
}

function comNegrito(texto: string) {
  const partes = texto.split(/(\*\*[^*]+\*\*)/g);
  return partes.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? (
      <strong key={i} className="font-semibold text-ink">
        {p.slice(2, -2)}
      </strong>
    ) : (
      p
    ),
  );
}
