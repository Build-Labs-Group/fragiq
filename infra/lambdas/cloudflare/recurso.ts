/**
 * Recurso customizado do CloudFormation (framework Provider do CDK, com
 * `isComplete`) para o que mora na Cloudflare:
 *
 *   certificado  certificado ACM (us-east-2) validado por DNS: pede o
 *                certificado, cria o CNAME de validação na Cloudflare e espera
 *                ele sair (ISSUED). No delete, espera a API Gateway soltar.
 *   dns          CNAME do domínio de teste para a API Gateway, com proxy
 *                (nuvem laranja) e regra de SSL strict só para o host.
 *
 * Adaptado de `painel/src/cloudflare/recurso.ts` (commit 597d82a), sem o Access.
 */

import { createHash } from "node:crypto";
import {
  type ACMClient,
  DeleteCertificateCommand,
  DescribeCertificateCommand,
  ListCertificatesCommand,
  RequestCertificateCommand,
} from "@aws-sdk/client-acm";
import type { Cloudflare } from "./api.ts";

type Tipo = "certificado" | "dns";

export interface Propriedades {
  Tipo: Tipo;
  Zona: string;
  Dominio?: string;
  Tags?: { Key: string; Value: string }[];
  Nome?: string;
  Alvo?: string;
  Proxied?: string;
}

export interface EventoDoRecurso {
  RequestType: "Create" | "Update" | "Delete";
  RequestId: string;
  LogicalResourceId: string;
  PhysicalResourceId?: string;
  ResourceProperties: Propriedades & { ServiceToken?: string };
  OldResourceProperties?: Propriedades;
}

export interface RespostaOnEvent {
  PhysicalResourceId: string;
  Data?: Record<string, string>;
}

export interface RespostaIsComplete {
  IsComplete: boolean;
  Data?: Record<string, string>;
}

export interface DependenciasDoRecurso {
  acm: Pick<ACMClient, "send">;
  cloudflare: () => Promise<Cloudflare>;
  log?: (mensagem: string, dados?: Record<string, unknown>) => void;
}

const semPonto = (nome: string) => nome.replace(/\.$/, "");
const ehArnDeCertificado = (id: string | undefined): id is string => !!id && id.startsWith("arn:aws:acm:");

async function pedirCertificado(deps: DependenciasDoRecurso, evento: EventoDoRecurso): Promise<RespostaOnEvent> {
  const p = evento.ResourceProperties;
  const r = await deps.acm.send(
    new RequestCertificateCommand({
      DomainName: p.Dominio!,
      ValidationMethod: "DNS",
      // Mesmo pedido repetido pelo framework não gera dois certificados.
      IdempotencyToken: createHash("sha256").update(evento.RequestId).digest("hex").slice(0, 32),
      Tags: p.Tags,
    }),
  );
  return { PhysicalResourceId: r.CertificateArn!, Data: { Arn: r.CertificateArn! } };
}

export async function onEvent(deps: DependenciasDoRecurso, evento: EventoDoRecurso): Promise<RespostaOnEvent> {
  const p = evento.ResourceProperties;
  const log = deps.log ?? (() => {});
  log("recurso", { tipo: p.Tipo, pedido: evento.RequestType, id: evento.LogicalResourceId });

  if (p.Tipo === "certificado") {
    if (evento.RequestType === "Create") return pedirCertificado(deps, evento);
    if (evento.RequestType === "Update" && evento.OldResourceProperties?.Dominio !== p.Dominio) {
      return pedirCertificado(deps, evento); // id novo: o CloudFormation apaga o antigo depois
    }
    return { PhysicalResourceId: evento.PhysicalResourceId!, Data: { Arn: evento.PhysicalResourceId! } };
  }

  // dns
  const nome = p.Nome!;
  const cf = await deps.cloudflare();
  const zona = await cf.zona(p.Zona);
  if (evento.RequestType === "Delete") {
    if (evento.PhysicalResourceId === nome) {
      await cf.apagarCname(zona, nome);
      await cf.apagarSslEstrito(zona, nome);
    }
    return { PhysicalResourceId: evento.PhysicalResourceId ?? nome };
  }
  await cf.garantirCname(zona, nome, p.Alvo!, p.Proxied !== "false", "site do fragiq na AWS (cdk)");
  // Sem esta regra, com a zona em flexible, o site dá 521 (veja garantirSslEstrito).
  let sslDoDominio = "strict";
  try {
    await cf.garantirSslEstrito(zona, nome);
  } catch (erro) {
    sslDoDominio = `falhou: ${(erro as Error).message.slice(0, 200)}`;
  }
  return { PhysicalResourceId: nome, Data: { SslDoDominio: sslDoDominio } };
}

