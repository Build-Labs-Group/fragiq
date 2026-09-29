import type { Sessao } from "@/lib/sessoes";
import { calcularDelta } from "@/lib/delta";
import { formatarDia, formatarNumero, getLocale } from "@/lib/formato";
import { rotularModo } from "@/lib/cs2-labels";
import { DeltaChip } from "./delta-chip";
import { Secao } from "./secao";

/**
 * Quanto a pessoa jogou: os últimos 30 dias contra os 30 anteriores, e o
 * ritmo dia a dia.
 *
 * É volume, não desempenho — por isso nenhum chip aqui é verde ou
 * vermelho (`melhorQuando: "nenhuma"`): jogar mais não é "melhor". Os
 * cinco números são contagens das sessões que fecharam em cada janela; a
 * referência é a janela anterior, dita como tal.
 *
 * O gráfico é por dia **em que a sessão fechou** (a coleta), que é a
 * única data que a sessão tem com prova — uma noite que termina na coleta
 * das 05:00 cai no dia seguinte, e a legenda diz isso. Com lente, a parte
 * do modo acende e o resto fica apagado: a série é inteira, o modo destaca
 * (docs/design.md §1.2).
 */

const DIA_MS = 86_400_000;
const JANELA = 30;

type Totais = { sessoes: number; partidas: number; rounds: number; minutos: number; dias: number };

function totais(sessoes: Sessao[], chave: (d: Date) => string): Totais {
  return {
    sessoes: sessoes.length,
    partidas: sessoes.reduce((s, x) => s + (x.partidas ?? 0), 0),
    rounds: sessoes.reduce((s, x) => s + x.rounds, 0),
    minutos: sessoes.reduce((s, x) => s + Math.max(0, x.minutos), 0),
    dias: new Set(sessoes.map((x) => chave(x.ate))).size,
  };
}

export function Atividade({ sessoes, lente, agora }: { sessoes: Sessao[]; lente: string | null; agora: Date }) {
  if (sessoes.length === 0) return null;
  const { tz } = getLocale();
  const chave = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: tz });

  const fim = agora.getTime();
  const naJanela = (s: Sessao, de: number, ate: number) => s.ate.getTime() > de && s.ate.getTime() <= ate;
  const atual = sessoes.filter((s) => naJanela(s, fim - JANELA * DIA_MS, fim));
  const anterior = sessoes.filter((s) => naJanela(s, fim - 2 * JANELA * DIA_MS, fim - JANELA * DIA_MS));
  const a = totais(atual, chave);
  const b = totais(anterior, chave);
  // Sem nenhuma sessão nos dois meses, o bloco seria uma fileira de zeros.
  if (a.sessoes === 0 && b.sessoes === 0) return null;

  const kpis: { rotulo: string; valor: number; antes: number; texto: (v: number) => string }[] = [
    { rotulo: "sessões", valor: a.sessoes, antes: b.sessoes, texto: (v) => formatarNumero(v) },
    { rotulo: "partidas", valor: a.partidas, antes: b.partidas, texto: (v) => formatarNumero(v) },
    { rotulo: "rounds", valor: a.rounds, antes: b.rounds, texto: (v) => formatarNumero(v) },
    { rotulo: "horas em partida", valor: a.minutos, antes: b.minutos, texto: (v) => `${formatarNumero(v / 60, v < 600 ? 1 : 0)} h` },
    { rotulo: "dias com sessão", valor: a.dias, antes: b.dias, texto: (v) => `${formatarNumero(v)} de ${JANELA}` },
  ];

  // Um ponto por dia, com os dias vazios no eixo: pular os zeros mentiria sobre o ritmo.
  const dias = Array.from({ length: JANELA }, (_, i) => {
    const d = new Date(fim - (JANELA - 1 - i) * DIA_MS);
    return { chave: chave(d), data: d, doModo: 0, outros: 0, sessoes: 0 };
  });
  const porChave = new Map(dias.map((d) => [d.chave, d]));
  for (const s of atual) {
    const dia = porChave.get(chave(s.ate));
    if (!dia) continue;
    dia.sessoes++;
    if (lente && s.modoId !== lente) dia.outros += s.rounds;
    else dia.doModo += s.rounds;
  }
  const doModoNoMes = lente ? atual.filter((s) => s.modoId === lente).reduce((t, s) => t + s.rounds, 0) : null;

  return (
    <Secao titulo="Atividade · 30 dias">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {kpis.map((k, i) => {
          const delta = b.sessoes > 0 ? calcularDelta({ melhorQuando: "nenhuma" }, k.valor, { tipo: "vitalicio", valor: k.antes, rotulo: "vitalício" }) : null;
          return (
            <div key={k.rotulo} className="entrar rounded-2xl bg-surface p-4 ring-1 ring-line" style={{ "--i": i } as React.CSSProperties}>
              <p className="hud">{k.rotulo}</p>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="num text-2xl font-semibold">{k.texto(k.valor)}</span>
                {delta && <DeltaChip delta={delta} />}
              </div>
              <p className="num mt-1 text-xs text-ink-faint">{b.sessoes > 0 ? `30 dias antes · ${k.texto(k.antes)}` : "sem mês anterior"}</p>
            </div>
          );
        })}
      </div>
      <BarrasDoMes dias={dias} lente={lente} doModoNoMes={doModoNoMes} total={a.rounds} />
    </Secao>
  );
}

