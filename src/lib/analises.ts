import { prisma } from "./prisma";
import { cogniflow } from "./env";
import { enviarPergunta } from "./cogniflow";
import type { SnapshotRow } from "./series";
import { rotularMapa, rotularModo } from "./cs2-labels";
import { CS2_PANEL } from "./cs2-panel";
import type { Delta } from "./delta";
import { formatarStat } from "./formato";
import { TUDO, type Modo } from "./modo";
import {
  AMOSTRA_MINIMA_ROUNDS,
  avaliarResposta,
  hashDaJanela,
  janelaDaSessao,
  lerJanela,
  PEDIR_DE_NOVO,
  sessaoIncompleta,
  type EstadoDaAnalise,
  type JanelaDaSessao,
  type LeituraDaAnalise,
} from "./analise-sessao";

/**
 * Depois disto uma pergunta sem resposta é dada como perdida, para não
 * travar a próxima. O cogniflow costuma responder em segundos; dois minutos
 * cobrem uma fila cheia e um modelo lento.
 */
export const TIMEOUT_MS = 2 * 60 * 1000;

/** Quantas vezes a mesma análise pode ser pedida de novo (por desatualizada, ilegível…). */
export const MAX_REPEDIDOS = 3;

/** Um dos três números da sessão no cartão, já lido do insight materializado. */
export type NumeroDaSessao = {
  chave: "kd" | "adr" | "hs";
  rotulo: string;
  valor: number | null;
  texto: string;
  /** O chip do insight `<chave>.vs.normal` — o mesmo da tabela de Sessões. */
  delta: Delta | null;
  /** "normal 0,70 · 6 sessões", "vitalício 0,71". */
  referencia: string | null;
  /** Por que não há número: amostra curta, contadores incompletos. */
  motivo: string | null;
};

/**
 * A sessão por trás de uma análise, pronta para o cartão: contexto e os
 * três números. Vem da sessão materializada (`Session`) e dos insights
 * dela, as mesmas linhas que a tabela de Sessões lê — o chip de K/D de uma
 * sessão é o mesmo nas duas telas.
 */
export type SessaoDaAnalise = {
  modo: string | null;
  modoRotulo: string | null;
  mapa: string | null;
  placar: string | null;
  rounds: number;
  partidas: number | null;
  minutos: number;
  numeros: NumeroDaSessao[];
  /** Contadores que nenhuma partida produz (`sessaoIncompleta`). */
  incompleta: boolean;
};

export type AnaliseDTO = {
  id: string;
  kind: "SESSION" | "QUESTION";
  status: "PENDING" | "ACKNOWLEDGED" | "ANSWERED" | "FAILED";
  createdAt: string;
  answeredAt: string | null;
  /** Quando a sessão analisada fechou (SESSION). */
  sessaoEm: string | null;
  /** A sessão em números, quando ainda existe. */
  sessao: SessaoDaAnalise | null;
  /** O que a tela pode fazer com o texto (`lib/analise-sessao.ts`). */
  estado: EstadoDaAnalise;
  /** O texto já lido, limpo e conferido; null quando não vai para a tela. */
  leitura: LeituraDaAnalise | null;
  /** O botão "pedir de novo" faz alguma coisa (não está na fila nem passou do limite). */
  podePedirDeNovo: boolean;
};

const REGRAS_DO_CARTAO = ["kd.vs.normal", "adr.vs.normal", "hs.vs.normal"] as const;
const STAT = { kd: CS2_PANEL.find((s) => s.key === "kd")!, adr: CS2_PANEL.find((s) => s.key === "adr")!, hs: CS2_PANEL.find((s) => s.key === "hs")! };

type SessaoGravada = {
  id: string;
  deSnapshotId: string;
  ateSnapshotId: string;
  ate: Date;
  minutos: number;
  rounds: number;
  partidas: number | null;
  kills: number | null;
  deaths: number | null;
  dano: number | null;
  headshots: number | null;
  modo: string | null;
  modoConfianca: "EXATA" | "INFERIDA" | "MISTA";
  mapa: string | null;
  placar: string | null;
};

const SELECAO_SESSAO = {
  id: true,
  deSnapshotId: true,
  ateSnapshotId: true,
  ate: true,
  minutos: true,
  rounds: true,
  partidas: true,
  kills: true,
  deaths: true,
  dano: true,
  headshots: true,
  modo: true,
  modoConfianca: true,
  mapa: true,
  placar: true,
} as const;

type InsightDoCartao = { escopoId: string; regra: string; valor: number | null; referencia: number | null; referenciaTipo: string | null; base: unknown; dados: unknown };

