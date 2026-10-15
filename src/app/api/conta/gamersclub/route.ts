import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { desvincular, vincular, vinculoDe } from "@/lib/gamersclub";
import { lerPerfilGamersClub, NIVEL_MAX } from "@/lib/gamersclub-perfil";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * O vínculo declarado com a Gamers Club. Não lê nada do site deles (sem API
 * e com termos que proíbem — docs/gamersclub.md): guarda o que a pessoa diz,
 * marcado como "informado por você".
 */
const schema = z.object({
  perfil: z.string().max(200),
  nivel: z.number().int().min(0).max(NIVEL_MAX).nullable().optional(),
});

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  return NextResponse.json({ vinculo: await vinculoDe(session.userId) });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });

  const id = lerPerfilGamersClub(parsed.data.perfil);
  if (!id) {
    return NextResponse.json(
      { error: "Cole o link do seu perfil (gamersclub.com.br/player/…) ou só o número dele." },
      { status: 400 },
    );
  }
  await vincular(session.userId, id, parsed.data.nivel ?? null);
  return NextResponse.json({ vinculo: await vinculoDe(session.userId) });
}

export async function DELETE() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  return NextResponse.json({ ok: true, apagado: await desvincular(session.userId) });
}
