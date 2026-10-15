"use client";

import { useState } from "react";

type Vinculo = { gcPlayerId: string; nivel: number | null; informadoEm: string } | null;

/**
 * Gamers Club: o que a pessoa diz, dito como tal.
 *
 * Sem API e sem OAuth do lado deles, nada aqui vem do site da Gamers Club —
 * o cartão repete isso em vez de sugerir uma verificação que não existe.
 * Desvincular apaga a linha inteira, na hora.
 */
export function GamersClubVinculo({ inicial }: { inicial: Vinculo }) {
  const [vinculo, setVinculo] = useState<Vinculo>(inicial);
  const [perfil, setPerfil] = useState("");
  const [nivel, setNivel] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setOcupado(true);
    try {
      const res = await fetch("/api/conta/gamersclub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ perfil, nivel: nivel.trim() === "" ? null : Number(nivel) }),
      });
      const corpo = (await res.json().catch(() => ({}))) as { vinculo?: Vinculo; error?: string };
      if (!res.ok) setErro(corpo.error ?? "Não deu para salvar.");
      else {
        setVinculo(corpo.vinculo ?? null);
        setPerfil("");
        setNivel("");
      }
    } finally {
      setOcupado(false);
    }
  }

  async function desvincular() {
    setErro(null);
    setOcupado(true);
    try {
      const res = await fetch("/api/conta/gamersclub", { method: "DELETE" });
      if (res.ok) setVinculo(null);
      else setErro("Não deu para desvincular.");
    } finally {
      setOcupado(false);
    }
  }

  const campo = "w-full rounded-lg bg-canvas/40 px-3 py-2 text-sm ring-1 ring-line outline-none focus:ring-accent/60";

  return (
    <div className="rounded-2xl bg-surface p-4 ring-1 ring-line">
      {vinculo ? (
        <div className="flex flex-wrap items-center gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              Perfil <span className="font-mono">{vinculo.gcPlayerId}</span>
              {vinculo.nivel !== null && <span className="tnum"> · nível {vinculo.nivel}</span>}
            </p>
            <p className="mt-0.5 text-xs text-ink-faint" suppressHydrationWarning>
              Informado por você em {new Date(vinculo.informadoEm).toLocaleDateString("pt-BR")} · não verificado
            </p>
          </div>
          <a
            href={`https://gamersclub.com.br/player/${vinculo.gcPlayerId}`}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-accent hover:underline"
          >
            Abrir na Gamers Club
          </a>
          <button
            type="button"
            disabled={ocupado}
            onClick={desvincular}
            className="rounded-lg bg-surface px-3 py-2 text-sm text-danger ring-1 ring-danger/40 transition hover:bg-danger/10 disabled:opacity-40"
          >
            Desvincular e apagar
          </button>
        </div>
      ) : (
        <form onSubmit={salvar} className="space-y-3">
          <label className="block text-xs text-ink-faint">
            Link do perfil ou número
            <input
              value={perfil}
              onChange={(e) => setPerfil(e.target.value)}
              placeholder="gamersclub.com.br/player/1879287"
              className={`mt-1 ${campo}`}
            />
          </label>
          <label className="block text-xs text-ink-faint">
            Nível (opcional)
            <input value={nivel} onChange={(e) => setNivel(e.target.value)} inputMode="numeric" className={`mt-1 w-28 ${campo}`} />
          </label>
          <button
            type="submit"
            disabled={ocupado || perfil.trim() === ""}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-canvas transition disabled:opacity-40"
          >
            {ocupado ? "Salvando…" : "Vincular"}
          </button>
        </form>
      )}
      {erro && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {erro}
        </p>
      )}
    </div>
  );
}
