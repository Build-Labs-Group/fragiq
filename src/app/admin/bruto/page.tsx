import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { isAdmin } from "@/lib/admin";
import { CATALOGO, carregar, ehTipo, entidade, listar, type TipoBruto } from "@/lib/admin-bruto";
import { formatarBytes } from "@/lib/formato";
import { JsonBruto } from "@/components/json-bruto";
import { dataHora, Vazio } from "../_pecas";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Cru: o payload como está gravado, antes de virar número na tela.
 *
 * Existe para responder uma pergunta que o resto do painel não responde —
 * "isso que está errado já chegou errado?" — e por isso não agrega nada. A
 * seleção inteira mora na URL (`?tipo=&q=&id=`), então um payload é um link
 * que se cola no chat e abre na mesma tela em quem receber.
 */
const TETO_ARVORE = 2 * 1024 * 1024;

export default async function BrutoPage({
  searchParams,
}: {
  searchParams: Promise<{ tipo?: string; q?: string; id?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/");
  if (!isAdmin(session.steamId)) notFound();

  const sp = await searchParams;
  const tipo: TipoBruto = ehTipo(sp.tipo) ? sp.tipo : "coleta";
  const q = sp.q ?? "";
  const ent = entidade(tipo);

  const [itens, registro] = await Promise.all([listar(tipo, q), sp.id ? carregar(tipo, sp.id) : Promise.resolve(null)]);

  const href = (t: TipoBruto, id?: string) => {
    const p = new URLSearchParams({ tipo: t });
    if (q) p.set("q", q);
    if (id) p.set("id", id);
    return `/admin/bruto?${p}`;
  };

  const texto = registro ? (JSON.stringify(registro.payload, null, 2) ?? "null") : "";
  const bytes = texto.length;

  return (
    <main id="conteudo" tabIndex={-1} className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <p className="text-xs text-ink-faint">
        <Link href="/admin" className="hover:underline">Painel</Link> · Cru
      </p>
      <h1 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">Cru</h1>
      <p className="mt-1 text-sm text-ink-muted">
        O payload como foi gravado. Nada agregado, nada formatado — é isto que chegou.
      </p>

      <nav className="mt-5 flex flex-wrap gap-1.5">
        {CATALOGO.map((e) => (
          <Link
            key={e.tipo}
            href={href(e.tipo)}
            className={cn(
              "rounded-lg px-2.5 py-1 text-xs ring-1 transition",
              e.tipo === tipo ? "bg-accent-soft text-accent ring-accent/40" : "text-ink-muted ring-line hover:text-ink hover:ring-accent/40",
            )}
          >
            {e.rotulo}
          </Link>
        ))}
      </nav>

      <p className="mt-3 text-xs text-ink-faint">
        <span className="font-mono text-ink-muted">{ent.fonte}</span> · {ent.origem} — {ent.explica}
      </p>

      <form className="mt-4 flex max-w-xl gap-2">
        <input type="hidden" name="tipo" value={tipo} />
        <input
          name="q"
          defaultValue={q}
          placeholder="SteamID, traceId, id, matchid, apelido, mapa…"
          className="min-h-9 w-full rounded-lg bg-surface px-3 font-mono text-xs ring-1 ring-line outline-none placeholder:text-ink-faint focus:ring-accent/50"
        />
        <button type="submit" className="min-h-9 shrink-0 rounded-lg bg-surface px-3 text-xs ring-1 ring-line transition hover:ring-accent/60">
          buscar
        </button>
        {q && (
          <Link href={href(tipo)} className="flex min-h-9 shrink-0 items-center px-2 text-xs text-ink-faint hover:text-ink">
            limpar
          </Link>
        )}
      </form>

      <div className="mt-6 grid gap-5 lg:grid-cols-5">
        <section className="lg:col-span-2">
          <p className="hud mb-2">
            {itens.length === 0 ? "nada encontrado" : `${itens.length} ${itens.length === 1 ? "linha" : "linhas"}${itens.length === 60 ? " (as mais recentes)" : ""}`}
          </p>
          {itens.length === 0 ? (
            <Vazio texto={q ? `Nada com “${q}”.` : "Esta tabela está vazia."} />
          ) : (
            <ol className="max-h-[70vh] divide-y divide-line-soft overflow-auto rounded-xl border border-line bg-surface">
              {itens.map((i) => (
                <li key={i.id}>
                  <Link
                    href={href(tipo, i.id)}
                    className={cn(
                      "block px-3 py-2 transition hover:bg-surface-2",
                      i.id === sp.id && "bg-accent-soft/40 ring-1 ring-inset ring-accent/30",
                    )}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm">{i.quem}</span>
                      <span className="tnum shrink-0 text-[11px] text-ink-faint">
                        {i.bytes === null ? "—" : i.bytes === 0 ? "vazio" : formatarBytes(i.bytes)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-baseline gap-2 text-[11px] text-ink-faint">
                      <span suppressHydrationWarning className="shrink-0">{i.quando ? dataHora(i.quando) : "—"}</span>
                      <span className="min-w-0 flex-1 truncate">{i.sub ?? ""}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="lg:col-span-3">
          {!registro ? (
            <div className="rounded-xl border border-dashed border-line px-6 py-16 text-center">
              <p className="hud">Escolha uma linha</p>
              <p className="mt-2 text-sm text-ink-faint">
                {sp.id ? "Esse id não existe nesta tabela." : `O ${ent.rotulo.toLowerCase()} aparece aqui inteiro, com o contexto da linha embaixo.`}
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-sm font-semibold">{registro.titulo}</h2>
                <span className="font-mono text-[11px] text-ink-faint">{registro.id}</span>
                <span className="flex-1" />
                {registro.traceId && (
                  <Link href={`/admin/trace/${registro.traceId}`} className="text-xs text-accent hover:underline">
                    trace →
                  </Link>
                )}
                <a
                  href={`/api/admin/bruto?tipo=${tipo}&id=${encodeURIComponent(registro.id)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-ink-muted hover:text-accent"
                >
                  abrir sozinho ↗
                </a>
              </div>
              <p className="mt-1 mb-2 font-mono text-[11px] text-ink-faint">{registro.payloadNome}</p>

              {registro.payload === null || registro.payload === undefined ? (
                <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center">
                  <p className="hud">Coluna vazia</p>
                  <p className="mt-2 text-sm text-ink-faint">
                    A linha existe e <span className="font-mono">{registro.payloadNome}</span> está nula — nada foi gravado aqui.
                  </p>
                </div>
              ) : bytes > TETO_ARVORE ? (
                <div className="rounded-xl border border-line bg-surface">
                  <p className="border-b border-line px-3 py-2 text-[11px] text-warn">
                    {formatarBytes(bytes)} — grande demais para a árvore. Primeiros 100 KB; o inteiro está em “abrir sozinho”.
                  </p>
                  <pre className="max-h-[70vh] overflow-auto px-3 py-3 font-mono text-xs whitespace-pre text-ink-muted">
                    {texto.slice(0, 100_000)}
                  </pre>
                </div>
              ) : (
                <JsonBruto valor={registro.payload} bytes={bytes} />
              )}

              {Object.keys(registro.linha).length > 0 && (
                <details className="mt-3 rounded-xl border border-line bg-surface">
                  <summary className="cursor-pointer px-3 py-2 text-xs text-ink-muted">
                    Contexto da linha · {Object.keys(registro.linha).length} colunas
                  </summary>
                  <dl className="grid gap-x-4 gap-y-1 border-t border-line px-3 py-3 text-xs sm:grid-cols-2">
                    {Object.entries(registro.linha).map(([k, v]) => (
                      <div key={k} className="flex min-w-0 gap-2">
                        <dt className="shrink-0 font-mono text-ink-faint">{k}</dt>
                        <dd className="min-w-0 truncate font-mono text-ink-muted" title={escalar(v)}>{escalar(v)}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function escalar(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
