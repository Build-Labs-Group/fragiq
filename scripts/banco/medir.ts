/**
 * Quantas consultas o site faz no Postgres por minuto, e quais. É a prova
 * do D2 (docs/migracao-site-build-labs.md, parte 5): o Neon grátis só
 * dorme se o caminho quente do bot parar de consultar o banco.
 *
 *   AWS_PROFILE=buildlabs npx tsx scripts/banco/medir.ts [--minutos 5] [--passo 60] [--parametro /fragiq/prod/site]
 *
 * Lê `pg_stat_statements` no começo e no fim e mostra a diferença:
 * chamadas por minuto no total e por consulta. Com `--passo <s>`, lê também
 * a cada `s` segundos e estima quanto tempo um Neon com suspensão de 5 min
 * ficaria acordado (e quanto isso dá em CU-hora por mês a 0,25 CU). Só conta
 * consultas nas tabelas do FragIQ (`"public".`), não as do provedor. A URL
 * vem do parâmetro, em processo, e nunca é impressa. Não grava nada.
 *
 * No Neon, não meça assim: a própria conexão desta medição mantém o banco
 * acordado. Lá, a prova é o consumo do projeto (painel ou API do Neon).
 */
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import pg from "pg";
import { poolConfigDe } from "../../src/lib/pg-config";

type Linha = { queryid: string; query: string; calls: string };

/** Suspensão do Neon grátis: a computação desliga depois de 5 min sem consulta. */
export const SUSPENSAO_DO_NEON_MS = 5 * 60_000;

export function diferenca(antes: Linha[], depois: Linha[], minutos: number) {
  const base = new Map(antes.map((l) => [l.queryid, Number(l.calls)]));
  const porConsulta = depois
    .map((l) => ({ query: l.query.replace(/\s+/g, " ").slice(0, 140), porMinuto: (Number(l.calls) - (base.get(l.queryid) ?? 0)) / minutos }))
    .filter((l) => l.porMinuto > 0)
    .sort((a, b) => b.porMinuto - a.porMinuto);
  return { total: porConsulta.reduce((s, l) => s + l.porMinuto, 0), porConsulta };
}

/**
 * Quanto do período um Neon ficaria acordado, pelas amostras.
 *
 * Cada amostra diz quantas consultas houve desde a anterior. Sem saber o
 * segundo exato, a estimativa é a pessimista: o banco fica acordado o
 * intervalo inteiro da amostra com consulta, mais a suspensão depois dela.
 * Os pedaços se juntam (dois acordares próximos não contam duas vezes) e
 * nada passa do fim do período.
 */
export function tempoAcordado(amostras: { em: number; chamadas: number }[], inicio: number, fim: number, suspensaoMs = SUSPENSAO_DO_NEON_MS) {
  const pedacos: [number, number][] = [];
  let anterior = inicio;
  for (const a of [...amostras].sort((x, y) => x.em - y.em)) {
    if (a.chamadas > 0) pedacos.push([anterior, Math.min(a.em + suspensaoMs, fim)]);
    anterior = a.em;
  }
  let total = 0;
  let ate = -Infinity;
  for (const [de, para] of pedacos) {
    const comeco = Math.max(de, ate);
    if (para > comeco) total += para - comeco;
    ate = Math.max(ate, para);
  }
  const periodo = fim - inicio;
  return { acordadoMs: total, fracao: periodo > 0 ? total / periodo : 0 };
}

/** CU-hora por mês (730 h) com a computação mínima de 0,25 CU, acordada `fracao` do tempo. */
export const cuHoraPorMes = (fracao: number, cu = 0.25) => fracao * 730 * cu;

const LER = `SELECT queryid::text, query, calls::text FROM pg_stat_statements
  WHERE query LIKE '%"public".%' AND dbid = (SELECT oid FROM pg_database WHERE datname = current_database())`;

const somaDe = (linhas: Linha[]) => linhas.reduce((s, l) => s + Number(l.calls), 0);

async function principal(argumentos: string[]) {
  const valor = (nome: string, padrao: string) => {
    const i = argumentos.indexOf(nome);
    return i >= 0 && argumentos[i + 1] ? argumentos[i + 1]! : padrao;
  };
  const minutos = Number(valor("--minutos", "5"));
  const passoMs = Number(valor("--passo", "0")) * 1000;
  const parametro = valor("--parametro", "/fragiq/prod/site");
  const r = await new SSMClient({ region: "us-east-2" }).send(new GetParameterCommand({ Name: parametro, WithDecryption: true }));
  const v = JSON.parse(r.Parameter?.Value ?? "{}") as Record<string, string>;
  const url = v.DIRECT_DATABASE_URL || v.DATABASE_URL;
  const c = new pg.Client(poolConfigDe(url!));
  await c.connect();
  try {
    console.log(`banco ${new URL(url!).hostname}; medindo por ${minutos} min${passoMs ? `, amostra a cada ${passoMs / 1000} s` : ""}...`);
    const inicio = Date.now();
    const fim = inicio + minutos * 60_000;
    const antes = (await c.query<Linha>(LER)).rows;
    const amostras: { em: number; chamadas: number }[] = [];
    let soma = somaDe(antes);
    if (passoMs > 0) {
      while (Date.now() + passoMs <= fim) {
        await new Promise((ok) => setTimeout(ok, passoMs));
        const agora = somaDe((await c.query<Linha>(LER)).rows);
        amostras.push({ em: Date.now(), chamadas: agora - soma });
        soma = agora;
      }
    }
    await new Promise((ok) => setTimeout(ok, Math.max(0, fim - Date.now())));
    const depois = (await c.query<Linha>(LER)).rows;
    if (passoMs > 0) amostras.push({ em: Date.now(), chamadas: somaDe(depois) - soma });

    const d = diferenca(antes, depois, minutos);
    console.log(`total: ${d.total.toFixed(1)} consultas/min`);
    for (const l of d.porConsulta.slice(0, 20)) console.log(`  ${l.porMinuto.toFixed(1)}/min  ${l.query}`);
    if (passoMs > 0) {
      const t = tempoAcordado(amostras, inicio, Date.now());
      const comConsulta = amostras.filter((a) => a.chamadas > 0).length;
      console.log(
        `amostras com consulta: ${comConsulta} de ${amostras.length}; Neon acordado ~${(t.fracao * 100).toFixed(0)}% do tempo ` +
          `(~${cuHoraPorMes(t.fracao).toFixed(0)} CU-hora/mês a 0,25 CU; o grátis tem 100)`,
      );
    }
  } finally {
    await c.end();
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/banco/medir.ts")) {
  principal(process.argv.slice(2)).catch((erro) => {
    console.error((erro as Error).message);
    process.exit(1);
  });
}
