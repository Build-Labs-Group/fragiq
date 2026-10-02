/**
 * Cliente mínimo da API da Cloudflare: CNAME e regra de SSL por host na zona
 * buildlabs.com.br. O token vem do SSM em tempo de execução.
 *
 * Cópia enxuta de `painel/src/cloudflare/api.ts` (commit 597d82a), sem a
 * parte do Access. Quando um terceiro projeto precisar, isto vira pacote da
 * infra-compartilhada em vez de mais uma cópia.
 */

const BASE = "https://api.cloudflare.com/client/v4";

export type Fetch = typeof globalThis.fetch;

export class ErroDaCloudflare extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDaCloudflare";
  }
}

interface Envelope<T> {
  success: boolean;
  errors?: { code?: number; message?: string }[];
  result: T;
}

export interface RegistroDns {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied?: boolean;
  ttl?: number;
  comment?: string | null;
}

export interface RegraDeConfig {
  id: string;
  description?: string;
  expression: string;
  action: string;
  action_parameters?: { ssl?: string };
}

interface ConjuntoDeRegras {
  id: string;
  rules?: RegraDeConfig[];
}

/** Fase das Configuration Rules da zona (SSL e afins por host). */
const FASE_CONFIG = "http_config_settings";

/** A descrição identifica a regra do FragIQ entre as outras da zona. */
export const descricaoDaRegraSsl = (host: string) => `fragiq: SSL strict em ${host} (cdk)`;

export class Cloudflare {
  constructor(
    private readonly token: string,
    private readonly fetchFn: Fetch = fetch,
  ) {}

  async pedir<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
    const resposta = await this.fetchFn(`${BASE}${caminho}`, {
      method: metodo,
      headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(20_000),
    });
    const texto = await resposta.text();
    let envelope: Envelope<T> | undefined;
    try {
      envelope = JSON.parse(texto) as Envelope<T>;
    } catch {
      // resposta sem JSON: vira erro abaixo
    }
    if (!resposta.ok || !envelope?.success) {
      const detalhe = envelope?.errors?.map((e) => `${e.code ?? ""} ${e.message ?? ""}`.trim()).join("; ");
      throw new ErroDaCloudflare(
        `Cloudflare ${metodo} ${caminho.split("?")[0]} respondeu ${resposta.status}: ${detalhe ?? texto.slice(0, 120)}`,
      );
    }
    return envelope.result;
  }

  async zona(nome: string): Promise<string> {
    const zonas = await this.pedir<{ id: string; name: string }[]>("GET", `/zones?name=${encodeURIComponent(nome)}`);
    const zona = zonas.find((z) => z.name === nome);
    if (!zona) throw new ErroDaCloudflare(`zona ${nome} não encontrada com este token`);
    return zona.id;
  }

  /** Todos os registros com este nome, de qualquer tipo. */
  async registros(zona: string, nome: string): Promise<RegistroDns[]> {
    return this.pedir<RegistroDns[]>("GET", `/zones/${zona}/dns_records?name=${encodeURIComponent(nome)}`);
  }

  async registro(zona: string, nome: string): Promise<RegistroDns | undefined> {
    return (await this.registros(zona, nome)).find((r) => r.type === "CNAME");
  }

  /** Cria ou atualiza um CNAME. Não mexe em registro de outro tipo com o mesmo nome. */
  async garantirCname(zona: string, nome: string, alvo: string, proxied: boolean, comentario: string) {
    const atual = await this.registro(zona, nome);
    const corpo = { type: "CNAME", name: nome, content: alvo, proxied, ttl: 1, comment: comentario };
    if (!atual) return this.pedir<RegistroDns>("POST", `/zones/${zona}/dns_records`, corpo);
    if (atual.content === alvo && !!atual.proxied === proxied) return atual;
    return this.pedir<RegistroDns>("PATCH", `/zones/${zona}/dns_records/${atual.id}`, corpo);
  }

  async apagarCname(zona: string, nome: string): Promise<void> {
    const atual = await this.registro(zona, nome);
    if (atual) await this.pedir("DELETE", `/zones/${zona}/dns_records/${atual.id}`);
  }

  /**
   * Configuration Rule que põe só este host em SSL "strict". A zona está em
   * "flexible" (outros sites dependem disso), e com flexible a Cloudflare fala
   * HTTP com a origem: a API Gateway só atende HTTPS e o site dá 521.
   * Adiciona ou corrige só a regra deste host; as outras regras da zona ficam.
   */
  async garantirSslEstrito(zona: string, host: string): Promise<void> {
    const regra = {
      description: descricaoDaRegraSsl(host),
      expression: `(http.host eq "${host}")`,
      action: "set_config",
      action_parameters: { ssl: "strict" },
      enabled: true,
    };
    const entrada = await this.entradaDeConfig(zona);
    if (!entrada) {
      await this.pedir("PUT", `/zones/${zona}/rulesets/phases/${FASE_CONFIG}/entrypoint`, { rules: [regra] });
      return;
    }
    const atual = entrada.rules?.find((r) => r.description === regra.description);
    if (!atual) {
      await this.pedir("POST", `/zones/${zona}/rulesets/${entrada.id}/rules`, regra);
      return;
    }
    if (atual.expression === regra.expression && atual.action_parameters?.ssl === "strict") return;
    await this.pedir("PATCH", `/zones/${zona}/rulesets/${entrada.id}/rules/${atual.id}`, regra);
  }

  async apagarSslEstrito(zona: string, host: string): Promise<void> {
    const entrada = await this.entradaDeConfig(zona);
    const atual = entrada?.rules?.find((r) => r.description === descricaoDaRegraSsl(host));
    if (entrada && atual) await this.pedir("DELETE", `/zones/${zona}/rulesets/${entrada.id}/rules/${atual.id}`);
  }

  /** Regras de configuração da zona que valem para este host, de qualquer dono. */
  async regrasDoHost(zona: string, host: string): Promise<RegraDeConfig[]> {
    const entrada = await this.entradaDeConfig(zona);
    return entrada?.rules?.filter((r) => r.expression.includes(`"${host}"`)) ?? [];
  }

  /** Conjunto de regras de configuração da zona, ou `undefined` se ainda não existe. */
  private async entradaDeConfig(zona: string): Promise<ConjuntoDeRegras | undefined> {
    try {
      return await this.pedir<ConjuntoDeRegras>("GET", `/zones/${zona}/rulesets/phases/${FASE_CONFIG}/entrypoint`);
    } catch (erro) {
      if (erro instanceof ErroDaCloudflare && / respondeu 404:/.test(erro.message)) return undefined;
      throw erro;
    }
  }
}