function modoProvado(s: Pick<SessaoGravada, "modo" | "modoConfianca">): string | null {
  return s.modoConfianca === "MISTA" ? null : s.modo;
}

function textoDaReferencia(chave: NumeroDaSessao["chave"], i: InsightDoCartao): string | null {
  if (i.referencia === null) return null;
  const valor = formatarStat(STAT[chave], i.referencia);
  if (i.referenciaTipo === "modo") {
    const sessoes = (i.base as { sessoes?: number } | null)?.sessoes;
    return `normal ${valor}${sessoes ? ` · ${sessoes} sessões` : ""}`;
  }
  return `vitalício ${valor}`;
}

/** Os três números do cartão de uma sessão, lidos dos insights dela. */
export function numerosDaSessao(s: SessaoGravada, insights: InsightDoCartao[]): NumeroDaSessao[] {
  const incompleta = sessaoIncompleta(s);
  const crus = {
    kd: s.kills !== null && s.deaths ? s.kills / s.deaths : null,
    adr: s.dano !== null && s.rounds ? s.dano / s.rounds : null,
    hs: s.headshots !== null && s.kills ? (s.headshots / s.kills) * 100 : null,
  };
  return (["kd", "adr", "hs"] as const).map((chave) => {
    const rotulo = { kd: "K/D", adr: "Dano/round", hs: "HS" }[chave];
    const vazio = (motivo: string): NumeroDaSessao => ({ chave, rotulo, valor: null, texto: "—", delta: null, referencia: null, motivo });
    if (incompleta) return vazio(`contadores incompletos da Steam (${s.rounds} ${s.rounds === 1 ? "round" : "rounds"}, ${s.kills ?? 0} kills)`);
    if (chave === "adr" && s.rounds < AMOSTRA_MINIMA_ROUNDS) return vazio(`${s.rounds} ${s.rounds === 1 ? "round" : "rounds"}: pouco para uma taxa por round`);
    const insight = insights.find((i) => i.escopoId === s.id && i.regra === `${chave}.vs.normal`);
    const valor = insight?.valor ?? crus[chave];
    if (valor === null) return vazio("sem dado nesta sessão");
    const dados = (insight?.dados ?? {}) as { delta?: Delta | null };
    return {
      chave,
      rotulo,
      valor,
      texto: formatarStat(STAT[chave], valor),
      delta: dados.delta ?? null,
      referencia: insight ? textoDaReferencia(chave, insight) : null,
      motivo: null,
    };
  });
}

function sessaoDoCartao(s: SessaoGravada, insights: InsightDoCartao[]): SessaoDaAnalise {
  const modo = modoProvado(s);
  return {
    modo,
    modoRotulo: modo ? rotularModo(modo) : null,
    mapa: s.mapa ? rotularMapa(s.mapa) : null,
    placar: s.placar,
    rounds: s.rounds,
    partidas: s.partidas,
    minutos: s.minutos,
    numeros: numerosDaSessao(s, insights),
    incompleta: sessaoIncompleta(s),
  };
}

function aberta(status: string) {
  return status === "PENDING" || status === "ACKNOWLEDGED";
}

function historicoDe(v: unknown): { em: string; motivo: string; respostaAnterior: string | null }[] {
  return Array.isArray(v) ? (v as { em: string; motivo: string; respostaAnterior: string | null }[]) : [];
}

/**
 * As últimas análises de sessão do jogador para o jogo, da mais recente à
 * mais antiga. Com `modo`, só as de sessões provadas daquele modo. `rows`
 * é o balde da série: é dele que sai a janela de cada sessão, para conferir
 * o texto e recalcular os achados.
 */
