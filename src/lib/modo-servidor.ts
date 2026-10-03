import { cookies } from "next/headers";
import { prisma } from "./prisma";
import { carregarFonte } from "./fonte";
import { listarSessoes } from "./sessoes";
import { COOKIE_MODO, abasDeModo, resolverModo, type AbaDeModo, type Modo } from "./modo";

/**
 * O lado servidor da lente: quais modos a pessoa tem, quantas sessões têm
 * modo, e qual modo ela pediu.
 *
 * O layout e cada página precisam da mesma resposta; `carregarFonte` é
 * memoizada por requisição, então ler as sessões aqui não custa uma
 * segunda consulta. A escolha junta a URL, que a página vê, com o cookie,
 * que os dois veem.
 */
export type Cobertura = { comModo: number; total: number };

export async function abasDoUsuario(userId: string, appId: number): Promise<AbaDeModo[]> {
  return (await lenteDoUsuario(userId, appId)).abas;
}

export async function lenteDoUsuario(userId: string, appId: number): Promise<{ abas: AbaDeModo[]; cobertura: Cobertura }> {
  const [fonte, porPartida] = await Promise.all([
    carregarFonte(userId, appId),
    appId === 730
      ? prisma.match.groupBy({
          by: ["modo"],
          where: { status: "DONE", modo: { not: null }, jogadores: { some: { userId } } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ]);
  const rows = fonte?.rows ?? [];
  const sessoes = listarSessoes(rows);
  const partidas = new Map(porPartida.map((g) => [g.modo as string, g._count._all]));
  return {
    abas: abasDeModo(rows, partidas),
    cobertura: { comModo: sessoes.filter((s) => s.modoId).length, total: sessoes.length },
  };
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** O modo desta requisição: `?modo=` da URL, senão o cookie, senão tudo. */
export async function modoDaRequisicao(searchParams: SearchParams | undefined, abas: AbaDeModo[]): Promise<Modo> {
  const [params, jar] = await Promise.all([searchParams ?? Promise.resolve({} as Record<string, string | string[] | undefined>), cookies()]);
  return resolverModo(params.modo, jar.get(COOKIE_MODO)?.value, abas);
}
