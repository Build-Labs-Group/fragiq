# Migração do bot para a conta da Build Labs

Data: 2026-10-02 · Situação: **virada feita em 02/10/2026 às 00:59–01:00 (Brasília)**; falta a conferência com partida real e o passo 7.
O host é **compartilhado** (depois recebe a Lilian), então a infraestrutura
mora na `infra-compartilhada` (pilha `InfraCompartilhada-Host`), não aqui.

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
| Disco | gp3 de 12 GB, criptografado, mais swap de 2 GB | Imagens do Docker de mais de um projeto, swap e as demos em `/tmp` (apagadas depois do parse) |
| Segredo | SSM Parameter Store `SecureString` **`/fragiq/prod/bot`** (ADR 0005) | Grátis, no lugar do Secrets Manager. O JSON tem as mesmas chaves de hoje |
| Role | `InfraCompartilhadaHostRole`: `AmazonSSMManagedInstanceCore` + `ssm:GetParameter`/`PutParameter` só em `/fragiq/prod/bot` + `kms:Decrypt`/`Encrypt` da chave `aws/ssm` (via SSM) + leitura do bucket de deploy | Mínimo necessário: o bot regrava o refresh token quando a Steam o renova. A tag `Hospeda=fragiq` diz à auditoria de segredos que o prefixo é do projeto hospedado |
| Publicação | `deploy.sh` empacota `bot/`, sobe no bucket `infra-compartilhada-host-deploy-576951332499` (privado, expira em 3 dias) e roda `aws ssm send-command` com o `run.sh`, que faz `docker compose` com o `compose.yaml` (900 MB de limite) | Dispensa rsync e SSH |
| IaC | CDK na `infra-compartilhada` (`lib/host-stack.ts`), pilha **`InfraCompartilhada-Host`**, tags de `aws.md`, publicada pela esteira dela | O host é de vários projetos. O `deploy.sh` do bot roda da máquina local com `--profile buildlabs` (o fragiq não está na org) |

### Custo (sai do crédito)

| Item | Até 31/12/2026 | A partir de 01/01/2027 |
|---|---|---|
| t4g.small | US$ 0 (trial) | US$ 12,26 sob demanda. Trocar para **t4g.micro spot** (~US$ 2) ou t4g.small spot (~US$ 3,70) |
| IPv4 público | US$ 3,65 | US$ 3,65 |
| EBS gp3 12 GB | US$ 0,96 | US$ 0,96 |
| SSM (parâmetro, Session Manager, Run Command), S3 | ~US$ 0,01 | ~US$ 0,01 |
| **Total** | **~US$ 4,62/mês** | **~US$ 6,62/mês** (com spot) |

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
- `compose.yaml`, `producao.env` (variáveis não sensíveis), `deploy.sh` e `run.sh` novos (ver seção 1). A infraestrutura fica na `infra-compartilhada`.
- Teste: `segredos.ts` com cliente simulado (leitura, gravação do token
  preservando as outras chaves, fallback para o `.env`).

## 3. Ordem dos passos

Cada passo é reversível. A Steam derruba uma das sessões se dois bots logarem
na mesma conta (`LogonSessionReplaced`), por isso **nunca há dois bots
logados ao mesmo tempo**.

1. **PR** com o código e a infra. CI verde.
2. **Infra**: merge do PR da `infra-compartilhada` (a esteira cria a pilha
   `InfraCompartilhada-Host`). Depois `./deploy.sh` constrói a imagem no host
   **sem iniciar o bot** (só `INICIAR=1` liga).
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
   nas duas pontas. O `STEAM_BOT_ACCOUNT`, que na EC2 antiga
   ficava no `run.sh` do servidor, entra no mesmo JSON (o `config.ts` lê o
   parâmetro antes do ambiente), copiado do `docker inspect` do container antigo.
5. **Virada** (~2 min sem bot): `docker update --restart=no` e `docker stop`
   na EC2 antiga, depois `INICIAR=1 ./deploy.sh` na nova. O `pending_captures` fica no site,
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

## Resultado (02/10/2026)

| Passo | O que se viu |
|---|---|
| Host | `i-0eaf8379b0e374a0b` (t4g.small, crédito `standard`, IMDSv2, SG sem entrada, SSM `Online`), IPv4 `3.15.146.70` |
| Mercado pelo IP novo | 3 × `priceoverview` com **200** (4 s de espaço). O bot não lê preço em produção (`BOT_PRECOS` desligado desde 18/09, igual à EC2 antiga) |
| Parser em ARM | demo de 24 rounds (`3845941388759793919`, 141 MB em .bz2): saída ARM, x86 local e o `match_demos.dados` de produção com o **mesmo hash canônico** (`8210a14a…`, 3.129 eventos). Pico de 321 MB no cgroup (com cache do arquivo), parse 7 s, `bzip2` 20 s |
| Segredo | `fragiq/bot` copiado depois de parar o bot antigo (token mais novo), mais o `STEAM_BOT_ACCOUNT` do `docker inspect`; chaves e hash conferidos nas duas pontas, valor fora do chat. `Overwrite` mantém descrição e tags (testado) |
| Virada | bot antigo parado às 03:59:35Z (`restart=no`, log "Encerrando…" no `bot_logs`), novo logado às 04:00:36Z: ~1 min sem bot |
| Conferência | `bot_status`: `logado=true`, GC conectado, 5 amigos, tick a cada 30 s. `bot_logs` com "Conectado como …" do host novo. Memória: bot 149 MB de 900; host com 1,2 GB disponíveis |
| Falta | `bot_observations` e `pending_captures` novas (precisa de uma partida), mensagem de chat entregue e o refresh token regravado no parâmetro (a Steam renova sozinha, sem data) |

Acesso à EC2 antiga para a virada: regra temporária de SSH no SG para o IP
do PC e EC2 Instance Connect (chave de 60 s); a regra foi revogada logo depois.
Volta: a mesma regra, `docker start fragiq-bot` lá e `docker stop fragiq-bot` aqui.

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
- [x] Ok do custo (02/10: ~US$ 4,62/mês do crédito até 31/12; zero em dinheiro).
- [x] `aws login --profile murilosantoseduardo` renovado em 02/10.
- [ ] Jogar uma partida de CS2 depois da virada (ou pedir para um amigo do bot)
      para a conferência de ponta a ponta.
