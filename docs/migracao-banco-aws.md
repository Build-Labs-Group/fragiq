# Banco do FragIQ: Neon → Postgres da Build Labs (InfraBancos)

> **Situação:** virada feita em 11/10/2026 (parte 6). O site e o bot do
> FragIQ leem e gravam no Postgres da Build Labs; o Neon ficou intacto,
> sem escrita, como volta por 30 dias (parte 5).

Decisão do Murilo (10/10/2026): todos os bancos saem do Neon para o Postgres
próprio da Build Labs na AWS, com zero perda de linha. O do FragIQ é o Neon
`bold-credit-22972289` (Postgres 17.11, banco `neondb`, 28 tabelas, ~16 mil
linhas, ~30 MB). O destino é o banco `fragiq` do servidor `bancos` da pilha
`InfraBancos` (infra-compartilhada, `docs/bancos-postgres.md`): Postgres 18 +
pgbouncer em modo transaction, no IP privado `10.42.2.10`.

Motivo prático, além da regra: o Neon grátis tem 100 CU-hora por mês e o
FragIQ já passava de 170 (o bot acorda o banco o dia inteiro).

## 1. Quem fala com o banco

| Quem | Como | Muda? |
|---|---|---|
| Site (`fragiq-site`, Lambda) | Prisma 7 + `@prisma/adapter-pg` com `DATABASE_URL` do `/fragiq/prod/site` | entra na VPC dos bancos e passa a usar o pgbouncer (6432) |
| Migrações (`fragiq-migracoes`, Trigger do CDK) | `pg` direto, mesma montagem de conexão | entra na VPC; sem `DIRECT_DATABASE_URL` migra pelo pgbouncer, sem a trava de sessão |
| Agenda (`fragiq-agenda`) | não fala com o banco: invoca a Lambda do site | fica fora da VPC |
| Bot no host compartilhado | só pelas rotas `/api/bot/*` do site | nada |
| cogniflow (analista) | só pelas rotas do site | nada |

## 2. O que muda no código

- **Rede** (`infra/lib/ambiente.ts`, `REDE_DE_BANCOS`): `fragiq-site` e
  `fragiq-migracoes` usam as subnets privadas e o grupo exportados pela
  `InfraBancos` (`infra-bancos-lambda-subnet-ids`, `infra-bancos-lambda-sg-id`).
  A saída para a internet (Steam, OpenAI pelo cogniflow, SSM, CloudWatch e o
  próprio Neon) passa pela NAT instance da pilha (IP `77.112.137.158`). Por
  isso a rede pode entrar **antes** da troca do banco: o site continua no
  Neon pela NAT, e a janela não depende de deploy.
- **Conexão** (`src/lib/pg-config.ts`): com `DATABASE_SSL_CA` no parâmetro
  (o certificado público de `/bancos/prod/tls/ca-cert`), o `sslmode` sai da
  URL e o `pg` verifica a cadeia e o IP do servidor contra essa CA
  (equivale a `verify-full`; o certificado tem o IP `10.42.2.10` no SAN).
  `DATABASE_POOL_MAX=5` na Lambda do site (o padrão do `pg` é 10): o
  pgbouncer tem 25 conexões por banco no Postgres.
- **pgbouncer em modo transaction**: o adapter do Prisma usa prepared
  statement sem nome (vale em transaction), as transações interativas ficam
  numa conexão só, e o app não usa `SET`, `LISTEN`, advisory lock nem cursor
  `WITH HOLD`. `pgbouncer=true` na URL é inofensivo para o `pg` e é o que o
  Prisma CLI espera.
- **Migrações** (`infra/lambdas/migracoes.ts`): a Lambda não alcança a 5432
  (por desenho da `InfraBancos`). Sem `DIRECT_DATABASE_URL` no parâmetro, ela
  migra pela `DATABASE_URL` com `travar: false` (o `pg_advisory_lock` de
  sessão não serve atrás do pgbouncer). O resto do `migrate deploy` é igual
  (P3009, checksum, registro em `_prisma_migrations`).
- **Ferramentas** (`scripts/banco/copiar.ts` e `conferir.ts`): `--ca <arquivo>`
  para o destino com a CA da empresa.

### Testes

- `tests/lib/pg-config.test.ts` e `infra/test/{migracoes,pilha}.test.ts`:
  CA e pool, migração sem trava, quais Lambdas entram na VPC, política de ENI.
