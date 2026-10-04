/**
 * Nomes, domínios e tags do site do FragIQ na conta da Build Labs, no padrão
 * de `_buildlabs/aws.md` e da esteira da infra-compartilhada.
 *
 * Só existe produção (`prod`): o site lê o banco de produção, e uma prévia
 * por PR leria o mesmo banco. O repositório se registra na esteira sem
 * prévia (`npm run registrar -- fragiq`, na infra-compartilhada).
 */

export const CONTA = "576951332499";
export const REGIAO = "us-east-2";
export const ZONA = "buildlabs.com.br";

/** Lambda Web Adapter 0.9.1 (layer pública da AWS, conta 753240598075), arm64. */
export const LAYER_DO_ADAPTADOR = `arn:aws:lambda:${REGIAO}:753240598075:layer:LambdaAdapterLayerArm64:25`;

/**
 * A virada (passo 6 de docs/migracao-site-build-labs.md) é um PR que muda
 * este valor para `true`: a `APP_URL` passa para o domínio principal (o
 * login da Steam volta para ele) e a agenda diária liga. O DNS do domínio
 * principal não é da pilha: troca pelo `npm run virada-dns`, que também
 * desfaz.
 */
export const VIRADA_FEITA = true;

export interface Ambiente {
  nome: "prod";
  pilha: string;
  /** Prefixo dos recursos (`fragiq`). */
  prefixo: string;
  /** Subdomínio de teste, com DNS da pilha. Fica depois da virada, como acesso direto à AWS. */
  dominioDeTeste: string;
  /** Domínio de hoje (Vercel). A pilha cria certificado e mapeamento; o DNS é do `virada-dns`. */
  dominioPrincipal: string;
  /** URL pública que o site usa no OpenID da Steam e nos redirects. */
  appUrl: string;
  /** Parâmetro SecureString com o JSON de segredos e configuração (ADR 0005). */
  parametro: string;
  agendaLigada: boolean;
  /**
   * Tópico SNS que recebe os alarmes de saúde dos dados. É o de alertas da
   * empresa, hoje criado pela pilha do cogniflow (`cogniflow-alertas`, com o
   * e-mail do Murilo já confirmado). Referência por ARN: a pilha do FragIQ
   * não cria nem apaga o tópico.
   */
  topicoDeAlertas: string;
}

export function lerAmbiente(nome: unknown, virada = VIRADA_FEITA): Ambiente {
  const valor = typeof nome === "string" && nome ? nome : "prod";
  if (valor !== "prod") {
    throw new Error(`ambiente inválido: ${valor}. O site do FragIQ só tem produção (prévia leria o banco de produção).`);
  }
  const dominioDeTeste = `fragiq-aws.${ZONA}`;
  const dominioPrincipal = `fragiq.${ZONA}`;
  return {
    nome: "prod",
    pilha: "Fragiq-Prod",
    prefixo: "fragiq",
    dominioDeTeste,
    dominioPrincipal,
    appUrl: `https://${virada ? dominioPrincipal : dominioDeTeste}`,
    parametro: "/fragiq/prod/site",
    agendaLigada: virada,
    topicoDeAlertas: `arn:aws:sns:${REGIAO}:${CONTA}:cogniflow-alertas`,
  };
}

export const tagsDaEmpresa = (ambiente: string) => ({
  Empresa: "BuildLabs",
  Projeto: "fragiq",
  Ambiente: ambiente,
  Responsavel: "murilo",
  GerenciadoPor: "cdk",
});