export async function listarAnalises(
  userId: string,
  appId: number,
  opcoes: { modo?: Modo; rows?: SnapshotRow[]; limite?: number } = {},
): Promise<AnaliseDTO[]> {
  const modo = opcoes.modo && opcoes.modo !== TUDO ? opcoes.modo : null;
  const doModo = modo
    ? (
        await prisma.session.findMany({
          where: { userId, gameAppId: appId, modo, modoConfianca: { not: "MISTA" } },
          select: { ateSnapshotId: true },
        })
      ).map((s) => s.ateSnapshotId)
    : null;

  const linhas = await prisma.analysis.findMany({
    where: { userId, gameAppId: appId, kind: "SESSION", ...(doModo ? { snapshotId: { in: doModo } } : {}) },
    orderBy: { createdAt: "desc" },
    take: opcoes.limite ?? 20,
    select: {
      id: true,
      kind: true,
      answer: true,
      status: true,
      createdAt: true,
      answeredAt: true,
      pedidaEm: true,
      snapshotId: true,
      janelaHash: true,
      historico: true,
      snapshot: { select: { capturedAt: true } },
    },
  });

  const snapshotIds = linhas.map((l) => l.snapshotId).filter((x): x is string => x !== null);
  const sessoes: SessaoGravada[] = snapshotIds.length
    ? await prisma.session.findMany({ where: { ateSnapshotId: { in: snapshotIds } }, select: SELECAO_SESSAO })
    : [];
  const insights: InsightDoCartao[] = sessoes.length
    ? await prisma.insight.findMany({
        where: { escopo: "SESSAO", escopoId: { in: sessoes.map((s) => s.id) }, regra: { in: [...REGRAS_DO_CARTAO] } },
        orderBy: { regraVersao: "desc" },
        select: { escopoId: true, regra: true, valor: true, referencia: true, referenciaTipo: true, base: true, dados: true },
      })
    : [];
  // Durante um recompute uma regra pode ter duas versões; a mais nova vem primeiro e vence no `find`.
  const sessaoDe = new Map(sessoes.map((s) => [s.ateSnapshotId, s]));
  const rows = opcoes.rows ?? [];
  const agora = Date.now();

  return linhas.map((l) => {
    const s = l.snapshotId ? sessaoDe.get(l.snapshotId) : undefined;
    const pedidaEm = l.pedidaEm ?? l.createdAt;
    const perdida = aberta(l.status) && pedidaEm.getTime() < agora - TIMEOUT_MS;
    // Uma pendente velha demais é apresentada como perdida, sem escrever no
    // banco: se a resposta chegar atrasada, o callback ainda a encontra.
    const status = perdida ? "FAILED" : l.status;

    let estado: EstadoDaAnalise;
    let leitura: LeituraDaAnalise | null = null;
    if (status === "PENDING" || status === "ACKNOWLEDGED") estado = "pendente";
    else if (status === "FAILED") estado = s && sessaoIncompleta(s) ? "incompleta" : "falhou";
    else {
      const avaliacao = avaliarResposta({
        resposta: l.answer ?? "",
        janelaHashGravado: l.janelaHash,
        janelaAtual: s ? janelaDaSessao(s) : null,
        janela: s ? lerJanela(rows, s.ateSnapshotId, { modo: modoProvado(s), mapa: s.mapa }) : null,
        incompleta: s ? sessaoIncompleta(s) : false,
      });
      estado = avaliacao.estado;
      leitura = avaliacao.leitura;
    }

    return {
      id: l.id,
      kind: l.kind,
      status,
      createdAt: l.createdAt.toISOString(),
      answeredAt: l.answeredAt?.toISOString() ?? null,
      sessaoEm: l.snapshot?.capturedAt.toISOString() ?? null,
      sessao: s ? sessaoDoCartao(s, insights) : null,
      estado,
      leitura,
      podePedirDeNovo: PEDIR_DE_NOVO.has(estado) && Boolean(s) && historicoDe(l.historico).length < MAX_REPEDIDOS,
    };
  });
}

/* -------------------------- análise automática ---------------------------- */

const DATA_HORA: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
};

/**
 * O texto da pergunta de uma sessão. Diz a janela em linguagem de gente e,
 * quando a sessão não tem modo provado, proíbe o modo: o agente tem memória
 * da conversa e levava o "competitive" de uma sessão para a seguinte.
 */
export function textoDaPergunta(sessao: { capturedAt: Date; rounds: number; partidas: number | null; modo: string | null; mapa: string | null; placar: string | null }): string {
  const quando = sessao.capturedAt.toLocaleString("pt-BR", DATA_HORA).replace(".", "");
  const contexto = [
    sessao.modo ? `modo ${sessao.modo} (${rotularModo(sessao.modo)})` : null,
    sessao.mapa ? `mapa ${sessao.mapa} (${rotularMapa(sessao.mapa)})` : null,
    sessao.placar ? `placar ${sessao.placar}` : null,
  ].filter(Boolean);
  return (
    `Nova sessão registrada em ${quando}: ${sessao.rounds} round${sessao.rounds === 1 ? "" : "s"}` +
    (sessao.partidas ? ` em ${sessao.partidas} partida${sessao.partidas === 1 ? "" : "s"}` : "") +
    (contexto.length ? ` — ${contexto.join(", ")}` : "") +
    `. Analise esta sessão contra o meu normal sem que eu precise perguntar: ` +
    `o que mudou, o que pesou de verdade e o que fazer na próxima. Comece pela view resumo` +
    (sessao.modo
      ? ` com modo="${sessao.modo}", e mantenha esse modo em toda consulta.`
      : `. Esta sessão não tem modo provado: não passe modo nem mapa em nenhuma consulta e não atribua modo nem mapa a ela.`) +
    ` As views já leem só esta sessão; não repita K/D, dano por round nem headshot nos achados.`
  );
}

