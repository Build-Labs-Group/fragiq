import Image from "next/image";
import type { Panorama } from "@/lib/comunidade-dados";
import { MIN_PARTIDAS_RANKING } from "@/lib/comunidade-dados";
import { formatarDia, formatarNumero } from "@/lib/formato";
import { rotularMapa } from "@/lib/cs2-labels";
import { identidadeDoMapa } from "@/lib/mapas";
import { recorteComunidade, type Recorte } from "@/lib/recortes";
import { Quadro } from "./graficos/quadro";
import { Ranking } from "./graficos/ranking";
import { Medidor } from "./graficos/medidor";
import { Distribuicao } from "./graficos/distribuicao";
import { GradeHoras } from "./graficos/grade-horas";
import { RecorteChip } from "./graficos/recorte";

/**
 * "O CS2 que o FragIQ vê": o panorama público da Comunidade.
 *
 * Tudo agregado das partidas oficiais gravadas — os dez jogadores de cada
 * uma —, sem nome de ninguém, exceto no ranking, que só tem conta do FragIQ
 * com perfil público (`lib/comunidade-dados.ts`). Cada bloco diz o seu
 * recorte; o rodapé diz a amostra.
 */
const ECONOMIA: Record<"eco" | "meia" | "cheia", { rotulo: string; detalhe: string }> = {
  eco: { rotulo: "eco", detalhe: "time quase sem comprar" },
  meia: { rotulo: "força", detalhe: "compra parcial" },
  cheia: { rotulo: "compra cheia", detalhe: "fuzil e colete" },
};

export function PanoramaComunidade({ panorama, voce }: { panorama: Panorama; voce: { kd: number | null; nome: string } | null }) {
  const { totais } = panorama;
  if (totais.partidas === 0) return null;
  const recorte = recorteComunidade(totais.jogadores, totais.partidas);
  const demos: Recorte = { tipo: "demos", rotulo: `${formatarNumero(totais.demos)} demos`, detalhe: "Rounds lidos das demos das partidas, round a round." };
  const kpis = [
    { rotulo: "partidas oficiais", valor: totais.partidas },
    { rotulo: "jogadores vistos", valor: totais.jogadores },
    { rotulo: "rounds", valor: totais.rounds },
    { rotulo: "demos lidas", valor: totais.demos },
  ];
  const economia = panorama.economia.filter((e) => e.tipo !== "pistol" && e.rounds > 0) as { tipo: "eco" | "meia" | "cheia"; rounds: number; ganhos: number }[];
  const maisJogado = Math.max(...panorama.mapas.map((m) => m.partidas), 1);

  return (
    <section aria-labelledby="panorama">
      <div className="flex flex-wrap items-center gap-2">
        <p id="panorama" className="hud">O CS2 que o FragIQ vê</p>
        <RecorteChip recorte={recorte} />
        {totais.desde && <span className="text-[11px] text-ink-faint">desde {formatarDia(new Date(totais.desde))}</span>}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k, i) => (
          <div key={k.rotulo} className="entrar rounded-2xl bg-surface p-4 ring-1 ring-line" style={{ "--i": i } as React.CSSProperties}>
            <p className="hud">{k.rotulo}</p>
            <p className="num mt-2 text-2xl font-semibold">{formatarNumero(k.valor)}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <Quadro titulo="Mapas mais jogados" recorte={recorte} rodape="barra = partidas · à direita, quantas foram à prorrogação">
          <Ranking
            escala={maisJogado}
            linhas={panorama.mapas.slice(0, 8).map((m) => {
              const id = identidadeDoMapa(m.mapa);
              return {
                id: m.mapa,
                rotulo: rotularMapa(m.mapa),
                icone: <span className="size-2.5 shrink-0 rounded-sm" style={{ background: `linear-gradient(135deg, ${id.de}, ${id.para})` }} aria-hidden />,
                valor: m.partidas,
                texto: formatarNumero(m.partidas),
                base: `${formatarNumero((m.prorrogacoes / m.partidas) * 100)}% prorr.`,
              };
            })}
          />
        </Quadro>

        <Quadro titulo="Quem ganha o round, pela compra" recorte={demos} rodape="rounds ganhos pelo time naquela situação de compra, somando as demos lidas">
          {economia.length === 0 ? (
            <p className="py-8 text-center text-xs text-ink-faint">Nenhuma demo lida ainda.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {economia.map((e) => (
                <div key={e.tipo} className="flex flex-col items-center text-center">
                  <Medidor pct={(e.ganhos / e.rounds) * 100} rotulo={`rounds de ${ECONOMIA[e.tipo].rotulo} ganhos`} className="h-24 w-28" />
                  <p className="hud -mt-1">{ECONOMIA[e.tipo].rotulo}</p>
                  <p className="num mt-0.5 text-[11px] text-ink-faint">
                    {formatarNumero(e.ganhos)} de {formatarNumero(e.rounds)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Quadro>

        <Quadro titulo="K/D na fila" recorte={recorte} rodape="cada barra, jogadores com K/D naquela faixa (todas as partidas oficiais de cada um)">
          <Distribuicao valores={panorama.kd} voce={voce?.kd ?? null} formatar={(v) => formatarNumero(v, 2)} rotuloVoce="você" />
        </Quadro>

        <Quadro titulo="Quando se joga" recorte={recorte}>
          <GradeHoras grade={panorama.grade} />
        </Quadro>
      </div>

      {panorama.ranking.length > 0 && (
        <Quadro
          className="mt-3"
          titulo="Ranking · perfis públicos"
          extra={`mín. ${MIN_PARTIDAS_RANKING} partidas`}
          rodape="por K/D nas partidas oficiais · só aparece quem tem conta no FragIQ com perfil público (Configurações)"
        >
          <Ranking
            linhas={panorama.ranking.slice(0, 15).map((r, i) => ({
              id: r.steamId,
              rotulo: `${i + 1}. ${r.nome}`,
              icone: r.avatar ? <Image src={r.avatar} alt="" width={20} height={20} className="size-5 shrink-0 rounded-md" unoptimized /> : undefined,
              valor: r.kd,
              texto: formatarNumero(r.kd, 2),
              base: `${formatarNumero(r.vitorias)}% V · ${r.partidas} p`,
              valencia: r.kd >= 1 ? "good" : "bad",
              href: `/p/${r.steamId}`,
            }))}
            referencia={1}
            rotuloReferencia="K/D 1,00"
          />
        </Quadro>
      )}
    </section>
  );
}
