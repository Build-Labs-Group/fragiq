import { NextResponse, type NextRequest } from "next/server";
import { appUrl } from "@/lib/env";
import { resolverEntrada } from "@/lib/perfil-publico";

export const dynamic = "force-dynamic";

const NAO_ACHEI = "Não achei esse perfil. Cole o link do perfil da Steam ou o SteamID64.";
const STEAM_FORA = "Não consegui consultar a Steam agora. Tente de novo em instantes.";

/**
 * O campo da landing: aceita ID, link ou apelido e leva à página pública.
 * "Não achei" só quando a Steam respondeu que o perfil não existe; se ela
 * (ou o cogniflow) falhou, a mensagem diz isso, em vez de mandar a pessoa
 * conferir um link que estava certo.
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") ?? "";
  let steamId: string | null = null;
  let falhou = false;
  try {
    steamId = await resolverEntrada(q);
  } catch (err) {
    falhou = true;
    console.warn("[perfil/buscar] a Steam não respondeu:", err instanceof Error ? err.message : err);
  }
  const destino = steamId ? `/p/${steamId}` : `/?erro=${encodeURIComponent(falhou ? STEAM_FORA : NAO_ACHEI)}`;
  // `request.url` na Lambda traz o host interno do adaptador (https://localhost:8080):
  // o redirecionamento sai para o domínio público, como o login e o logout fazem.
  return NextResponse.redirect(new URL(destino, appUrl()));
}
