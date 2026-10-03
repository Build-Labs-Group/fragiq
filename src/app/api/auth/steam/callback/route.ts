import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { appUrl } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/session";
import { STATE_COOKIE, statesMatch, verifyAssertion } from "@/lib/steam/openid";
import { getPlayerSummary } from "@/lib/steam/api";
import { syncUser } from "@/lib/steam/sync";

export const dynamic = "force-dynamic";

function failure(reason: string) {
  const url = new URL("/", appUrl());
  url.searchParams.set("erro", reason);
  return NextResponse.redirect(url);
}

// Passo 2: a Steam devolve a asserção. Validamos antes de confiar em qualquer coisa.
export async function GET(request: NextRequest) {
  const store = await cookies();
  const expected = store.get(STATE_COOKIE)?.value;
  store.delete(STATE_COOKIE);

  if (!statesMatch(expected, request.nextUrl.searchParams.get("state") ?? undefined)) {
    return failure("Sessão de login expirada. Tente novamente.");
  }

  const verified = await verifyAssertion(request.nextUrl.searchParams);
  if (!verified.ok) return failure(verified.reason);

  const summary = await getPlayerSummary(verified.steamId);

  // O steamId é a chave; personaName e avatar são só cache de exibição.
  const user = await prisma.user.upsert({
    where: { steamId: verified.steamId },
    create: {
      steamId: verified.steamId,
      personaName: summary?.personaname ?? `Jogador ${verified.steamId.slice(-5)}`,
      avatarUrl: summary?.avatarfull ?? null,
      profileUrl: summary?.profileurl ?? null,
      countryCode: summary?.loccountrycode ?? null,
    },
    update: {
      personaName: summary?.personaname ?? undefined,
      avatarUrl: summary?.avatarfull ?? undefined,
      profileUrl: summary?.profileurl ?? undefined,
      countryCode: summary?.loccountrycode ?? undefined,
    },
  });

  await createSession({ userId: user.id, steamId: user.steamId });

  // Primeiro login: carrega a biblioteca agora para o dashboard não abrir
  // vazio. Nos logins seguintes o cron já manteve os dados frescos, então
  // só recoletamos se estiverem velhos.
  const stale =
    !user.lastSyncedAt || Date.now() - user.lastSyncedAt.getTime() > 1000 * 60 * 60 * 6;

  if (stale) {
    try {
      await syncUser(user.id, user.steamId, "LOGIN");
    } catch (err) {
      // Um perfil privado não pode impedir o login — o dashboard explica.
      console.error("[login] sync inicial falhou", err);
    }
  }

  return NextResponse.redirect(new URL("/cs2", appUrl()));
}