async function registroDeValidacao(deps: DependenciasDoRecurso, arn: string) {
  const r = await deps.acm.send(new DescribeCertificateCommand({ CertificateArn: arn }));
  const opcao = r.Certificate?.DomainValidationOptions?.[0];
  return { certificado: r.Certificate, registro: opcao?.ResourceRecord };
}

async function apagarCertificado(deps: DependenciasDoRecurso, evento: EventoDoRecurso): Promise<RespostaIsComplete> {
  const arn = evento.PhysicalResourceId;
  if (!ehArnDeCertificado(arn)) return { IsComplete: true };
  let nomeDaValidacao: string | undefined;
  try {
    nomeDaValidacao = (await registroDeValidacao(deps, arn)).registro?.Name;
    await deps.acm.send(new DeleteCertificateCommand({ CertificateArn: arn }));
  } catch (erro) {
    const nome = (erro as { name?: string }).name;
    // A API Gateway demora alguns minutos para soltar o certificado depois de apagar o domínio.
    if (nome === "ResourceInUseException") return { IsComplete: false };
    if (nome !== "ResourceNotFoundException") throw erro;
  }
  // O CNAME de validação é o mesmo para qualquer certificado do domínio nesta conta: só sai se nenhum outro usa.
  const dominio = evento.ResourceProperties.Dominio;
  const outros = await deps.acm.send(
    new ListCertificatesCommand({ CertificateStatuses: ["PENDING_VALIDATION", "ISSUED"] }),
  );
  const emUso = outros.CertificateSummaryList?.some((c) => c.DomainName === dominio && c.CertificateArn !== arn);
  if (nomeDaValidacao && !emUso) {
    const cf = await deps.cloudflare();
    await cf.apagarCname(await cf.zona(evento.ResourceProperties.Zona), semPonto(nomeDaValidacao));
  }
  return { IsComplete: true };
}

export async function isComplete(deps: DependenciasDoRecurso, evento: EventoDoRecurso): Promise<RespostaIsComplete> {
  if (evento.ResourceProperties.Tipo !== "certificado") return { IsComplete: true };
  if (evento.RequestType === "Delete") return apagarCertificado(deps, evento);

  const arn = evento.PhysicalResourceId!;
  const { certificado, registro } = await registroDeValidacao(deps, arn);
  const status = certificado?.Status;
  if (status === "ISSUED") return { IsComplete: true, Data: { Arn: arn } };
  if (status && status !== "PENDING_VALIDATION") {
    throw new Error(`certificado ${arn} ficou ${status}: ${certificado?.FailureReason ?? "sem motivo"}`);
  }
  if (registro?.Name && registro.Value) {
    const cf = await deps.cloudflare();
    const zona = await cf.zona(evento.ResourceProperties.Zona);
    // Validação precisa ficar sem proxy (nuvem cinza), senão o ACM não enxerga o registro.
    await cf.garantirCname(
      zona,
      semPonto(registro.Name),
      semPonto(registro.Value),
      false,
      "validacao ACM do fragiq (cdk)",
    );
  }
  return { IsComplete: false };
}
