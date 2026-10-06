/**
 * Confere toda análise de sessão gravada contra a sessão de hoje, e refaz
 * as que não podem ir para a tela.
 *
 *   AWS_PROFILE=buildlabs npx tsx scripts/banco/reprocessar-analises.ts [--aplicar] [--pedir] [--parametro /fragiq/prod/site]
 *
 * Usa a mesma avaliação da tela (`listarAnalises` → `avaliarResposta`,
 * `lib/analise-sessao.ts`), então o relatório é exatamente o que cada
 * cartão mostra. Sem flag, só lista. Com `--aplicar`, grava a janela
 * (`janela`, `janelaHash`) das análises antigas que conferiram — dali em
 * diante uma sessão refeita é pega pelo hash. Com `--pedir`, pede de novo
 * (`pedirDeNovo`) cada análise desatualizada, de outra sessão, ilegível ou
 * perdida, uma de cada vez, esperando a resposta antes da próxima: duas
 * perguntas abertas na mesma conversa é o que deslocou análises em
 * produção. O texto anterior fica no `historico` da linha.
 *
 * Idempotente: rodar de novo não regrava janela já gravada e só pede de
 * novo o que continua precisando (até `MAX_REPEDIDOS` por análise). Faça o
 * backup da tabela `analyses` antes de `--aplicar`/`--pedir`.
 *
 * Os valores do parâmetro entram no ambiente deste processo e nunca são
 * impressos.
 */
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

const CS2 = 730;
const ESPERA_MAX_MS = 3 * 60 * 1000;

function valor(args: string[], nome: string, padrao: string): string {
  const i = args.indexOf(nome);
  return i >= 0 && args[i + 1] ? args[i + 1] : padrao;
}

async function carregarParametro(nome: string) {
  const r = await new SSMClient({ region: "us-east-2" }).send(new GetParameterCommand({ Name: nome, WithDecryption: true }));
  const valores = JSON.parse(r.Parameter?.Value ?? "{}") as Record<string, unknown>;
  for (const [k, v] of Object.entries(valores)) if (typeof v === "string" && !process.env[k]) process.env[k] = v;
  // O script fala direto com o Postgres; a URL direta evita o pooler quando existe.
  if (process.env.DIRECT_DATABASE_URL?.trim()) process.env.DATABASE_URL = process.env.DIRECT_DATABASE_URL;
  // Já carregado aqui: o leitor de segredos do site não precisa ir ao SSM de novo.
  delete process.env.FRAGIQ_SECRET_PARAM;
  delete process.env.FRAGIQ_SECRET_ID;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function principal(args: string[]) {
  const aplicar = args.includes("--aplicar");
  const pedir = args.includes("--pedir");
  await carregarParametro(valor(args, "--parametro", "/fragiq/prod/site"));

  const { prisma } = await import("../../src/lib/prisma");
  const { listarAnalises, gravarJanela, pedirDeNovo } = await import("../../src/lib/analises");
  const { montarFonte } = await import("../../src/lib/fonte");
  const { PEDIR_DE_NOVO } = await import("../../src/lib/analise-sessao");

  try {
    const donos = await prisma.analysis.groupBy({ by: ["userId"], where: { kind: "SESSION", gameAppId: CS2 }, _count: true });
    const contagem: Record<string, number> = {};
    let gravadas = 0;
    const refazer: { userId: string; id: string; estado: string }[] = [];

    for (const { userId } of donos) {
      const fonte = await montarFonte(userId, CS2);
      const analises = await listarAnalises(userId, CS2, { rows: fonte?.rows ?? [], limite: 500 });
      const linhas = await prisma.analysis.findMany({ where: { id: { in: analises.map((a) => a.id) } }, select: { id: true, janelaHash: true } });
      const comJanela = new Set(linhas.filter((l) => l.janelaHash).map((l) => l.id));
      console.log(`\n${userId}: ${analises.length} análise(s)`);
      for (const a of analises) {
        contagem[a.estado] = (contagem[a.estado] ?? 0) + 1;
        const s = a.sessao;
        const numeros = s ? s.numeros.map((n) => `${n.rotulo} ${n.texto}`).join(" · ") : "sessão não existe mais";
        console.log(`  ${a.sessaoEm?.slice(0, 16) ?? "?"} ${a.id} ${a.estado.padEnd(13)} ${s ? `${s.rounds} r · ` : ""}${numeros}`);
        if (a.estado === "ok" && !comJanela.has(a.id) && aplicar && (await gravarJanela(a.id))) gravadas += 1;
        if (PEDIR_DE_NOVO.has(a.estado) && a.podePedirDeNovo) refazer.push({ userId, id: a.id, estado: a.estado });
      }
    }

    console.log(`\nestados: ${JSON.stringify(contagem)}`);
    console.log(aplicar ? `janelas gravadas: ${gravadas}` : "simulação: nenhuma janela gravada (use --aplicar).");
    console.log(`a pedir de novo: ${refazer.length}${pedir ? "" : " (use --pedir)"}`);
    if (!pedir) return;

    for (const r of refazer) {
      const resultado = await pedirDeNovo(r.userId, CS2, r.id, `reprocesso ${new Date().toISOString().slice(0, 10)}: ${r.estado}`);
      if (!resultado.pedida) {
        console.log(`  ${r.id}: não pedida (${resultado.motivo})`);
        continue;
      }
      const inicio = Date.now();
      let status = "PENDING";
      while (Date.now() - inicio < ESPERA_MAX_MS) {
        await dormir(5000);
        status = (await prisma.analysis.findUnique({ where: { id: r.id }, select: { status: true } }))?.status ?? "?";
        if (status !== "PENDING" && status !== "ACKNOWLEDGED") break;
      }
      const fonte = await montarFonte(r.userId, CS2);
      const depois = (await listarAnalises(r.userId, CS2, { rows: fonte?.rows ?? [], limite: 500 })).find((a) => a.id === r.id);
      console.log(`  ${r.id}: ${r.estado} → ${status} / ${depois?.estado ?? "?"} em ${Math.round((Date.now() - inicio) / 1000)} s`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

principal(process.argv.slice(2)).catch((erro) => {
  console.error(erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
