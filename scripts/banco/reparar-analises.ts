/**
 * Devolve cada resposta do analista à pergunta que a pediu.
 *
 * Até 03/10/2026 o callback gravava a resposta na pergunta mais antiga em
 * aberto da conversa. Um turno que terminou sem texto (02/10, 15:33 UTC,
 * modelo `gpt-oss-20b`) deixou uma pergunta aberta, e cada resposta seguinte
 * caiu na pergunta anterior à dela (docs/cogniflow-tenant.md, "De qual
 * pergunta é a resposta"). Este script desfaz o deslocamento com prova, não
 * com ordem: o `replyId` gravado é derivado do id da pergunta dona
 * (`idDaResposta`), então cada resposta tem uma dona só, calculável.
 *
 *   AWS_PROFILE=buildlabs npx tsx scripts/banco/reparar-analises.ts [--aplicar] [--parametro /fragiq/prod/site] [--auditoria arquivo.json]
 *
 * Sem `--aplicar` só mostra o plano (nada é gravado). Com `--aplicar`:
 * - cada conversa vai numa transação, com as linhas travadas e conferidas
 *   contra o plano (se algo mudou entre o plano e a escrita, a conversa é
 *   pulada);
 * - a pergunta que fica sem resposta vira `FAILED` com o motivo, porque o
 *   turno dela não produziu texto e não há o que pôr ali;
 * - cada mudança deixa uma linha em `eventos` (`analise.reatribuida`,
 *   `analise.sem_resposta`) com o antes e o depois.
 * Rodar de novo não muda nada: depois do reparo toda resposta já está na
 * dona. Conversa com qualquer dúvida (resposta sem dona calculável, número
 * de rounds da resposta diferente do da pergunta) não é tocada e sai listada.
 *
 * A URL do banco vem do parâmetro, em processo, e nunca é impressa.
 */
import { writeFileSync } from "node:fs";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import pg from "pg";
import { poolConfigDe } from "../../src/lib/pg-config";
import { idDaResposta, type Conexao } from "../../src/lib/resposta-do-analista";

export type Analise = {
  id: string;
  userId: string;
  gameAppId: number;
  status: "PENDING" | "ACKNOWLEDGED" | "ANSWERED" | "FAILED";
  question: string;
  answer: string | null;
  replyId: string | null;
  /** Texto cru da coluna (`timestamp` sem fuso, em UTC): nunca vira Date, para o fuso da máquina não deslocar a hora na volta. */
  answeredAt: string | null;
  createdAt: string;
};

/** O estado final de uma pergunta tocada pelo reparo. */
export type Mudanca = {
  id: string;
  antes: Pick<Analise, "status" | "replyId" | "answeredAt">;
  depois: Pick<Analise, "status" | "answer" | "replyId" | "answeredAt"> & { error: string | null };
  /** De qual pergunta veio a resposta que esta passa a ter (null: fica sem). */
  respostaDe: string | null;
};

export type PlanoDaConversa = { conversa: string; userId: string; mudancas: Mudanca[] };
export type Duvida = { conversa: string; motivo: string };

export const MOTIVO_SEM_RESPOSTA =
  "O analista não devolveu texto para esta pergunta (turno vazio no cogniflow); a resposta que estava aqui era de outra sessão e voltou para a dona em 04/10/2026.";

const conversaDe = (a: Pick<Analise, "userId" | "gameAppId">) => `${a.userId}:${a.gameAppId}`;

/** "… 79 rounds em 4 partidas …" → 79. A pergunta sempre diz; a resposta quase sempre repete. */
function roundsCitados(texto: string | null): number[] {
  return [...(texto ?? "").matchAll(/(\d+) rounds?\b/g)].map((m) => Number(m[1]));
}

/**
 * O plano, sem banco. Para cada conversa: quem é dono de cada resposta
 * gravada, e o que muda para cada pergunta chegar ao estado certo.
 */
