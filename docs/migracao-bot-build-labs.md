# Migração do bot para a conta da Build Labs

Data: 2026-10-02 · Situação: **proposta**, esperando o ok do custo.

O bot de presença (`bot/`) roda na EC2 `fragiq-bot` (t2.micro, us-east-1) da
conta pessoal 981629165995. Lá não há mais free tier: custa cerca de
**US$ 13/mês em dinheiro**, mais US$ 0,40 do segredo `fragiq/bot`. O destino é
a conta da Build Labs (576951332499, us-east-2, Free Plan com US$ 199,97 de
crédito até 30/03/2027). Pedido do Murilo: ficar o mais perto possível de
custo zero.

## 1. Destino

| Item | Escolha | Por quê |
|---|---|---|
| Instância | **t4g.small** (2 vCPU ARM, 2 GB), Amazon Linux 2023 arm64 | Free trial da T4g: 750 h/mês grátis até **31/12/2026**, em qualquer conta. Tem o dobro da memória da t2.micro de hoje, e o parser de demo usa de 250 a 400 MB |
| Crédito de CPU | `standard` (não `unlimited`) | O trial cobra os créditos de CPU excedentes. Com `standard` a CPU fica mais lenta no pico, mas não gera cobrança |
| Rede | VPC padrão, subnet pública, IPv4 público automático (sem Elastic IP) | O cliente Steam e o site precisam de IPv4. Uma NAT sairia muito mais cara |
| Acesso | **SSM Session Manager**, security group sem nenhuma porta de entrada | Dispensa `fragiq-bot.pem` (que não está neste PC), regra de IP e porta 22 aberta |
| Disco | gp3 de 8 GB, criptografado | As demos vão para `/tmp` e são apagadas depois do parse |
| Segredo | SSM Parameter Store `SecureString` **`/fragiq/prod/bot`** (ADR 0005) | Grátis, no lugar do Secrets Manager. O JSON tem as mesmas chaves de hoje |
| Role | `FragiqBotInstanceRole`: `AmazonSSMManagedInstanceCore` + `ssm:GetParameter`/`PutParameter` só em `/fragiq/prod/bot` + `kms:Decrypt`/`Encrypt` da chave `aws/ssm` | Mínimo necessário: o bot regrava o refresh token quando a Steam o renova |
| Publicação | `deploy.sh` empacota `bot/`, sobe num bucket `fragiq-bot-deploy` (privado, expira em 7 dias) e roda `aws ssm send-command` com o `run.sh` | Dispensa rsync e SSH |
| IaC | CDK em `bot/infra/`, pilha **`Fragiq-Prod`**, com as tags de `aws.md` | Por enquanto, publicada da máquina local com `--profile buildlabs`. Quando o repositório for para a `Build-Labs-Group`, entra na esteira |

### Custo (sai do crédito)

| Item | Até 31/12/2026 | A partir de 01/01/2027 |
|---|---|---|
| t4g.small | US$ 0 (trial) | US$ 12,26 sob demanda. Trocar para **t4g.micro spot** (~US$ 2) ou t4g.small spot (~US$ 3,70) |
| IPv4 público | US$ 3,65 | US$ 3,65 |
| EBS gp3 8 GB | US$ 0,64 | US$ 0,64 |
| SSM (parâmetro, Session Manager, Run Command), S3 | ~US$ 0,01 | ~US$ 0,01 |
| **Total** | **~US$ 4,30/mês** | **~US$ 6,30/mês** |

Hoje são US$ 13 em dinheiro. A migração tira esse gasto do cartão. O alarme
de orçamento da `InfraCompartilhada-Prod` (US$ 30) continua valendo.

Preços consultados em 02/10 (us-east-2): t4g.small spot de US$ 0,005 a
0,0064/h, t4g.micro sob demanda US$ 0,0084/h e spot de US$ 0,0024 a 0,0032/h.

## 2. Mudança no código

- `src/segredos.ts`: com `FRAGIQ_SECRET_PARAM` definido, lê e grava o JSON no
  Parameter Store (`GetParameter` com `WithDecryption`, `PutParameter` com
  `Overwrite`). O caminho `FRAGIQ_SECRET_ID` (Secrets Manager) continua até
  a conta antiga ser desligada, para a volta funcionar.
