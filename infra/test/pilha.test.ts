import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { CONTA, LAYER_DO_ADAPTADOR, lerAmbiente, REGIAO } from "../lib/ambiente.ts";
import { SiteStack } from "../lib/site-stack.ts";

/** Um pacote de mentira no lugar de `.aws/site`: o teste não depende do `next build`. */
function pacoteFalso() {
  const pasta = mkdtempSync(join(tmpdir(), "fragiq-site-"));
  mkdirSync(pasta, { recursive: true });
  writeFileSync(join(pasta, "run.sh"), "#!/bin/bash\nexec node iniciar.mjs\n");
  writeFileSync(join(pasta, "server.js"), "");
  return pasta;
}

function sintetizar(virada: boolean) {
  const ambiente = lerAmbiente("prod", virada);
  const app = new App();
  const pilha = new SiteStack(app, ambiente.pilha, {
    env: { account: CONTA, region: REGIAO },
    ambiente,
    pacoteDoSite: pacoteFalso(),
  });
  return { ambiente, t: Template.fromStack(pilha) };
}

// Sintetizar empacota as Lambdas com esbuild: uma vez por estado basta.
const antes = sintetizar(false);
const depois = sintetizar(true);

const politicas = (t: Template) => JSON.stringify(t.findResources("AWS::IAM::Policy"));

describe("ambiente", () => {
  it("só produção, com os nomes da esteira", () => {
    expect(antes.ambiente).toMatchObject({
      pilha: "Fragiq-Prod",
      dominioDeTeste: "fragiq-aws.buildlabs.com.br",
      dominioPrincipal: "fragiq.buildlabs.com.br",
      parametro: "/fragiq/prod/site",
    });
    expect(() => lerAmbiente("pr3")).toThrow(/só tem produção/);
  });

  it("antes da virada o login volta para o domínio de teste; depois, para o principal", () => {
    expect(antes.ambiente.appUrl).toBe("https://fragiq-aws.buildlabs.com.br");
    expect(depois.ambiente.appUrl).toBe("https://fragiq.buildlabs.com.br");
  });
});

describe("Lambda do site", () => {
  it("arm64, Node 22, Web Adapter e o parâmetro do site, sem nenhum segredo no ambiente", () => {
    antes.t.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "fragiq-site",
      Handler: "run.sh",
      Runtime: "nodejs22.x",
      Architectures: ["arm64"],
      Timeout: 300,
      Layers: [LAYER_DO_ADAPTADOR],
      Environment: {
        Variables: {
          AWS_LAMBDA_EXEC_WRAPPER: "/opt/bootstrap",
          AWS_LWA_PORT: "8080",
          AWS_LWA_READINESS_CHECK_PROTOCOL: "tcp",
          FRAGIQ_ALVO: "aws",
          FRAGIQ_SECRET_PARAM: "/fragiq/prod/site",
          APP_URL: "https://fragiq-aws.buildlabs.com.br",
          PARAMETRO_INDICADORES: "/infra-compartilhada/prod/indicadores-token",
        },
      },
    });
    const variaveis = JSON.stringify(antes.t.findResources("AWS::Lambda::Function"));
    for (const nome of ["AUTH_SECRET", "DATABASE_URL", "CRON_SECRET", "BOT_WEBHOOK_SECRET", "COGNIFLOW_SIGNING_SECRET", "AWS_ROLE_ARN", "FRAGIQ_SECRET_ID"]) {
      expect(variaveis).not.toContain(`"${nome}"`);
    }
  });

  it("as roles leem só o parâmetro do site, o token da Cloudflare e o de indicadores, por nome exato", () => {
    const caminhos = [...politicas(antes.t).matchAll(/:parameter\/([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(caminhos)).toEqual(
      new Set([
        "fragiq/prod/site",
        "infra-compartilhada/prod/cloudflare-api-token",
        "infra-compartilhada/prod/indicadores-token",
      ]),
    );
    // Só a Lambda do site atende a rota: a agenda e as migrações não leem o token.
    const comToken = Object.values(antes.t.findResources("AWS::IAM::Policy")).filter((p) =>
      JSON.stringify(p).includes("indicadores-token"),
    );
    expect(comToken).toHaveLength(1);
    expect(politicas(antes.t)).not.toContain("secretsmanager");
  });
});

describe("HTTP API e domínios", () => {
  it("sem endpoint execute-api, com throttle", () => {
    antes.t.hasResourceProperties("AWS::ApiGatewayV2::Api", { DisableExecuteApiEndpoint: true });
    antes.t.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
      StageName: "$default",
      DefaultRouteSettings: { ThrottlingRateLimit: 50, ThrottlingBurstLimit: 100 },
    });
  });

  it("os dois domínios têm certificado e mapeamento; DNS a pilha só cria para o de teste", () => {
    antes.t.resourceCountIs("AWS::ApiGatewayV2::DomainName", 2);
    antes.t.resourceCountIs("AWS::ApiGatewayV2::ApiMapping", 2);
    antes.t.hasResourceProperties("AWS::ApiGatewayV2::DomainName", { DomainName: "fragiq.buildlabs.com.br" });
    const dns = antes.t.findResources("Custom::DnsCloudflare");
    expect(Object.values(dns).map((r) => r.Properties.Nome)).toEqual(["fragiq-aws.buildlabs.com.br"]);
    const certificados = antes.t.findResources("Custom::CertificadoCloudflare");
    expect(Object.values(certificados).map((r) => r.Properties.Dominio).sort()).toEqual([
      "fragiq-aws.buildlabs.com.br",
      "fragiq.buildlabs.com.br",
    ]);
  });
});

