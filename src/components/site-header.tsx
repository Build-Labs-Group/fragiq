"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MenuConta } from "./menu-conta";
import { SyncButton } from "./sync-button";
import { FeedbackButton } from "./feedback-button";
import { cn } from "@/lib/utils";
import type { Progresso } from "@/lib/primeiros-passos";

type Props = {
  personaName: string;
  avatarUrl: string | null;
  steamId: string;
  lastSyncedAt: Date | null;
  /** Mostra o atalho para /admin. Só quem está em ADMIN_STEAM_IDS. */
  admin?: boolean;
  /** Selo da comunidade, quando a pessoa entrou. */
  selo?: "fundador" | "beta" | null;
  /** Primeiros passos ainda pendentes; null quando todos estão feitos. */
  passos?: Progresso | null;
};

/**
 * Cabeçalho.
 *
 * A forma é a convencional — marca à esquerda, navegação ao lado, conta à
 * direita — porque a anterior não era: seis ícones sem rótulo disputavam o
 * canto direito, misturando navegação ("amigos", "comunidade") com ação
 * ("sincronizar", "feedback") e com conta ("sair"). Nada dizia onde era o
 * "meu". Separadas, cada coisa fica onde se procura por ela: as seções no
 * meio, a ação da sessão à direita, e tudo que é da pessoa dentro do
 * avatar.
 *
 * A aba ativa é marcada porque a área do jogo já tem um segundo nível de
 * abas: sem marcar o primeiro, as duas linhas de navegação competiam.
 *
 * Mobile: a navegação vira uma segunda linha rolável e o grupo de
 * sincronização desce com ela. Numa viewport de 390px a versão anterior
 * produzia 471px de conteúdo e jogava o botão de sair para fora da tela.
 */
const SECOES = [
  { href: "/cs2", rotulo: "CS2", combina: (p: string) => p === "/cs2" || p.startsWith("/games/") },
  { href: "/amigos", rotulo: "Amigos", combina: (p: string) => p.startsWith("/amigos") },
  { href: "/comunidade", rotulo: "Comunidade", combina: (p: string) => p.startsWith("/comunidade") },
];

export function SiteHeader({ personaName, avatarUrl, steamId, lastSyncedAt, admin, selo, passos }: Props) {
  const pathname = usePathname() ?? "";

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2 sm:gap-5 sm:px-6 sm:py-2.5">
        <Link href="/cs2" className="shrink-0 font-mono text-sm font-bold tracking-tight">
          Frag<span className="text-accent">IQ</span>
        </Link>

        <nav className="hidden items-center gap-1 sm:flex">
          {SECOES.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              aria-current={s.combina(pathname) ? "page" : undefined}
              className={cn(
                "rounded-lg px-2.5 py-1.5 text-sm transition",
                s.combina(pathname) ? "bg-surface-2 text-ink" : "text-ink-muted hover:bg-surface-2 hover:text-ink",
              )}
            >
              {s.rotulo}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          {/* No Resumo a lista inteira já está na tela; o atalho seria eco. */}
          {passos && pathname !== "/games/730" && (
            <Link
              href="/games/730"
              title="Primeiros passos: o que falta para tudo chegar sozinho"
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-ink-muted ring-1 ring-accent/40 transition hover:text-ink hover:ring-accent"
            >
              <span className="hidden sm:inline">Primeiros passos</span>
              <span className="num text-accent">
                {passos.feitos}/{passos.total}
              </span>
              <span className="h-1 w-8 overflow-hidden rounded-full bg-line" aria-hidden>
                <span className="block h-full rounded-full bg-accent" style={{ width: `${(passos.feitos / passos.total) * 100}%` }} />
              </span>
            </Link>
          )}
          <div className="hidden sm:block">
            <SyncButton />
          </div>
          <FeedbackButton />
          <MenuConta
            personaName={personaName}
            avatarUrl={avatarUrl}
            steamId={steamId}
            lastSyncedAt={lastSyncedAt}
            selo={selo}
            admin={admin}
          />
        </div>
      </div>

      {/* No celular a navegação e o sync viram a segunda linha. */}
      <div className="flex items-center gap-2 border-t border-line-soft px-4 py-1.5 sm:hidden">
        <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {SECOES.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              aria-current={s.combina(pathname) ? "page" : undefined}
              className={cn(
                "shrink-0 rounded-lg px-2.5 py-1.5 text-sm transition",
                s.combina(pathname) ? "bg-surface-2 text-ink" : "text-ink-muted",
              )}
            >
              {s.rotulo}
            </Link>
          ))}
        </nav>
        <SyncButton className="shrink-0" />
      </div>
    </header>
  );
}
