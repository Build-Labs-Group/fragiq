import { NextResponse, type NextRequest } from "next/server";
import { fontesDoBanco } from "@/lib/indicadores-fonte";
import { criarIndicadores, tokenConfere } from "@/lib/indicadores-painel";
import { tokenDeIndicadores } from "@/lib/indicadores-token";

export const dynamic = "force-dynamic";

/**
 * Indicadores do FragIQ para o painel da Build Labs (https://painel.buildlabs.com.br).
 *
 * Contrato: `docs/contratos/manifesto-e-indicadores.md` no projeto `painel`;
 * o que cada indicador mede está em `docs/indicadores-painel.md`. Só leitura,
 * só agregados (sem SteamID, nome ou e-mail).
 *
 * 503 sem token configurado, 401 com token ausente ou errado. O painel chama
 * a cada 30 min e corta em 12 s; cada fonte tem limite próprio de 9 s e uma
 * que falha vira `valor: null` com o motivo, sem derrubar a resposta.
 */
export async function GET(request: NextRequest) {
  const esperado = await tokenDeIndicadores();
  if (!esperado) {
    return NextResponse.json({ error: "Token de indicadores não configurado." }, { status: 503 });
  }
  if (!tokenConfere(esperado, request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const { medir } = criarIndicadores({
    fontes: fontesDoBanco(),
    log: (mensagem, dados) => console.warn(`[indicadores] ${mensagem}`, dados ?? {}),
  });
  return NextResponse.json(await medir(), { headers: { "cache-control": "no-store" } });
}