/**
 * A análise chega sozinha.
 *
 * Toda coleta que fecha uma sessão pede ao analista uma leitura daquela
 * sessão, e a resposta pousa na página antes de a pessoa abrir.
 *
 * Idempotente por coleta: `snapshotId` é único, então o cron, o bot e a
 * própria página podem pedir a mesma sessão e só uma análise nasce. Quem
 * chega segundo recebe a que já existe.
 */
export async function garantirAnaliseDaSessao(
  userId: string,
  appId: number,
): Promise<{ id: string; criada: boolean } | null> {
  const config = await cogniflow();
  if (!config) return null;

  const sessao = await sessaoMaisRecente(userId, appId);
  if (!sessao) return null;

  const existente = await prisma.analysis.findUnique({
    where: { snapshotId: sessao.ateSnapshotId },
    select: { id: true },
  });
  if (existente) return { id: existente.id, criada: false };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { personaName: true },
  });
  if (!user) return null;

  const modo = modoProvado(sessao);
  const texto = textoDaPergunta({ capturedAt: sessao.ate, rounds: sessao.rounds, partidas: sessao.partidas, modo, mapa: sessao.mapa, placar: sessao.placar });
  const janela = janelaDaSessao(sessao);
  const agora = new Date();

  let analysis: { id: string };
  try {
    analysis = await prisma.analysis.create({
      data: {
        userId,
        gameAppId: appId,
        kind: "SESSION",
        snapshotId: sessao.ateSnapshotId,
        question: texto,
        janela,
        janelaHash: hashDaJanela(janela),
        pedidaEm: agora,
      },
      select: { id: true },
    });
  } catch (e) {
    // Corrida entre dois gatilhos (bot e página, por exemplo): o índice único
    // decide, e quem perdeu devolve a análise do vencedor.
    if (e instanceof Error && "code" in e && (e as { code?: string }).code === "P2002") {
      const vencedora = await prisma.analysis.findUnique({
        where: { snapshotId: sessao.ateSnapshotId },
        select: { id: true },
      });
      return vencedora ? { id: vencedora.id, criada: false } : null;
    }
    throw e;
  }

  await enviar(analysis.id, analysis.id, userId, appId, user.personaName, texto, { ate: sessao.ateSnapshotId, modo });
  return { id: analysis.id, criada: true };
}

async function enviar(
  analiseId: string,
  mensagemId: string,
  userId: string,
  appId: number,
  personaName: string,
  texto: string,
  sessao: { ate: string; modo: string | null },
) {
  const config = await cogniflow();
  if (!config) return;
  try {
    await enviarPergunta(config, { id: mensagemId, userId, appId, personaName, texto, sessao });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await prisma.analysis.update({
      where: { id: analiseId },
      data: { status: "FAILED", error },
    });
    console.error("[analises] falha ao pedir a análise da sessão:", error);
  }
}

export type ResultadoDoPedido =
  | { pedida: true; id: string }
  | { pedida: false; motivo: "nao-existe" | "em-aberto" | "outra-em-aberto" | "nao-precisa" | "limite" | "sem-sessao" | "sem-analista" };

/**
 * Pede de novo a análise de uma sessão que já tem uma — porque a sessão
 * mudou, porque o texto era de outra sessão, porque veio ilegível ou o turno
 * se perdeu. A mesma linha é reaproveitada (o `snapshotId` é único): a
 * janela é regravada, o texto anterior vai para o `historico` com o motivo,
 * e a pergunta sai com um id de mensagem novo (`<id>.<n>`), porque o
 * cogniflow descarta como repetida uma mensagem com id já visto.
 *
 * Não pede se há outra pergunta em aberto na mesma conversa: a resposta do
 * cogniflow não diz de qual pergunta é, e duas abertas ao mesmo tempo são o
 * que deslocou análises em produção. `motivo` é só o registro (quem decidiu
 * que precisava foi `avaliarResposta`, na tela, ou o script de reprocesso).
 */
