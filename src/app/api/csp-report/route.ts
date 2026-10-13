import { aRegistrar, violacoesDoCorpo } from "@/lib/csp-relatorio";

export const dynamic = "force-dynamic";

/** Um relatório de verdade tem poucas centenas de bytes; acima disto é lixo. */
const MAX_BYTES = 8 * 1024;

/**
 * Recebe os relatórios da CSP em Report-Only (`report-uri` / `report-to` do
 * `next.config.ts`). Sem login e sem banco: só vira uma linha de log
 * `[csp] ...` (CloudWatch), deduplicada por instância. Responde sempre 204,
 * para o navegador não tentar de novo; entrada inválida é ignorada.
 *
 * Como ler: docs/seguranca-csp.md.
 */
export async function POST(request: Request) {
  try {
    const texto = await request.text();
    if (texto.length > 0 && texto.length <= MAX_BYTES) {
      const violacoes = violacoesDoCorpo(JSON.parse(texto));
      for (const { violacao, suprimidas } of aRegistrar(violacoes)) {
        console.warn(
          `[csp] ${JSON.stringify({ diretiva: violacao.diretiva, bloqueado: violacao.bloqueado, documento: violacao.documento, suprimidas })}`,
        );
      }
    }
  } catch {
    // JSON inválido: não é problema nosso nem do navegador.
  }
  return new Response(null, { status: 204 });
}
