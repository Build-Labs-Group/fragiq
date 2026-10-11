import { carregarPerfilPublico, type PerfilPublico } from "./perfil-publico";

/**
 * Dois perfis lado a lado.
 *
 * Só o que os dois têm: os oito números, as armas que ambos usaram, os
 * mapas que ambos jogaram. Em cada linha diz quem está na frente — quando
 * dá para dizer: "kills" absoluto favorece quem jogou mais, então os
 * totais aparecem sem vencedor.
 */
type Ok = Extract<PerfilPublico, { estado: "ok" }>;

export type Linha = {
  rotulo: string;
  a: string;
  b: string;
  /** 1 = a na frente, -1 = b, 0 = empate ou sem juiz. */
  vencedor: -1 | 0 | 1;
};

export type Comparacao = { a: Ok; b: Ok; resumo: Linha[]; armas: Linha[]; mapas: Linha[] };

const SEM_JUIZ = new Set(["Kills", "Rounds", "Partidas"]);

function numero(v: string): number | null {
  const n = Number(v.replace(/\./g, "").replace(",", ".").replace("%", ""));
  return Number.isFinite(n) ? n : null;
}

function juiz(a: string, b: string, comJuiz = true): -1 | 0 | 1 {
  if (!comJuiz) return 0;
  const na = numero(a);
  const nb = numero(b);
  if (na === null || nb === null || na === nb) return 0;
  return na > nb ? 1 : -1;
}

export async function comparar(idA: string, idB: string): Promise<Comparacao | { erro: string }> {
  const [pa, pb] = await Promise.all([carregarPerfilPublico(idA), carregarPerfilPublico(idB)]);
  if (pa.estado !== "ok") return { erro: `O primeiro perfil está ${descrever(pa)}.` };
  if (pb.estado !== "ok") return { erro: `O segundo perfil está ${descrever(pb)}.` };

  const resumo: Linha[] = pa.resumo.map((r, i) => ({
    rotulo: r.rotulo,
    a: r.valor,
    b: pb.resumo[i].valor,
    vencedor: juiz(r.valor, pb.resumo[i].valor, !SEM_JUIZ.has(r.rotulo)),
  }));

  const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1).replace(".", ",")}%`);
  const armasB = new Map(pb.armas.map((x) => [x.arma, x]));
  const armas: Linha[] = pa.armas
    .filter((x) => armasB.has(x.arma) && x.tiros >= 200 && (armasB.get(x.arma)?.tiros ?? 0) >= 200)
    .slice(0, 8)
    .map((x) => {
      const y = armasB.get(x.arma)!;
      return { rotulo: `${x.arma} · precisão`, a: pct(x.precisao), b: pct(y.precisao), vencedor: juiz(pct(x.precisao), pct(y.precisao)) };
    });

  const mapasB = new Map(pb.mapas.map((x) => [x.mapa, x]));
  const mapas: Linha[] = pa.mapas
    .filter((x) => mapasB.has(x.mapa) && x.rounds >= 100 && (mapasB.get(x.mapa)?.rounds ?? 0) >= 100)
    .slice(0, 8)
    .map((x) => {
      const y = mapasB.get(x.mapa)!;
      return { rotulo: `${x.mapa} · vitórias`, a: pct(x.taxa), b: pct(y.taxa), vencedor: juiz(pct(x.taxa), pct(y.taxa)) };
    });

  return { a: pa, b: pb, resumo, armas, mapas };
}

function descrever(p: PerfilPublico) {
  switch (p.estado) {
    case "oculto": return "oculto no FragIQ";
    case "inexistente": return "inexistente";
    case "indisponivel": return "sem resposta da Steam agora, tente de novo em instantes";
    case "privado": return "privado na Steam";
    case "sem-cs2": return "sem estatísticas de CS2";
    default: return "indisponível";
  }
}
