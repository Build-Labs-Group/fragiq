import { NextResponse, type NextRequest } from "next/server";
import { appUrl } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// Atalho para avaliar a interface sem uma chave da Steam Web API.
// Some completamente fora de desenvolvimento.
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Indisponível." }, { status: 404 });
  }

  // ?steamId= escolhe a conta; sem ele, a primeira do banco.
  const steamId = request.nextUrl.searchParams.get("steamId");

  const user = steamId
    ? await prisma.user.findUnique({ where: { steamId } })
    : await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!user) {
    return NextResponse.json(
      { error: "Nenhum usuário no banco. Rode `npm run seed` primeiro." },
      { status: 404 },
    );
  }

  await createSession({ userId: user.id, steamId: user.steamId });
  return NextResponse.redirect(new URL("/cs2", appUrl()));
}