- `tests/integracao/banco-pg18.test.ts`, contra um Postgres 18 de verdade
  (só roda com `FRAGIQ_TEST_PG_URL`; superusuário de um Postgres
  descartável, nunca produção): as 40 migrações do zero (com e sem trava), o
  seed inteiro, o Prisma do site pela URL com `pgbouncer=true` e pool de 2
  (leitura, enum + JSON numa transação interativa, consultas em paralelo
  maiores que o pool), `copiar.ts` + `conferir.ts` iguais, e a fotografia
  acusando uma linha alterada.

  ```sh
  # Postgres 18 local sem Docker: npm i embedded-postgres@18.4.0-beta.17 numa pasta temporária
  FRAGIQ_TEST_PG_URL=postgresql://postgres:<senha>@localhost:<porta>/postgres npx vitest run tests/integracao
  ```

## 3. Parâmetro `/fragiq/prod/site`

| Versão | Banco |
|---|---|
| 1 | Supabase (02/10) |
| 2, 3 | Neon (`DATABASE_URL` pooler + `DIRECT_DATABASE_URL`) |
| 4 (a virada) | Postgres da Build Labs: `DATABASE_URL` = `/bancos/prod/fragiq/database-url` (pgbouncer 6432, `sslmode=require&pgbouncer=true`), `DATABASE_SSL_CA` = `/bancos/prod/tls/ca-cert`, **sem** `DIRECT_DATABASE_URL` |

As demais chaves (AUTH_SECRET, CRON_SECRET, cogniflow...) não mudam. A
versão anterior é a volta (parte 5).

`prisma migrate deploy` à mão (raro; a Lambda faz isso a cada publicação):
do host compartilhado, que alcança a 5432, com
`DIRECT_DATABASE_URL=$(aws ssm get-parameter --with-decryption --name /bancos/prod/fragiq/database-url-direct ...)`.

## 4. Virada

### Antes da janela (site no ar, sem parar nada)

1. PR com o código, `bl check`, `bl merge`, `bl publicar`. O site e as
   migrações passam a rodar na VPC, ainda no Neon. Conferir: `/api/health`
   200, bot chegando (`bot_status.ultimoTickEm`), logs sem ERROR, o Trigger de
   migrações rodou pela NAT ("0 aplicadas, 40 já estavam").
2. **Ensaio** no servidor, num banco descartável `fragiq_ensaio`: o mesmo
   `pg_dump`/`pg_restore`/conferência da janela, cronometrado, e o caminho do
   site até o pgbouncer (pool, TLS com a CA, transação). O banco de ensaio é
   apagado no fim.

### Janela (bot parado o mínimo possível)

Tudo pelo SSM no host compartilhado (`i-0eaf8379b0e374a0b`), que alcança o
Neon (internet) e a 5432 do servidor (peering), dentro de
`flock /tmp/bancos-virada.lock` (um serviço por vez no host). As URLs vão
para o host num prefixo temporário do bucket de backup (`conns/`), num
`pg_service.conf` em `/dev/shm` (senha fora de argumento de processo), e são
apagadas, com todas as versões, no fim.

1. Agendas `fragiq-coleta-diaria` e `fragiq-saude-dos-dados` desligadas.
2. `docker stop fragiq-bot` (o bot entrega o que tem no desligamento, com o
   site ainda no Neon).
3. Concorrência reservada 0 na `fragiq-site`: nenhuma escrita nova no Neon
   (login, sincronizar, callback do cogniflow; o cogniflow reenvia o que
   falhar pela DLQ).
4. `pg_dump -Fc --no-owner --no-privileges` do Neon (direto, cliente 18) →
   `pg_restore --exit-on-error --no-owner --no-privileges` no `fragiq` do
   servidor (5432, `verify-full` com a CA) → `conferir.ts` Neon × servidor:
   por tabela, linhas, checksum (md5 do md5 de cada linha, ordenado) e maior
   valor de cada coluna de data; colunas, índices, restrições, enums,
   sequences e extensões. Qualquer diferença aborta (o parâmetro não muda).
5. `/fragiq/prod/site` versão nova (parte 3); `SEGREDO_RELIDO` na
   `fragiq-site` (ambientes novos leem a versão nova; à mão:
   `node scripts/aws/reler-parametro.mjs`); concorrência de volta.
6. `/api/health` 200 lendo o banco novo.
7. `docker start fragiq-bot`; agendas religadas.

### Provas depois