/**
 * As barras são SVG esticado (`preserveAspectRatio="none"`) para ocupar a
 * largura do cartão em qualquer tela; por isso nenhum texto mora dentro
 * dele — texto esticado deforma. O eixo de datas e o pico são HTML.
 */
const W = 300;
const H = 100;
const GAP = 0.9;

function BarrasDoMes({
  dias,
  lente,
  doModoNoMes,
  total,
}: {
  dias: { chave: string; data: Date; doModo: number; outros: number; sessoes: number }[];
  lente: string | null;
  doModoNoMes: number | null;
  total: number;
}) {
  const max = Math.max(1, ...dias.map((d) => d.doModo + d.outros));
  const largura = W / dias.length;
  const altura = (v: number) => (H * v) / max;
  const pico = dias.reduce((m, d) => (d.doModo + d.outros > m.doModo + m.outros ? d : m), dias[0]);
  const rotuloModo = lente ? rotularModo(lente) : null;
  const marcas = dias.filter((_, i) => (dias.length - 1 - i) % 7 === 0);

  return (
    <figure className="entrar mt-3 rounded-2xl bg-surface p-4 ring-1 ring-line sm:p-5" style={{ "--i": 5 } as React.CSSProperties}>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="hud">rounds por dia</span>
        <span className="tnum flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">
          {rotuloModo && doModoNoMes !== null ? (
            <>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-sm bg-accent" aria-hidden /> {rotuloModo} {formatarNumero(doModoNoMes)}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-sm bg-line" aria-hidden /> outros {formatarNumero(total - doModoNoMes)}
              </span>
            </>
          ) : (
            <span>{formatarNumero(total)} no total</span>
          )}
          {pico.doModo + pico.outros > 0 && (
            <span>
              pico {formatarNumero(pico.doModo + pico.outros)} · {formatarDia(pico.data)}
            </span>
          )}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="mt-4 h-28 w-full overflow-visible sm:h-36"
        role="img"
        aria-label={`Rounds por dia nos últimos 30 dias: ${total} no total`}
      >
        {dias.map((d, i) => {
          const x = i * largura + GAP / 2;
          const w = Math.max(0.5, largura - GAP);
          const hModo = altura(d.doModo);
          const hOutros = altura(d.outros);
          const soma = d.doModo + d.outros;
          const ultimo = i === dias.length - 1;
          return (
            <g key={d.chave} className="barra">
              <title>
                {`${formatarDia(d.data)} · ${soma ? `${formatarNumero(soma)} rounds em ${d.sessoes} ${d.sessoes === 1 ? "sessão" : "sessões"}` : "sem sessão"}${lente && soma ? ` · ${formatarNumero(d.doModo)} de ${rotuloModo}` : ""}`}
              </title>
              {/* A faixa inteira do dia, invisível: o hover pega o dia mesmo sem barra. */}
              <rect x={i * largura} y={0} width={largura} height={H} fill="transparent" />
              {soma === 0 && <rect x={x} y={H - 1} width={w} height={1} fill="var(--line-soft)" />}
              {d.outros > 0 && <rect className="crescer" style={{ "--i": i } as React.CSSProperties} x={x} y={H - hOutros} width={w} height={hOutros} fill="var(--line)" />}
              {d.doModo > 0 && (
                <rect
                  className="crescer"
                  style={{ "--i": i } as React.CSSProperties}
                  x={x}
                  y={H - hOutros - hModo}
                  width={w}
                  height={hModo}
                  fill="var(--accent)"
                  opacity={ultimo ? 1 : 0.8}
                />
              )}
            </g>
          );
        })}
      </svg>
      <div className="relative mt-2 h-4 border-t border-line">
        {marcas.map((d) => {
          const i = dias.indexOf(d);
          const centro = ((i + 0.5) / dias.length) * 100;
          const ultimo = i === dias.length - 1;
          return (
            <span
              key={d.chave}
              className="tnum absolute top-1 text-[10px] whitespace-nowrap text-ink-faint"
              style={ultimo ? { right: 0 } : { left: `${centro}%`, transform: "translateX(-50%)" }}
            >
              {ultimo ? "hoje" : formatarDia(d.data)}
            </span>
          );
        })}
      </div>
    </figure>
  );
}