export function planejarReparo(analises: Analise[], conexao: Conexao): { planos: PlanoDaConversa[]; duvidas: Duvida[] } {
  const porConversa = new Map<string, Analise[]>();
  for (const a of analises) porConversa.set(conversaDe(a), [...(porConversa.get(conversaDe(a)) ?? []), a]);

  const planos: PlanoDaConversa[] = [];
  const duvidas: Duvida[] = [];
  for (const [conversa, perguntas] of porConversa) {
    const donoDoId = new Map(perguntas.map((p) => [idDaResposta(conexao, conversa, p.id), p]));
    const respondidas = perguntas.filter((p) => p.replyId);

    // Toda resposta gravada precisa de dona calculável, senão nada aqui é provado.
    const semDona = respondidas.filter((p) => !donoDoId.has(p.replyId!));
    if (semDona.length) {
      duvidas.push({ conversa, motivo: `${semDona.length} resposta(s) sem dona calculável (${semDona.map((p) => p.id).join(", ")})` });
      continue;
    }
    const deslocadas = respondidas.filter((p) => donoDoId.get(p.replyId!)!.id !== p.id);
    if (!deslocadas.length) continue;

    // A resposta gravada em `p` é da pergunta `dona`. A conferência de
    // conteúdo é a segunda prova: os rounds que a resposta cita têm de ser
    // os da pergunta dona.
    const contradicao = deslocadas.find((p) => {
      const dona = donoDoId.get(p.replyId!)!;
      const esperados = roundsCitados(dona.question).slice(0, 1);
      const citados = roundsCitados(p.answer);
      return esperados.length > 0 && citados.length > 0 && !citados.includes(esperados[0]!);
    });
    if (contradicao) {
      duvidas.push({ conversa, motivo: `a resposta gravada em ${contradicao.id} cita rounds que não são os da pergunta dona` });
      continue;
    }

    const respostaPara = new Map<string, Analise>(); // dona → linha onde a resposta dela está hoje
    for (const p of respondidas) respostaPara.set(donoDoId.get(p.replyId!)!.id, p);

    const mudancas: Mudanca[] = [];
    for (const p of perguntas) {
      const origem = respostaPara.get(p.id) ?? null;
      const antes = { status: p.status, replyId: p.replyId, answeredAt: p.answeredAt };
      if (origem && origem.id === p.id) continue; // já certa
      if (origem) {
        mudancas.push({
          id: p.id,
          antes,
          depois: { status: "ANSWERED", answer: origem.answer, replyId: origem.replyId, answeredAt: origem.answeredAt, error: null },
          respostaDe: origem.id,
        });
      } else if (p.replyId) {
        // Tinha a resposta de outra e não tem a própria: o turno dela não deu texto.
        mudancas.push({
          id: p.id,
          antes,
          depois: { status: "FAILED", answer: null, replyId: null, answeredAt: null, error: MOTIVO_SEM_RESPOSTA },
          respostaDe: null,
        });
      }
    }
    if (mudancas.length) planos.push({ conversa, userId: perguntas[0]!.userId, mudancas });
  }
  return { planos, duvidas };
}

const COLUNAS = `id, "userId", "gameAppId", status::text AS status, question, answer, "replyId", "answeredAt", "createdAt"`;

async function aplicar(c: pg.Client, plano: PlanoDaConversa): Promise<boolean> {
  await c.query("BEGIN");
  try {
    const ids = plano.mudancas.map((m) => m.id);
    const atuais = (await c.query<Analise>(`SELECT ${COLUNAS} FROM analyses WHERE id = ANY($1) FOR UPDATE`, [ids])).rows;
    const mudou = plano.mudancas.some((m) => {
      const a = atuais.find((x) => x.id === m.id);
      return !a || a.status !== m.antes.status || a.replyId !== m.antes.replyId;
    });
    if (mudou) {
      await c.query("ROLLBACK");
      return false;
    }
    // O replyId é único: solta todos antes de regravar.
    await c.query(`UPDATE analyses SET "replyId" = NULL WHERE id = ANY($1)`, [ids]);
    for (const m of plano.mudancas) {
      await c.query(
        `UPDATE analyses SET status = $2::"AnalysisStatus", answer = $3, "replyId" = $4, "answeredAt" = $5::timestamp, error = $6 WHERE id = $1`,
        [m.id, m.depois.status, m.depois.answer, m.depois.replyId, m.depois.answeredAt, m.depois.error],
      );
      await c.query(
        `INSERT INTO eventos (id, nome, "userId", dados, "createdAt") VALUES ($1, $2, $3, $4, now() AT TIME ZONE 'UTC')`,
        [
          `reparo-20261004-${m.id}`,
          m.respostaDe ? "analise.reatribuida" : "analise.sem_resposta",
          plano.userId,
          JSON.stringify({
            analise: m.id,
            respostaDe: m.respostaDe,
            replyId: m.depois.replyId,
            antes: m.antes,
            depois: { status: m.depois.status, replyId: m.depois.replyId },
            prova: "replyId derivado do id da pergunta (idDaResposta)",
            por: "scripts/banco/reparar-analises.ts",
          }),
        ],
      );
    }
    await c.query("COMMIT");
    return true;
  } catch (erro) {
    await c.query("ROLLBACK");
    throw erro;
  }
}

