import { fileURLToPath } from "node:url";
import { CfnOutput, CustomResource, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { ApiMapping, DomainName, HttpApi, HttpStage } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { Certificate } from "aws-cdk-lib/aws-certificatemanager";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, type NodejsFunctionProps, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import { Schedule, ScheduleExpression, ScheduleTargetInput } from "aws-cdk-lib/aws-scheduler";
import * as sns from "aws-cdk-lib/aws-sns";
import { LambdaInvoke } from "aws-cdk-lib/aws-scheduler-targets";
import { Trigger } from "aws-cdk-lib/triggers";
import { Provider } from "aws-cdk-lib/custom-resources";
import type { Construct } from "constructs";
import { PARAMETRO_DO_TOKEN } from "../lambdas/cloudflare/parametros.ts";
import { type Ambiente, LAYER_DO_ADAPTADOR, PARAMETRO_DE_INDICADORES, tagsDaEmpresa, ZONA } from "./ambiente.ts";

export interface SiteProps extends StackProps {
  ambiente: Ambiente;
  /** Zip montado por `scripts/aws/construir.mjs` (`.aws/site.zip`, com `run.sh` executável), ou uma pasta nos testes. */
  pacoteDoSite: string;
}

const fonte = (caminho: string) => fileURLToPath(new URL(`../lambdas/${caminho}`, import.meta.url));
const migracoesDoPrisma = fileURLToPath(new URL("../../prisma/migrations", import.meta.url)).replace(/\\/g, "/");

/** ESM empacotado com o SDK dentro precisa de `require` para as dependências CommonJS. */
const BANNER_ESM = "import { createRequire } from 'module'; const require = createRequire(import.meta.url);";

/**
 * O site do FragIQ numa pilha (docs/migracao-site-build-labs.md):
 *
 * - **site**: o Next standalone numa Lambda arm64 com o Lambda Web Adapter,
 *   atrás de uma HTTP API com dois domínios: o de teste, com DNS da pilha,
 *   e o principal, cujo DNS só muda na virada (`npm run virada-dns`);
 * - **migrações**: Trigger que aplica `prisma/migrations` antes de cada
 *   versão nova do site;
 * - **agenda**: EventBridge Scheduler diário que chama `/api/cron/sync`,
 *   desligado até a virada (até lá quem coleta é o cron da Vercel);
 * - **saúde dos dados**: a mesma Lambda de 30 em 30 min chama
 *   `/api/cron/saude`, que publica `FragIQ/PartidasSemSessao`,
 *   `AnalisesSemResposta` e `CapturasVencidas`; um alarme por métrica, e
 *   um para a checagem que parou de rodar, avisam pelo tópico de alertas.
 *
 * Segredos e configuração vêm de um parâmetro só (`/fragiq/prod/site`),
 * lido em tempo de execução pela role de cada Lambda. Parado, custa centavos.
 */
export class SiteStack extends Stack {
  constructor(escopo: Construct, id: string, props: SiteProps) {
    super(escopo, id, props);
    const { ambiente } = props;
    const { prefixo } = ambiente;
    const arnDoParametro = this.formatArn({
      service: "ssm",
      resource: "parameter",
      resourceName: ambiente.parametro.slice(1),
    });
    const lerParametroDoSite = new iam.PolicyStatement({
      sid: "ParametroDoSite",
      actions: ["ssm:GetParameter"],
      // Nome exato: o site não lê `/fragiq/prod/bot` (refresh token da Steam).
      resources: [arnDoParametro],
    });

    const logDe = (nome: string) =>
      new logs.LogGroup(this, `Log${nome.replace(/(^|-)(\w)/g, (_m, _h, c: string) => c.toUpperCase())}`, {
        logGroupName: `/aws/lambda/${prefixo}-${nome}`,
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      });

    const base = (nome: string, extra: Partial<NodejsFunctionProps>): NodejsFunctionProps => ({
      functionName: `${prefixo}-${nome}`,
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      logGroup: logDe(nome),
      ...extra,
      bundling: {
        format: OutputFormat.ESM,
        target: "node22",
        minify: true,
        sourceMap: false,
        banner: BANNER_ESM,
        externalModules: ["@aws-sdk/*", "pg-native"],
        ...extra.bundling,
      },
    });

    // ---- Site ---------------------------------------------------------------
    const site = new lambda.Function(this, "Site", {
      functionName: `${prefixo}-site`,
      description: "Site do FragIQ (Next standalone + Lambda Web Adapter)",
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      code: lambda.Code.fromAsset(props.pacoteDoSite),
      handler: "run.sh",
      layers: [lambda.LayerVersion.fromLayerVersionArn(this, "AdaptadorWeb", LAYER_DO_ADAPTADOR)],
      memorySize: 1024,
      // A rota do cron declara 300 s (maxDuration); pela HTTP API o corte é 30 s, pela agenda não.
      timeout: Duration.seconds(300),
      logGroup: logDe("site"),
      environment: {
        AWS_LAMBDA_EXEC_WRAPPER: "/opt/bootstrap",
        AWS_LWA_PORT: "8080",
        // Pronto quando a porta abre: sem bater no banco a cada cold start.
        AWS_LWA_READINESS_CHECK_PROTOCOL: "tcp",
        FRAGIQ_ALVO: "aws",
        FRAGIQ_SECRET_PARAM: ambiente.parametro,
        APP_URL: ambiente.appUrl,
        // O nome, não o valor: o site lê o token em tempo de execução (src/lib/indicadores-token.ts).
        PARAMETRO_INDICADORES: PARAMETRO_DE_INDICADORES,
      },
    });
    site.addToRolePolicy(lerParametroDoSite);
    // Indicadores do painel (ADR 0006): só a Lambda do site atende `/api/buildlabs/indicadores`.
    site.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "TokenDeIndicadores",
        actions: ["ssm:GetParameter"],
        // Token compartilhado de todos os projetos: nome exato, nunca o prefixo da infra-compartilhada (ADR 0005).
        resources: [
          this.formatArn({ service: "ssm", resource: "parameter", resourceName: PARAMETRO_DE_INDICADORES.slice(1) }),
        ],
      }),
    );

    // ---- Migrações ------------------------------------------------------------
    const migracoes = new NodejsFunction(
      this,
      "Migracoes",
      base("migracoes", {
        description: "Aplica prisma/migrations no banco antes de cada versao nova do site",
        entry: fonte("migracoes-handler.ts"),
        handler: "handler",
        memorySize: 256,
        timeout: Duration.minutes(10),
        environment: { FRAGIQ_SECRET_PARAM: ambiente.parametro },
        bundling: {
          commandHooks: {
            beforeBundling: () => [],
            beforeInstall: () => [],
            afterBundling: (_entrada: string, saida: string) => [
              `node -e "require('node:fs').cpSync('${migracoesDoPrisma}', '${saida.replace(/\\/g, "/")}/migrations', { recursive: true })"`,
            ],
          },
        },
      }),
    );
    migracoes.addToRolePolicy(lerParametroDoSite);
    new Trigger(this, "MigrarAntesDoSite", {
      handler: migracoes,
      timeout: Duration.minutes(10),
      // Toda versão nova da Lambda (o pacote leva as migrações) roda de novo; sem pendentes, não faz nada.
      executeOnHandlerChange: true,
      executeBefore: [site],
    });

    // ---- Cloudflare (certificados e DNS do domínio de teste) ------------------
    const entradaCloudflare = fonte("cloudflare/handler.ts");
    const aoEvento = new NodejsFunction(
      this,
      "CloudflareAoEvento",
      base("cloudflare", {
        description: "Recurso customizado: certificado ACM validado na Cloudflare e DNS",
        entry: entradaCloudflare,
        handler: "aoEvento",
        memorySize: 256,
        timeout: Duration.minutes(2),
      }),
    );
    const estaCompleto = new NodejsFunction(
      this,
      "CloudflareEstaCompleto",
      base("cloudflare-espera", {
        description: "Recurso customizado: espera o certificado sair e a API Gateway solta-lo",
        entry: entradaCloudflare,
        handler: "estaCompleto",
        memorySize: 256,
        timeout: Duration.minutes(2),
      }),
    );
    for (const fn of [aoEvento, estaCompleto]) {
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          sid: "TokenDaCloudflare",
          actions: ["ssm:GetParameter"],
          // Credencial compartilhada: só o nome exato, nunca o prefixo da infra-compartilhada.
          resources: [
            this.formatArn({ service: "ssm", resource: "parameter", resourceName: PARAMETRO_DO_TOKEN.slice(1) }),
          ],
        }),
      );
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          sid: "Certificado",
          actions: [
            "acm:RequestCertificate",
            "acm:AddTagsToCertificate",
            "acm:DescribeCertificate",
            "acm:DeleteCertificate",
            "acm:ListCertificates",
          ],
          resources: ["*"],
        }),
      );
    }
    const provedor = new Provider(this, "ProvedorCloudflare", {
      onEventHandler: aoEvento,
      isCompleteHandler: estaCompleto,
      queryInterval: Duration.seconds(30),
      totalTimeout: Duration.minutes(60),
      logGroup: logDe("cloudflare-framework"),
    });
    const recurso = (idDoRecurso: string, tipo: string, propriedades: Record<string, unknown>) =>
      new CustomResource(this, idDoRecurso, {
        serviceToken: provedor.serviceToken,
        resourceType: `Custom::${tipo}`,
        properties: { Zona: ZONA, ...propriedades },
      });
    const tags = Object.entries(tagsDaEmpresa(ambiente.nome)).map(([Key, Value]) => ({ Key, Value }));

    const dominioDe = (idBase: string, dominio: string) => {
      const certificado = recurso(`Certificado${idBase}`, "CertificadoCloudflare", {
        Tipo: "certificado",
        Dominio: dominio,
        Tags: tags,
      });
      return new DomainName(this, `Dominio${idBase}`, {
        domainName: dominio,
        certificate: Certificate.fromCertificateArn(this, `CertificadoDoDominio${idBase}`, certificado.getAttString("Arn")),
      });
    };
    const dominioDeTeste = dominioDe("Teste", ambiente.dominioDeTeste);
    // O principal ganha certificado e mapeamento desde já (a validação é um CNAME à parte, `_...`):
    // o registro de hoje, que aponta para a Vercel, não muda até a virada.
    const dominioPrincipal = dominioDe("Principal", ambiente.dominioPrincipal);

    const api = new HttpApi(this, "Api", {
      apiName: `${prefixo}-site`,
      description: "Site do FragIQ",
      // Só pelos domínios (Cloudflare na frente); o endereço execute-api fica desligado.
      disableExecuteApiEndpoint: true,
      createDefaultStage: false,
      defaultIntegration: new HttpLambdaIntegration("IntegracaoSite", site),
    });
    const estagio = new HttpStage(this, "Estagio", {
      httpApi: api,
      stageName: "$default",
      autoDeploy: true,
      domainMapping: { domainName: dominioDeTeste },
      // Teto de custo contra abuso direto na origem. O bot faz ~0,2 req/s.
      throttle: { rateLimit: 50, burstLimit: 100 },
    });
    new ApiMapping(this, "MapeamentoPrincipal", { api, domainName: dominioPrincipal, stage: estagio });

    const dns = recurso("DnsTeste", "DnsCloudflare", {
      Tipo: "dns",
      Nome: ambiente.dominioDeTeste,
      Alvo: dominioDeTeste.regionalDomainName,
      Proxied: "true",
      Ssl: "strict",
    });
    dns.node.addDependency(estagio);

    // ---- Agenda diária --------------------------------------------------------
    const agenda = new NodejsFunction(
      this,
      "Agenda",
      base("agenda", {
        description: "Coleta diaria (/api/cron/sync) e saude dos dados (/api/cron/saude) na Lambda do site",
        entry: fonte("agenda-handler.ts"),
        handler: "handler",
        memorySize: 256,
        timeout: Duration.seconds(330),
        environment: {
          FUNCAO_DO_SITE: site.functionName,
          FRAGIQ_SECRET_PARAM: ambiente.parametro,
          DOMINIO: new URL(ambiente.appUrl).host,
        },
      }),
    );
    agenda.addToRolePolicy(lerParametroDoSite);
    site.grantInvoke(agenda);

    new Schedule(this, "ColetaDiaria", {
      scheduleName: `${prefixo}-coleta-diaria`,
      description: "Coleta diaria do FragIQ, 05:00 UTC (o mesmo horario do cron da Vercel)",
      schedule: ScheduleExpression.cron({ minute: "0", hour: "5" }),
      // Até a virada quem coleta é o cron da Vercel; duas coletas no mesmo dia não gravam duas vezes
      // (MIN_AGE_HOURS), mas gastam chamadas da Steam à toa.
      enabled: ambiente.agendaLigada,
      target: new LambdaInvoke(agenda, {
        input: ScheduleTargetInput.fromObject({ origem: "agenda" }),
        retryAttempts: 1,
      }),
    });

    // ---- Saúde dos dados ------------------------------------------------------
    // Às :00 e :30, junto com o turno do bot em repouso: o Neon já está
    // acordado nessa hora, e a checagem não abre uma janela de cobrança nova.
    new Schedule(this, "SaudeDosDados", {
      scheduleName: `${prefixo}-saude-dos-dados`,
      description: "Partida sem sessao, analise sem resposta e captura vencida, de 30 em 30 min",
      schedule: ScheduleExpression.cron({ minute: "0,30" }),
      enabled: ambiente.agendaLigada,
      target: new LambdaInvoke(agenda, {
        input: ScheduleTargetInput.fromObject({ origem: "saude" }),
        retryAttempts: 0,
      }),
    });

    const alertas = new SnsAction(sns.Topic.fromTopicArn(this, "TopicoDeAlertas", ambiente.topicoDeAlertas));
    const metrica = (nome: string, estatistica = "Maximum") =>
      new cloudwatch.Metric({ namespace: "FragIQ", metricName: nome, statistic: estatistica, period: Duration.hours(1) });
    const pendencias: [string, string, string][] = [
      ["PartidasSemSessao", "partidas-sem-sessao", "Partida do GC terminada ha mais de 24 h que nenhuma sessao do jogador contem (ver /admin, Dados em dia)"],
      ["AnalisesSemResposta", "analises-sem-resposta", "Pergunta ao analista (cogniflow) aberta ha mais de 30 min"],
      ["CapturasVencidas", "capturas-vencidas", "Captura pendente vencida ha mais de 1 h: o tick do bot ou o cron nao esta rodando"],
    ];
    for (const [nome, sufixo, descricao] of pendencias) {
      const alarme = new cloudwatch.Alarm(this, `Alarme${nome}`, {
        alarmName: `${prefixo}-${sufixo}`,
        alarmDescription: descricao,
        metric: metrica(nome),
        threshold: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      alarme.addAlarmAction(alertas);
      alarme.addOkAction(alertas);
    }
    // Sem medição, os três acima ficam em OK calados: este pega a checagem parada.
    const semMedicao = new cloudwatch.Alarm(this, "AlarmeSaudeSemMedicao", {
      alarmName: `${prefixo}-saude-sem-medicao`,
      alarmDescription: "A checagem de saude dos dados nao rodou nas ultimas 2 h (agenda, Lambda do site ou banco)",
      metric: metrica("PartidasSemSessao", "SampleCount"),
      threshold: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    });
    semMedicao.addAlarmAction(alertas);
    semMedicao.addOkAction(alertas);

    new CfnOutput(this, "UrlDeTeste", { value: `https://${ambiente.dominioDeTeste}` });
    new CfnOutput(this, "AppUrl", { value: ambiente.appUrl });
    new CfnOutput(this, "AlvoDoDominioPrincipal", {
      value: dominioPrincipal.regionalDomainName,
      description: "CNAME (com proxy) que o npm run virada-dns poe em fragiq.buildlabs.com.br",
    });
    new CfnOutput(this, "FuncaoDoSite", { value: site.functionName });
    new CfnOutput(this, "SslDoDominioDeTeste", { value: dns.getAttString("SslDoDominio") });
  }
}