export async function pedirDeNovo(userId: string, appId: number, analiseId: string, motivo: string): Promise<ResultadoDoPedido> {
  if (!(await cogniflow())) return { pedida: false, motivo: "sem-analista" };
  const a = await prisma.analysis.findFirst({
    where: { id: analiseId, userId, gameAppId: appId, kind: "SESSION" },
    select: { id: true, status: true, answer: true, createdAt: true, pedidaEm: true, snapshotId: true, historico: true, user: { select: { personaName: true } } },
  });
  if (!a) return { pedida: false, motivo: "nao-existe" };
  const pedidaEm = a.pedidaEm ?? a.createdAt;
  if (aberta(a.status) && pedidaEm.getTime() > Date.now() - TIMEOUT_MS) return { pedida: false, motivo: "em-aberto" };
  const historico = historicoDe(a.historico);
  if (historico.length >= MAX_REPEDIDOS) return { pedida: false, motivo: "limite" };
  const sessao = a.snapshotId ? await prisma.session.findUnique({ where: { ateSnapshotId: a.snapshotId }, select: SELECAO_SESSAO }) : null;
  if (!sessao) return { pedida: false, motivo: "sem-sessao" };
  if (sessaoIncompleta(sessao)) return { pedida: false, motivo: "nao-precisa" };

  const outra = await prisma.analysis.count({
    where: {
      userId,
      gameAppId: appId,
      id: { not: a.id },
      status: { in: ["PENDING", "ACKNOWLEDGED"] },
      OR: [{ pedidaEm: { gt: new Date(Date.now() - TIMEOUT_MS) } }, { pedidaEm: null, createdAt: { gt: new Date(Date.now() - TIMEOUT_MS) } }],
    },
  });
  if (outra > 0) return { pedida: false, motivo: "outra-em-aberto" };

  const modo = modoProvado(sessao);
  const texto = textoDaPergunta({ capturedAt: sessao.ate, rounds: sessao.rounds, partidas: sessao.partidas, modo, mapa: sessao.mapa, placar: sessao.placar });
  const janela = janelaDaSessao(sessao);
  const agora = new Date();
  await prisma.analysis.update({
    where: { id: a.id },
    data: {
      status: "PENDING",
      answer: null,
      replyId: null,
      error: null,
      acknowledgedAt: null,
      answeredAt: null,
      question: texto,
      janela,
      janelaHash: hashDaJanela(janela),
      pedidaEm: agora,
      historico: [...historico, { em: agora.toISOString(), motivo, respostaAnterior: a.answer }],
    },
  });
  await enviar(a.id, `${a.id}.${historico.length + 1}`, userId, appId, a.user.personaName, texto, { ate: sessao.ateSnapshotId, modo });
  return { pedida: true, id: a.id };
}

/** A sessão mais recente existe e ainda não tem análise — a página pede. */
export async function sessaoSemAnalise(userId: string, appId: number): Promise<boolean> {
  const sessao = await sessaoMaisRecente(userId, appId);
  if (!sessao) return false;
  const existente = await prisma.analysis.findUnique({
    where: { snapshotId: sessao.ateSnapshotId },
    select: { id: true },
  });
  return !existente;
}

/**
 * A sessão mais recente, já materializada: a última linha de `Session` do
 * jogador. O modo é o provado (só `EXATA` e `INFERIDA` chegam com modo).
 */
async function sessaoMaisRecente(userId: string, appId: number): Promise<SessaoGravada | null> {
  return prisma.session.findFirst({
    where: { userId, gameAppId: appId },
    orderBy: { ate: "desc" },
    select: SELECAO_SESSAO,
  });
}

/**
 * Grava a janela de uma análise anterior à amarra, depois que ela conferiu
 * com a sessão de hoje (`scripts/banco/reprocessar-analises.ts`). Dali em
 * diante, se a sessão for refeita, a análise fica desatualizada pelo hash
 * em vez de depender só da conferência do texto. Não mexe em quem já tem.
 */
export async function gravarJanela(analiseId: string): Promise<boolean> {
  const a = await prisma.analysis.findUnique({ where: { id: analiseId }, select: { janelaHash: true, snapshotId: true } });
  if (!a || a.janelaHash || !a.snapshotId) return false;
  const s = await prisma.session.findUnique({ where: { ateSnapshotId: a.snapshotId }, select: SELECAO_SESSAO });
  if (!s) return false;
  const janela = janelaDaSessao(s);
  const r = await prisma.analysis.updateMany({ where: { id: analiseId, janelaHash: null }, data: { janela, janelaHash: hashDaJanela(janela) } });
  return r.count === 1;
}

/** A janela que uma análise gravou, para quem precisa ler de volta (scripts, testes). */
export function janelaGravada(v: unknown): JanelaDaSessao | null {
  return v && typeof v === "object" && "ate" in v ? (v as JanelaDaSessao) : null;
}

