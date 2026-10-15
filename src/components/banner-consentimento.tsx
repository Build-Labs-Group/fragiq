"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const CHAVE = "buildlabs_consent";

type Gtag = (...args: unknown[]) => void;

/**
 * Aviso de cookies (LGPD) discreto, no rodapé: some depois de uma escolha e
 * a escolha fica no navegador. Recusar mantém o Consent Mode em `denied`.
 * Não bloqueia a tela nem rouba o foco.
 */
export function BannerConsentimento() {
  const [visivel, setVisivel] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(CHAVE)) setVisivel(true);
    } catch {
      setVisivel(true);
    }
  }, []);

  function escolher(aceitou: boolean) {
    const estado = aceitou ? "granted" : "denied";
    try {
      localStorage.setItem(CHAVE, estado);
    } catch {}
    const gtag = (window as unknown as { gtag?: Gtag }).gtag;
    gtag?.("consent", "update", { ad_storage: estado, analytics_storage: estado, ad_user_data: estado, ad_personalization: estado });
    setVisivel(false);
  }

  if (!visivel) return null;
  return (
    <div
      role="region"
      aria-label="Aviso de privacidade"
      className="fixed inset-x-3 bottom-3 z-40 mx-auto flex max-w-xl flex-col gap-3 rounded-xl border border-line bg-surface p-4 text-sm text-ink shadow-lg sm:flex-row sm:items-center"
    >
      <p className="flex-1 text-ink-muted">
        Usamos cookies de medição para entender o que ajuda quem usa o FragIQ, só se você deixar.{" "}
        <Link href="/seguranca" className="text-accent underline">
          Saiba mais
        </Link>
        .
      </p>
      <div className="flex shrink-0 gap-2">
        <button type="button" onClick={() => escolher(false)} className="rounded-lg border border-line px-3 py-1.5 text-ink-muted hover:text-ink">
          Recusar
        </button>
        <button type="button" onClick={() => escolher(true)} className="rounded-lg bg-accent px-3 py-1.5 font-medium text-canvas">
          Aceitar
        </button>
      </div>
    </div>
  );
}
