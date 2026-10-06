import { NextResponse, type NextRequest } from "next/server";
import { linhaDeMetricas, medirPendencias } from "@/lib/saude-dos-dados";

export const dynamic = "force-dynamic";

/**
 * A checagem de 30 em 30 min: partida sem sessão, análise sem resposta e
 * captura vencida (src/lib/saude-dos-dados.ts).
 *
 * Quem chama é a agenda da AWS (`fragiq-agenda`, origem `saude`), com o
 * mesmo Bearer do cron. A linha de métricas vai para o stdout, de onde o
 * CloudWatch tira `FragIQ/*` para os alarmes; a resposta leva as listas,
 * só com ids, para o log da agenda dizer quem está pendente.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET não configurado." }, { status: 500 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const agora = new Date();
  const p = await medirPendencias(agora);
  console.log(linhaDeMetricas(p, agora));
  return NextResponse.json({
    partidasSemSessao: p.partidasSemSessao.map((x) => ({ matchId: x.matchId, userId: x.userId, fim: x.fim.toISOString() })),
    analisesSemResposta: p.analisesSemResposta.map((x) => ({ id: x.id, userId: x.userId, criada: x.createdAt.toISOString() })),
    capturasVencidas: p.capturasVencidas.map((x) => ({ id: x.id, userId: x.userId, proximaEm: x.proximaEm.toISOString() })),
  });
}