`/api/health` 200; páginas públicas com os números de antes; `/admin`;
`/api/buildlabs/indicadores` 401 sem token e ok com; linha nova do bot
(`bot_status`, `bot_observations`, `bot_logs`) no servidor; conexões do
`fragiq` vindas das Lambdas (`pg_stat_activity`); Neon com a mesma fotografia
do momento do dump (nada gravou lá depois); alarmes `fragiq-*` em OK; logs
sem ERROR.

### Ensaio de 11/10 (banco `fragiq_ensaio` no servidor, apagável)

Dump do Neon (7,1 MB) restaurado em 4 s. Dados: contagem e checksum iguais em
todas as tabelas. A conferência acusou só falsos positivos de **versão** (Neon
17 x servidor 18), já corrigidos em `scripts/banco/foto.ts`: o PG18 lista
cada NOT NULL como restrição (218 a mais; a nulidade já é comparada nas
colunas) e o restore renumera as colunas sem os buracos de colunas apagadas
(a posição agora é a ordem relativa). Coberto por teste em
`tests/integracao/banco-pg18.test.ts`. Repetido com o `conferir` corrigido (16:12 UTC): **zero diferença**
(28 tabelas, dados e metadados), restauração em 4 s, e o caminho do site
até o pgbouncer (TLS contra a CA, 20 consultas com parâmetro em paralelo,
transação na mesma conexão) ok. O `fragiq_ensaio` e o prefixo
`conns/fragiq-ensaio-*` do bucket de backup foram apagados.

## 5. Volta

Enquanto o Neon estiver intacto (30 dias, sem escrita):

```sh
# 1. o parâmetro volta para o conteúdo da versão do Neon (3); vira uma versão nova
V=$(aws ssm get-parameter --profile buildlabs --region us-east-2 --name /fragiq/prod/site:3 --with-decryption --query Parameter.Value --output text)
aws ssm put-parameter --profile buildlabs --region us-east-2 --name /fragiq/prod/site --type SecureString --overwrite --value "$V"
unset V
# 2. ambientes novos da Lambda leem o parâmetro de novo (mantém as outras variáveis)
node scripts/aws/reler-parametro.mjs
```

O site continua na VPC e chega no Neon pela NAT; não precisa de deploy. O
que foi gravado no servidor depois da virada **não** volta sozinho: antes de
voltar, pare o bot, faça o `copiar.ts` no sentido contrário (servidor → um
banco Neon vazio) ou aceite a perda dessas linhas, conscientemente. Para tirar
as Lambdas da VPC: `REDE_DE_BANCOS = false` e `bl publicar`.

## 6. Resultado

Virada em 11/10/2026 (UTC), pelo SSM no host compartilhado:

| Hora | Passo |
|---|---|
| ~16:20 | `bl merge 33` e `bl publicar`: Lambdas na VPC dos bancos, ainda no Neon (health 200, migrações "0 aplicadas, 40 já estavam" pela NAT) |
| 16:24 | agendas `fragiq-coleta-diaria` e `fragiq-saude-dos-dados` desligadas |
| 16:25 | `fragiq-bot` parado; concorrência reservada 0 na `fragiq-site` |
| 16:25:48 | `pg_dump` do Neon (7,2 MB, sha256 `06d8627c...`), `pg_restore` no servidor em 4 s |
| 16:25:55 | conferência Neon × servidor: **28 tabelas com mesma contagem e mesmo checksum, metadados iguais** (ex.: `bot_logs` 8.699, `match_players` 1.620, `users` 4) |
| 16:26 | `/fragiq/prod/site` **v4**, `reler-parametro.mjs`, concorrência de volta, health 200 |
| 16:27 | `fragiq-bot` religado; agendas ligadas |

O dump da virada ficou em `s3://buildlabs-bancos-backup-576951332499/bancos/fragiq/virada-20261011T1625Z/`
(com o relatório da conferência). Bot parado por ~90 s, site fora por ~55 s
(cogniflow reenvia pela DLQ o que tiver falhado).

Provas depois: `/api/health` 200 (latência do banco 5 a 16 ms), página inicial
200, `/api/buildlabs/indicadores` 401 sem token, `bot_status.ultimoTickEm` e
`bot_logs` avançando no servidor (8.699 → 8.703 em 90 s), logs da
`fragiq-site` sem ERROR, alarmes `fragiq-*` em OK. O Neon não recebeu
escrita depois do dump (bot e site parados antes dele). Fica 30 dias.