- `Dockerfile`: a base `node:22-alpine` já é multi-arquitetura, e o
  `@laihoe/demoparser2` tem binário `linux-arm64-musl`. Fica igual.
- `bot/infra/` (CDK) e `deploy.sh`/`run.sh` novos (ver seção 1).
- Teste: `segredos.ts` com cliente simulado (leitura, gravação do token
  preservando as outras chaves, fallback para o `.env`).

## 3. Ordem dos passos

Cada passo é reversível. A Steam derruba uma das sessões se dois bots logarem
na mesma conta (`LogonSessionReplaced`), por isso **nunca há dois bots
logados ao mesmo tempo**.

1. **PR** com o código e a infra. CI verde.
2. **Infra** (com o ok do custo): `cdk deploy Fragiq-Prod`. A instância sobe
   **sem iniciar o bot**.
3. **Testes na instância nova, antes da virada:**
   - Mercado da Steam: `curl` no `priceoverview` a partir do IP novo. Esse é
     o risco principal, porque a Steam responde 429 para alguns IPs da AWS (o
     ECS recebia; a EC2 de hoje recebe 200). Se vier 429, testar outra AZ ou
     outro IP (parar e iniciar a instância troca o IP) antes de seguir.
   - Parser em ARM: rodar `demo-parse` numa demo real e comparar o JSON com o
     que a x86 gerou.
4. **Segredo:** copiar `fragiq/bot` (conta pessoal) para `/fragiq/prod/bot`
   sem que o valor passe pelo chat nem por log (skill `aws-secrets-manager`,
   de stdin para stdin). Conferir só as **chaves** do JSON e o hash do valor
   nas duas pontas.
5. **Virada** (~2 min sem bot): `docker update --restart=no` e `docker stop`
   na EC2 antiga, depois `run.sh` na nova. O `pending_captures` fica no site,
   então nada se perde nesse intervalo.
6. **Conferência (tela ↔ banco ↔ logs):**
   - `/admin`, seção Bot: heartbeat `logado`, logs chegando, sem
     `LogonSessionReplaced`.
   - Banco: `bot_observations` e `pending_captures` com linhas novas depois da
     virada, mesmo `traceId` do aviso ao ponto da série.
   - Preços: `POST /api/bot/precos` com 200 e preços atualizados.
   - Uma partida real de ponta a ponta (do fim da partida ao ponto na tela) e
     uma mensagem de chat entregue.
   - O token renovado foi regravado em `/fragiq/prod/bot` (data da versão do
     parâmetro).
7. **Conta antiga:** EC2 `fragiq-bot` **parada** (não apagada) por 7 dias,
   como volta. Depois, com o ok do Murilo: terminar a instância e apagar o
   segredo `fragiq/bot` e a role `fragiq-bot-ec2`.
8. **01/01/2027:** acaba o trial. Trocar para spot (seção 1) ou decidir de novo.

**Volta:** `docker stop` na nova e `docker start` na antiga. O segredo antigo
continua lá até o passo 7.

## 4. Achado: o site também depende da conta pessoal

`docs/segredos.md`: o site na Vercel lê `cogniflow/tenants/fragiq` do Secrets
Manager da **conta pessoal** pela role OIDC `fragiq-vercel`. O inventário da
ADR 0005 lista só o cogniflow como consumidor desse segredo. A conta antiga
não pode ser desligada antes de o site trocar de fonte (cópia em
`/cogniflow/prod/tenants/fragiq` ou um `/fragiq/prod/site` na conta da Build
Labs, com o provider OIDC da Vercel). Lembrete: a SCP bloqueia `iam:*Provider*`.
Esse é um trabalho à parte e entra junto com a ida do site para a Cloudflare
(ver `provedores-ia-por-tenant` na memória).

## 5. O que depende de quem

**Murilo**
- [ ] Ok do custo (~US$ 4,30/mês do crédito até 31/12; zero em dinheiro).
- [ ] `aws login --profile murilosantoseduardo`, que expirou e é preciso para
      ler a instância antiga e copiar o segredo.
- [ ] Jogar uma partida de CS2 depois da virada (ou pedir para um amigo do bot)
      para a conferência de ponta a ponta.
