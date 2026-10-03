import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { authSecret } from "./env";

const COOKIE = "fragiq_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 dias

export type SessionPayload = {
  userId: string;
  steamId: string;
};

async function secret() {
  return new TextEncoder().encode(await authSecret());
}

export async function createSession(payload: SessionPayload) {
  const token = await new SignJWT({ steamId: payload.steamId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(await secret());

  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax", // "lax" e não "strict": o retorno da Steam é cross-site.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function getSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, await secret(), { algorithms: ["HS256"] });
    if (!payload.sub || typeof payload.steamId !== "string") return null;
    return { userId: payload.sub, steamId: payload.steamId };
  } catch {
    // Assinatura inválida ou token expirado — trata como deslogado.
    return null;
  }
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

/**
 * Sessão ou redirect para a landing. O layout já redireciona, mas layout e
 * página renderizam em paralelo — a página não pode contar com ele.
 */
export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect("/");
  return session;
}
