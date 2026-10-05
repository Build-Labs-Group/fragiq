import { formatarNumero, getLocale } from "@/lib/formato";

/**
 * Calendário de calor: uma célula por dia, uma coluna por semana.
 *
 * Responde "quando eu jogo?" num olhar — a constância, as pausas, os fins
 * de semana — coisa que as barras de 30 dias não mostram. Cor sequencial de
 * um matiz só (a marca, em quatro degraus de opacidade) sobre o vazio
 * `--surface-2`: magnitude, não valência. Os degraus são quartis dos dias
 * com jogo, para um dia excepcional não apagar o resto.
 *
 * Hover sem JavaScript: `<title>` em cada célula (nativo, funciona no
 * toque longo) e o realce por CSS. A legenda "menos → mais" fica embaixo.
 */
export type DiaDoCalendario = { valor: number; detalhe?: string };

const CEL = 11;
const GAP = 3;
const PASSO = CEL + GAP;
const TOPO = 14;
const ESQ = 22;
const DIA_MS = 86_400_000;
const DIAS_SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];

export function Calendario({
  dias,
  semanas = 26,
  agora,
  unidade,
  className,
}: {
  dias: Map<string, DiaDoCalendario>;
  semanas?: number;
  agora: Date;
  /** "rounds", "partidas": o que o valor conta, para o hover. */
  unidade: string;
  className?: string;
}) {
  const { locale, tz } = getLocale();
  const chave = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: tz });
  const diaDaSemana = (d: Date) => new Date(`${chave(d)}T12:00:00Z`).getUTCDay();

  // A última coluna termina hoje; a primeira começa num domingo.
  const hoje = new Date(`${chave(agora)}T12:00:00Z`);
  const inicio = new Date(hoje.getTime() - ((semanas - 1) * 7 + diaDaSemana(hoje)) * DIA_MS);
  const celulas: { k: string; data: Date; col: number; lin: number; valor: number; detalhe?: string }[] = [];
  for (let t = inicio.getTime(), i = 0; t <= hoje.getTime(); t += DIA_MS, i++) {
    const data = new Date(t);
    const k = data.toISOString().slice(0, 10);
    const d = dias.get(k);
    celulas.push({ k, data, col: Math.floor(i / 7), lin: i % 7, valor: d?.valor ?? 0, detalhe: d?.detalhe });
  }
  const comJogo = celulas.filter((c) => c.valor > 0).map((c) => c.valor).sort((a, b) => a - b);
  const quartil = (q: number) => comJogo[Math.min(comJogo.length - 1, Math.floor(q * comJogo.length))] ?? 0;
  const cortes = [quartil(0.25), quartil(0.5), quartil(0.75)];
  const nivel = (v: number) => (v <= 0 ? 0 : v <= cortes[0] ? 1 : v <= cortes[1] ? 2 : v <= cortes[2] ? 3 : 4);
  const OPACIDADE = [0, 0.3, 0.5, 0.75, 1];

  const colunas = Math.max(...celulas.map((c) => c.col)) + 1;
  const W = ESQ + colunas * PASSO;
  const H = TOPO + 7 * PASSO;
  const meses = celulas.filter((c) => c.lin === 0 && (c.col === 0 || c.data.getUTCDate() <= 7));
  const ativos = comJogo.length;
  const total = comJogo.reduce((s, v) => s + v, 0);

  return (
    <div className={className}>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="calendario h-auto w-full min-w-[22rem]" role="img" aria-label={`${ativos} dias com jogo nas últimas ${semanas} semanas, ${formatarNumero(total)} ${unidade}`}>
          {meses.map((c) => (
            <text key={`m${c.k}`} x={ESQ + c.col * PASSO} y={9} fontSize="9" fill="var(--ink-faint)" fontFamily="var(--font-geist-mono)">
              {c.data.toLocaleDateString(locale, { month: "short", timeZone: "UTC" }).replace(".", "")}
            </text>
          ))}
          {[1, 3, 5].map((l) => (
            <text key={`d${l}`} x={0} y={TOPO + l * PASSO + CEL - 2} fontSize="8.5" fill="var(--ink-faint)" fontFamily="var(--font-geist-mono)">
              {DIAS_SEMANA[l]}
            </text>
          ))}
          {celulas.map((c) => {
            const n = nivel(c.valor);
            const data = c.data.toLocaleDateString(locale, { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" }).replace(/\./g, "");
            return (
              <rect
                key={c.k}
                className="cel"
                x={ESQ + c.col * PASSO}
                y={TOPO + c.lin * PASSO}
                width={CEL}
                height={CEL}
                rx="2.5"
                fill={n === 0 ? "var(--surface-2)" : "var(--accent)"}
                fillOpacity={n === 0 ? 1 : OPACIDADE[n]}
                stroke="var(--line-soft)"
                strokeWidth={n === 0 ? 1 : 0}
              >
                <title>{`${data} · ${c.valor ? `${formatarNumero(c.valor)} ${unidade}${c.detalhe ? ` · ${c.detalhe}` : ""}` : "sem jogo"}`}</title>
              </rect>
            );
          })}
        </svg>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-faint">
        <span className="tnum">
          {ativos} {ativos === 1 ? "dia" : "dias"} com jogo · {formatarNumero(total)} {unidade}
        </span>
        <span className="inline-flex items-center gap-1">
          menos
          {OPACIDADE.map((o, i) => (
            <span key={i} className="inline-block size-2.5 rounded-[3px] ring-1 ring-line-soft" style={{ background: i === 0 ? "var(--surface-2)" : "var(--accent)", opacity: i === 0 ? 1 : o }} />
          ))}
          mais
        </span>
      </div>
    </div>
  );
}