describe("migrações e agenda", () => {
  it("o Trigger de migrações roda antes da Lambda do site", () => {
    const triggers = antes.t.findResources("Custom::Trigger");
    expect(Object.keys(triggers)).toHaveLength(1);
    const site = Object.keys(antes.t.findResources("AWS::Lambda::Function", { Properties: { FunctionName: "fragiq-site" } }))[0]!;
    const trigger = Object.keys(triggers)[0]!;
    expect(antes.t.toJSON().Resources[site].DependsOn).toContain(trigger);
  });

  it("agenda às 05:00 UTC, desligada até a virada e ligada depois", () => {
    antes.t.hasResourceProperties("AWS::Scheduler::Schedule", {
      Name: "fragiq-coleta-diaria",
      ScheduleExpression: "cron(0 5 * * ? *)",
      State: "DISABLED",
    });
    depois.t.hasResourceProperties("AWS::Scheduler::Schedule", { State: "ENABLED" });
  });

  it("a agenda pode invocar o site (direto, sem o corte de 30 s da HTTP API)", () => {
    antes.t.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "fragiq-agenda",
      Environment: { Variables: Match.objectLike({ FUNCAO_DO_SITE: Match.anyValue(), DOMINIO: "fragiq-aws.buildlabs.com.br" }) },
    });
    expect(politicas(antes.t)).toContain("lambda:InvokeFunction");
  });

  it("saúde dos dados de 30 em 30 min, pela mesma Lambda, ligada com a agenda", () => {
    depois.t.hasResourceProperties("AWS::Scheduler::Schedule", {
      Name: "fragiq-saude-dos-dados",
      ScheduleExpression: "cron(0,30 * * * ? *)",
      State: "ENABLED",
      Target: Match.objectLike({ Input: JSON.stringify({ origem: "saude" }) }),
    });
    antes.t.hasResourceProperties("AWS::Scheduler::Schedule", { Name: "fragiq-saude-dos-dados", State: "DISABLED" });
  });

  it("um alarme por pendência e um para a checagem parada, no tópico de alertas", () => {
    const topico = `arn:aws:sns:${REGIAO}:${CONTA}:cogniflow-alertas`;
    for (const nome of ["PartidasSemSessao", "AnalisesSemResposta", "CapturasVencidas"]) {
      depois.t.hasResourceProperties("AWS::CloudWatch::Alarm", {
        Namespace: "FragIQ",
        MetricName: nome,
        Threshold: 1,
        ComparisonOperator: "GreaterThanOrEqualToThreshold",
        TreatMissingData: "notBreaching",
        AlarmActions: [topico],
      });
    }
    depois.t.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "fragiq-saude-sem-medicao",
      Statistic: "SampleCount",
      ComparisonOperator: "LessThanThreshold",
      TreatMissingData: "breaching",
    });
    depois.t.resourceCountIs("AWS::CloudWatch::Alarm", 4);
    // O tópico é referência: a pilha do FragIQ não cria nem apaga.
    depois.t.resourceCountIs("AWS::SNS::Topic", 0);
  });

  it("logs com retenção de um mês", () => {
    antes.t.hasResourceProperties("AWS::Logs::LogGroup", { LogGroupName: "/aws/lambda/fragiq-site", RetentionInDays: 30 });
  });
});