async function principal(argumentos: string[]) {
  // `timestamp without time zone` como texto: ler como Date e gravar de volta
  // passaria pelo fuso desta máquina (UTC-3) e deslocaria answeredAt em 3 h.
  pg.types.setTypeParser(pg.types.builtins.TIMESTAMP, (texto) => texto);
  const valor = (nome: string, padrao: string) => {
    const i = argumentos.indexOf(nome);
    return i >= 0 && argumentos[i + 1] ? argumentos[i + 1]! : padrao;
  };
  const deVerdade = argumentos.includes("--aplicar");
  const parametro = valor("--parametro", "/fragiq/prod/site");
  const auditoria = valor("--auditoria", "");
  const r = await new SSMClient({ region: "us-east-2" }).send(new GetParameterCommand({ Name: parametro, WithDecryption: true }));
  const v = JSON.parse(r.Parameter?.Value ?? "{}") as Record<string, string>;
  const conexao = { tenantId: v.COGNIFLOW_TENANT_ID?.trim() || "fragiq", connectionId: v.COGNIFLOW_CONNECTION_ID?.trim() || "web" };
  const url = v.DIRECT_DATABASE_URL || v.DATABASE_URL;
  const c = new pg.Client(poolConfigDe(url!));
  await c.connect();
  try {
    const analises = (await c.query<Analise>(`SELECT ${COLUNAS} FROM analyses ORDER BY "createdAt"`)).rows;
    const { planos, duvidas } = planejarReparo(analises, conexao);
    const porId = new Map(analises.map((a) => [a.id, a]));
    const quando = (id: string | null) => (id ? porId.get(id)!.createdAt.slice(0, 16) : "-");

    console.log(`${analises.length} análises; ${planos.length} conversa(s) a reparar; ${duvidas.length} com dúvida (não tocadas).`);
    for (const p of planos) {
      console.log(`\nconversa ${p.conversa} (${p.mudancas.length} pergunta(s)):`);
      for (const m of p.mudancas) {
        console.log(
          `  pergunta de ${quando(m.id)} [${m.id}] ${m.antes.status} → ${m.depois.status}` +
            (m.respostaDe ? `, recebe a resposta que estava na pergunta de ${quando(m.respostaDe)}` : ", fica sem resposta (turno vazio)"),
        );
      }
    }
    for (const d of duvidas) console.log(`\nDÚVIDA ${d.conversa}: ${d.motivo}`);
    if (auditoria) writeFileSync(auditoria, JSON.stringify({ em: new Date().toISOString(), deVerdade, planos, duvidas }, null, 1));

    if (!deVerdade) {
      console.log("\nsimulação: nada foi gravado. Rode com --aplicar para gravar.");
      return;
    }
    for (const p of planos) {
      const ok = await aplicar(c, p);
      console.log(`${p.conversa}: ${ok ? "reparada" : "PULADA (mudou desde o plano; rode de novo)"}`);
    }
  } finally {
    await c.end();
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/banco/reparar-analises.ts")) {
  principal(process.argv.slice(2)).catch((erro) => {
    console.error((erro as Error).message);
    process.exit(1);
  });
}
