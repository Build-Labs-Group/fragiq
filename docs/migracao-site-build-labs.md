# Migração do site para a conta da Build Labs

Data: 2026-10-02 · Situação: **site virado para a AWS em 02/10/2026 às
17:06 UTC** (DNS de `fragiq.buildlabs.com.br`) e **banco no Neon desde as
21:27 UTC** (D2). Resultado, volta e o que falta na parte 8. A Vercel e o
Supabase ficam intactos como volta por uma semana. As partes 1 a 7 são o
plano como foi escrito.

O site (`fragiq.buildlabs.com.br`) roda hoje na **Vercel** (Hobby) e grava num
Postgres do **Supabase**. Os segredos vêm de `cogniflow/tenants/fragiq`, no
Secrets Manager da **conta pessoal** 981629165995, pela role OIDC
`fragiq-vercel`. Pela regra de 02/10 (só AWS, Neon e Cloudflare), a Vercel e o
Supabase saem. A conta pessoal só pode ser desligada quando o site parar de
ler esse segredo.

Destino: conta **576951332499**, região us-east-2, o mais perto de grátis. O
banco vai para o **Neon** (veja a parte 5: no grátis do Neon ele não cabe do
jeito que está).

## 1. O que o site usa da Vercel hoje

| Item | Como está | Na AWS |
|---|---|---|
| Build | `vercel-build` = `prisma migrate deploy && next build` | `scripts/aws/construir.mjs` (`next build` com `FRAGIQ_ALVO=aws`, saída standalone). As migrações saem do build e vão para uma Lambda (`infra/lambdas/migracoes.ts`, Trigger do CDK antes de cada versão nova) |
| Cron | `vercel.json`: `GET /api/cron/sync` às 05:00 UTC, Bearer `CRON_SECRET`, `maxDuration` 300 (60 no Hobby) | EventBridge Scheduler às 05:00 UTC → Lambda `fragiq-agenda` → Invoke direto da Lambda do site com o mesmo GET e o mesmo Bearer. Direto porque a HTTP API corta em 30 s. A rota não muda |
| OIDC | `@vercel/functions/oidc`, role `fragiq-vercel`, `AWS_ROLE_ARN`, `FRAGIQ_SECRET_ID`, `AWS_REGION` | A role da própria Lambda lê o SSM `/fragiq/prod/site`. Sem OIDC, sem provedor IAM (a SCP bloqueia `iam:*Provider*`) |
| `VERCEL_*` | `VERCEL_PROJECT_PRODUCTION_URL` em `appUrl()`, só se `APP_URL` faltar (em produção `APP_URL` existe) | `APP_URL` fixo na pilha |
| Analytics | `@vercel/analytics` e `@vercel/speed-insights` no `layout.tsx` | Não renderizam no build da AWS (dariam 404 em `/_vercel/...`). O Web Analytics da Cloudflare continua |
| HSTS | vem da Vercel | `Strict-Transport-Security: max-age=63072000` no `next.config.ts`, só no build da AWS |
| Imagens | `next/image`, todas `unoptimized` | `images.unoptimized` no build da AWS. Sem otimizador, o pacote dispensa o sharp (binário nativo) |
| Middleware | não há | nada |
| CSP | `next.config.ts` (Report-Only + `frame-ancestors`) | igual: os cabeçalhos são do Next |
| `/api/bot/*` | o bot chama a cada 10 a 30 s: `outbox` e `partidas` 3×/min, `tick` 2×/min, `logs` até 6×/min, mais `precos`, `demos` e `amigos` | iguais, pela HTTP API. Volume: ~450 a 700 mil requisições por mês |
| `maxDuration` | 60 s em `sync`, `partidas`, `bot/tick`, `bot/demos`; 300 s no cron | HTTP API corta em **30 s** (limite fixo). A Lambda continua até o fim (timeout 300 s) e grava; quem chamou recebe 503. Veja o risco 1 |
| Tamanho | First Load JS de 103 kB comum | pacote da Lambda: **54 MB** descompactado (limite 250 MB), ~19 MB zip |

Variáveis de produção na Vercel (só nomes): `ADMIN_STEAM_IDS`, `APP_URL`,
`AWS_REGION`, `AWS_ROLE_ARN`, `COGNIFLOW_API_URL`, `COGNIFLOW_CLIENT_ID`,
`COGNIFLOW_CONNECTION_ID`, `COGNIFLOW_TENANT_ID`, `COGNIFLOW_WEBHOOK_URL`,
`CRON_SECRET`, `CRON_TIME_BUDGET_MS`, `DATABASE_URL`, `DIRECT_DATABASE_URL`,
`FRAGIQ_SECRET_ID`, e as da integração do Supabase (`SUPA_POSTGRES_*`,
`SUPA_SUPABASE_*`, `NEXT_PUBLIC_SUPA_SUPABASE_*`). Em preview ainda existem
`AUTH_SECRET`, `BOT_WEBHOOK_SECRET`, `CRON_SECRET`, `CRON_TIME_BUDGET_MS` e
`STEAM_API_KEY` (velha, o código não usa mais).

O site **não usa nada do Supabase além do Postgres**: nenhum import de
`@supabase/*`, nenhuma leitura de `SUPA_*` ou `NEXT_PUBLIC_SUPA_*` no código
(Auth, Storage e Realtime ficam de fora). A conexão do Prisma vem de
`DATABASE_URL` (runtime, `src/lib/prisma.ts`) e de `DIRECT_DATABASE_URL`
(migrações, `prisma.config.ts`). As duas são *Sensitive* na Vercel (não dá
para ler de volta). Foram criadas junto com a integração do Supabase (24/09),
e o commit `bedab78` (25/09) levou a produção para lá. As URLs que a
integração expõe (`SUPA_POSTGRES_PRISMA_URL`, porta 6543, e
`SUPA_POSTGRES_URL_NON_POOLING`, porta 5432) apontam para
`*.pooler.supabase.com`. Conferi só o host, sem imprimir valor.

**Deploy da Vercel parado:** desde a transferência do repositório para
`Build-Labs-Group/fragiq` (02/10), o app da Vercel não está instalado na org.
Os deploys automáticos pararam, e a produção atual continua no ar com o
último deploy. Para publicar algo no site antes da virada, use
`vercel deploy --prod` à mão, só com o ok do Murilo. Atenção: um deploy da
Vercel roda `prisma migrate deploy`.

## 2. Opções e custo

Preços em us-east-2, conferidos em 02/10 na documentação da AWS: Lambda US$
0,20 por milhão de requisições e US$ 0,0000133334 por GB-s em arm64, com
grátis permanente de 1 milhão de requisições e 400 mil GB-s por mês, divididos
com as outras Lambdas da conta. HTTP API US$ 1,00 por milhão; contas criadas
depois de 15/07/2025 não têm os 12 meses grátis, e isso sai dos créditos.

### (a) Lambda + HTTP API, domínio na Cloudflare: **recomendada**

| Item | Conta | US$/mês |
|---|---|---|
| Lambda do site (1 GB, arm64) | ~600 mil req × ~150 ms ≈ 90 mil GB-s, dentro do grátis | 0 (até ~1,30 se as outras Lambdas já gastarem o grátis) |
| HTTP API | 600 mil × US$ 1/milhão | ~0,60 (crédito) |
| CloudWatch Logs | ~0,2 a 0,5 GB × US$ 0,50, retenção de 30 dias | 0,10 a 0,25 |
| EventBridge Scheduler, SSM Standard, ACM, `aws/ssm` | dentro do grátis | 0 |
| Agenda, migrações, recurso da Cloudflare | segundos por dia | ~0 |
| Pacotes do CDK no bucket do bootstrap | ~20 MB por versão | ~0,02 |
| **Total** | | **~US$ 0,75 a 2,20/mês, do crédito** |

Escala a zero, publica pela esteira (`publicar.yml`), e um host a menos para
cuidar. É o desenho do `painel` (Lambda + HTTP API + certificado e DNS pela
Cloudflare), que já roda nesta conta.

### (b) Container no host compartilhado (`infra-compartilhada-host`, t4g.small)

Medido pelo agente do host em 02/10, com o bot no ar: 1.840 MB no total, 471
usados, **1.193 MB livres**. A Lilian vai ocupar até ~900 MB. Sobram ~290 MB,
e o servidor do Next em produção usa de 200 a 350 MB, sem contar os picos do
bot ao ler demo (250 a 400 MB). **Não cabe com folga.** Além disso: custo zero
só até 31/12/2026 (depois, uma parte dos US$ 12,26 da instância ou spot); um
host único para três serviços; CPU com créditos `standard`, que o parser de
demo consome; exposição por Cloudflare Tunnel; e publicação por SSM, fora do
`publicar.yml`. A vantagem, sem limite de 30 s, não compensa.

**Recomendação: (a).** Custo de ~US$ 1/mês do crédito, zero em dinheiro.

## 3. O que este PR prepara

Nada muda na Vercel. Sem `FRAGIQ_ALVO=aws` no build, o `next.config.ts` e o
layout são os de antes (`tests/app/build-aws.test.ts`), e o `next build`
normal continua sem saída standalone.

- `src/lib/segredos.ts`: fonte nova `FRAGIQ_SECRET_PARAM` (SSM, decifrado)
  antes do caminho atual `FRAGIQ_SECRET_ID` (Secrets Manager por OIDC). Na
  Vercel nada é definido de novo, então nada muda (`tests/lib/segredos.test.ts`).
- `aws/iniciar.mjs`: boot da Lambda. Lê `/fragiq/prod/site` antes de subir o
  servidor, porque o Prisma lê `DATABASE_URL` no import. Loga só o nome do
  parâmetro e quantas chaves vieram.
- `scripts/aws/construir.mjs` (`npm run build:aws`): monta `.aws/site/`
  (standalone + estáticos + `public` + `run.sh`). Testado aqui: a home dá
  200, os estáticos dão 200 com `immutable`, sai o HSTS, nada de `/_vercel`, e
  `/api/health` diz `db unreachable` sem banco.
- `src/lib/pg-config.ts`: a regra de SSL do `pg` (Supabase com a CA deles,
  `verify-full` no resto), agora usada pelo Prisma e pelas migrações.
- `infra/` (CDK, pacote próprio): pilha **`Fragiq-Prod`** com as Lambdas
  `fragiq-site` (Lambda Web Adapter 0.9.1), `fragiq-migracoes` (Trigger),
  `fragiq-agenda` (Scheduler, **desligado até a virada**), HTTP API sem
  endpoint `execute-api`, certificados de `fragiq-aws.buildlabs.com.br`
  (teste, com DNS da pilha) e de `fragiq.buildlabs.com.br` (só certificado e
  mapeamento; o DNS muda na virada), e as tags de `aws.md`. As roles leem
  apenas `/fragiq/prod/site` e o token da Cloudflare, pelo nome exato.
- `infra/scripts/virada-dns.ts` (`npm run virada-dns`): troca o A da Vercel
  (`76.76.21.21`, proxy) pelo CNAME da HTTP API e desfaz com `--voltar`. Sem
  `--sim`, não grava.
- `scripts/banco/copiar.ts` e `conferir.ts`: cópia Supabase → Neon e
  conferência (parte 5).
- CI: jobs `infra` (typecheck e testes da pilha) e `build-aws`.

O recurso customizado da Cloudflare é uma cópia enxuta do `painel` (sem o
Access). Se um terceiro projeto precisar dele, vira pacote da
`infra-compartilhada`.

## 4. Ordem dos passos (site)

Cada passo tem volta. Até o passo 6 a Vercel segue sendo a produção.

1. **Murilo:** ok do custo (parte 2) e merge deste PR. O merge não publica
   nada, porque o repositório ainda não está na esteira.
2. **Repositório na esteira.** O repositório já foi transferido para
   `Build-Labs-Group` (02/10). Com o ok do custo:
   `npm run registrar -- fragiq` na `infra-compartilhada`, **sem prévia** (o
   site lê o banco de produção, e uma prévia leria o mesmo). Depois, um
   `.github/workflows/publicar.yml` aqui chamando
   `Build-Labs-Group/infra-compartilhada/.github/workflows/publicar.yml@main`
   com `diretorio: infra`, só em push na `main`. Esse arquivo fica para o PR
   seguinte, para o merge deste não publicar nada antes da hora.
3. **Parâmetro `/fragiq/prod/site`** (SecureString Standard, tags de `aws.md`
   mais `Consumidor=fragiq-site`, descrição com origem e como trocar). JSON:
   - `AUTH_SECRET`, `COGNIFLOW_SIGNING_SECRET`, `BOT_WEBHOOK_SECRET`: do
     `/cogniflow/prod/tenants/fragiq` (cópia de 01/10 do segredo da conta
     pessoal), de parâmetro para parâmetro, sem o valor sair do processo
     (skill `aws-secrets-manager`). O `AUTH_SECRET` tem de ser **o mesmo**,
     senão todo mundo é deslogado. Confira o hash nas duas pontas.
   - `CRON_SECRET`: um novo, só da AWS (o da Vercel continua o dela).
   - `DATABASE_URL` e `DIRECT_DATABASE_URL`: enquanto o banco for o Supabase,
     `SUPA_POSTGRES_PRISMA_URL` e `SUPA_POSTGRES_URL_NON_POOLING` (as
     *Sensitive* não se leem), por `vercel env pull` para um arquivo
     temporário, apagado logo depois. Depois da parte 5, as do Neon.
   - Configuração: `ADMIN_STEAM_IDS`, `COGNIFLOW_API_URL`,
     `COGNIFLOW_WEBHOOK_URL`, `COGNIFLOW_TENANT_ID`, `COGNIFLOW_CONNECTION_ID`,
     `COGNIFLOW_CLIENT_ID`, `CRON_TIME_BUDGET_MS`.
4. **Primeiro deploy** (`publicar` na `main`): a pilha sobe, as migrações
   rodam (não deve haver nenhuma pendente), sai o certificado dos dois
   domínios, e o DNS de **`fragiq-aws.buildlabs.com.br`** é criado. A agenda
   fica desligada e `APP_URL` aponta para o domínio de teste, para o login da
   Steam voltar para ele.
5. **Teste no subdomínio, com a Vercel no ar.** Conferência tela ↔ banco ↔
   logs, metadados incluídos:
   - Login pela Steam em `fragiq-aws.`: cookie de sessão criado, `users.updatedAt`
     (e `lastSyncedAt`, se os dados tinham mais de 6 h) atualizados, e o log da
     Lambda com `[segredos] carregado de /fragiq/prod/site (SSM, boot)`.
   - Dashboard, jogo, sessões, partidas e `/admin`: os mesmos números da
     Vercel na mesma hora, com as duas abertas lado a lado.
   - Sincronizar (`POST /api/sync`): uma linha nova em `sync_runs` com
     `trigger=MANUAL`, `startedAt`/`finishedAt` coerentes com a duração no
     log (`REPORT ... Duration`), e o `stat_snapshots` novo com `syncRunId`,
     `trigger` e `traceId` preenchidos.
   - Agenda à mão (`aws lambda invoke --function-name fragiq-agenda`): uma
     linha em `cron_runs` com `candidates`/`synced`/`skipped` iguais ao JSON
     que a agenda logou. Duas coletas no mesmo dia não gravam duas vezes
     (`MIN_AGE_HOURS`).
   - Cabeçalhos (`curl -I`): HSTS, `X-Frame-Options`, CSP Report-Only; nada de
     `x-powered-by`.
   - Tempo: P50/P99 da Lambda no CloudWatch e quantas respostas 503 por corte
     de 30 s houve em `/api/bot/tick` e `/api/sync` (risco 1).
   - Cold start: a primeira requisição depois de 15 min parado.
6. **Virada** (PR que muda `VIRADA_FEITA` para `true` e, depois do deploy,
   `npm run virada-dns -- --ir --sim`): `APP_URL` passa para
   `fragiq.buildlabs.com.br`, a agenda liga, e o A da Vercel vira o CNAME da
   HTTP API (com proxy; a regra "fragiq: SSL Full (Vercel)" da zona serve aos
   dois). O bot e o cogniflow seguem o DNS sozinhos. **No mesmo dia:**
   desligar o cron da Vercel (tirar o `crons` do `vercel.json` num deploy à
   mão, com ok) para não haver duas coletas. Conferir de novo o passo 5 no
   domínio principal, mais: callback do cogniflow (`/api/cogniflow/callback`
   com 200 e a análise gravada em `analyses`), uma partida do bot de ponta a
   ponta e o `bot_status` atualizado a cada 30 s.
7. **Volta** (a Vercel fica no ar por **uma semana**):
   `npm run virada-dns -- --voltar --sim` (menos de um minuto), e religar o
   cron da Vercel se ele já tiver saído. O banco é o mesmo dos dois lados, e
   nada se perde.
8. **Depois da semana** (com ok do Murilo): apagar o projeto `fragiq` da
   Vercel. Na conta pessoal, apagar a role `fragiq-vercel` e o provedor OIDC
   `oidc.vercel.com/<time>`. O segredo `cogniflow/tenants/fragiq` só sai
   quando o cogniflow também não o ler mais (a virada dele foi em 01/10; a
   cópia `/cogniflow/prod/tenants/fragiq` já existe). Num PR aqui: tirar
   `FRAGIQ_SECRET_ID`/OIDC de `segredos.ts`, `@vercel/*`, `vercel.json` e o
   `vercel-build`. O `fragiq-aws.` pode ficar como acesso direto à AWS ou sair.

## 5. Banco: Supabase → Neon

**Achado que muda o plano:** o Neon grátis tem 100 CU-hora por projeto por
mês e 0,5 GB de disco, e desliga a computação depois de 5 minutos sem uso. O
bot chama o site a cada 10 a 30 s, e cada chamada consulta o banco, então ele
nunca dorme. A conta fica em 0,25 CU × 730 h ≈ **182 CU-hora por mês**, e a
cota acaba por volta do dia 16. Foi isso que derrubou a produção em 22/09. No
Supabase grátis não há cota por hora, e é por isso que ele aguenta.

Opções (decisão do Murilo):

| | O quê | Custo |
|---|---|---|
| **D1** | Neon **Launch** (pago por uso) | ~US$ 19,35/mês de computação (0,25 CU × 730 h × US$ 0,106) + US$ 0,35/GB-mês, **em dinheiro** (o Neon não usa crédito AWS) |
| **D2** | Neon grátis, e o caminho quente do bot sai do Postgres: uma marca "há trabalho" no DynamoDB (grátis permanente) para `outbox`, `partidas` e `demos`, e o heartbeat do `tick` no DynamoDB. O banco só acorda com trabalho real ou com gente no site | ~0, mas precisa de uma mudança média (site + bot) e de uma semana de medição de CU-hora antes de confiar |
| **D3** | Ficar no Supabase por enquanto | 0, mas fere a regra de 02/10 |

Minha recomendação: virar **o site primeiro**, ainda com o Supabase (parte 4),
e o banco depois, com D2 se a meta é custo zero ou D1 se o Murilo aceitar
~US$ 20/mês. Qualquer que seja a escolha, a cópia é a mesma:

1. **Murilo:** ok para criar o projeto Neon `fragiq` (org
   `org-super-boat-48975090`, aws-us-east-2, Postgres 17, plano escolhido).
   A chave da API fica em `neon_api_key_build_labs_group_github.txt` e nunca
   é impressa.
2. **Tamanho** (só leitura, a qualquer hora):
   `npx tsx scripts/banco/conferir.ts --origem <supabase> --destino <supabase>`
   mostra linhas por tabela e o tamanho em MB. Se passar de 0,5 GB, o grátis
   já não serve (demo pesa ~1 MB por partida).
3. **Schema no Neon:** `DIRECT_DATABASE_URL=<neon direto> npx prisma migrate deploy`.
   Cria as 39 migrações com o mesmo DDL da origem.
4. **Ensaio**, numa branch do Neon que se apaga depois, com o site no ar:
   `copiar.ts --origem <arquivo> --destino <arquivo>` (só mostra) e, depois,
   com `--sim`. Mede o tempo da cópia, que é o tamanho da janela.
5. **Janela** (com ok, horário de pouco uso):
   - Pausar a escrita: o bot no host `i-0eaf8379b0e374a0b` (o `INICIAR`/compose
     do container `fragiq-bot`, só nessa janela) e o cron. O site fica no ar,
     mas o login e o sincronizar gravam; avise antes ou ponha uma página de
     manutenção.
   - `copiar.ts --sim`: lê o Supabase num snapshot só (REPEATABLE READ) e
     grava o Neon numa transação só, em ordem de chave estrangeira.
     `_prisma_migrations` vai linha a linha (mesmos ids, checksums e datas).
     As sequences ficam no mesmo valor. O script recusa destino com dados ou
     com schema diferente.
   - **Critério de pronto** (o script confere sozinho e sai com erro se algo
     diferir): toda tabela com a mesma **contagem** e o mesmo **checksum** (md5
     do md5 de cada linha, em ordem estável, com fuso e formatos fixados), o
     mesmo **máximo** de cada coluna de data (`createdAt`, `updatedAt`,
     `finished_at`...), as mesmas **sequences**, **colunas**, **índices**,
     **restrições**, **enums** e **extensões** usadas pelo schema (as que só o
     provedor traz, como `pg_graphql` e `supabase_vault`, ficam fora), e a
     `_prisma_migrations` igual.
   - Trocar `DATABASE_URL`/`DIRECT_DATABASE_URL` em `/fragiq/prod/site` para o
     Neon. A Lambda relê no próximo cold start; para forçar, publique de novo
     ou mude uma variável da função. Se a Vercel ainda estiver no ar, mude lá
     também (deploy à mão, com ok).
   - Religar o bot. Conferir: linhas novas em `bot_observations`,
     `pending_captures` e `bot_status` **no Neon**, e nenhuma no Supabase.
6. **No dia seguinte:** `conferir.ts` de novo. O Neon tem de ter as mesmas
   linhas de antes, mais as novas, e nunca menos. Acompanhar o consumo de
   CU-hora no painel do Neon por uma semana.
7. **Volta:** apontar o parâmetro de volta para o Supabase. O que foi gravado
   no Neon depois da janela não volta sozinho; o `copiar.ts` só copia para um
   banco vazio, então a volta depois de dias pede uma cópia nova na direção
   contrária, numa janela igual. O Supabase fica intacto (só leitura) por
   uma semana.
8. **Depois:** com ok, apagar o projeto do Supabase e a integração na
   Vercel. O registro (`_buildlabs/projetos.md`) passa a dizer Neon.

## 6. Riscos

1. **Corte de 30 s da HTTP API.** `/api/bot/tick` processa até 5 capturas
   (cada sync leva de 1 a 40 s) e `/api/sync` também pode passar de 30 s. A
   Lambda termina e grava, mas quem chamou recebe 503: o bot tenta de novo no
   tick seguinte, e o botão Sincronizar mostra erro. O passo 5 mede quantas
   vezes isso acontece. Se for frequente, um PR põe orçamento de 25 s no tick
   e devolve 202 no sincronizar.
2. **Cold start** de 1 a 2 s depois de minutos parado. Com o bot chamando a
   cada 20 s, a função quase nunca esfria.
3. **Dois crons** no dia da virada: inofensivo (`MIN_AGE_HOURS`), mas gasta
   chamadas da Steam. Por isso a agenda só liga na virada e o cron da Vercel
   sai no mesmo dia.
4. **Migrações** fora do Prisma CLI: a Lambda reproduz o `migrate deploy`
   (mesmo lock, mesma tabela, checksum SHA-256 com LF). Depois da primeira
   migração aplicada por ela, rode `npx prisma migrate status` contra o banco
   para confirmar "up to date".
5. **Esteira e repositório público:** o GitHub não deixa um repositório
   público (`fragiq`) chamar o workflow de um privado (`infra-compartilhada`):
   o `publicar` falhava antes de rodar ("workflow file issue"). Resolvido em
   02/10 sem mudar a visibilidade de nada (infra-compartilhada#10): o
   `fragiq` está registrado com `publicacaoPropria`, e o
   `.github/workflows/publicar.yml` daqui é a cópia do modelo
   `modelos/publicar-repositorio-publico.yml` de lá. O corretor aceita esse
   arquivo só neste repositório, na `main`, em push ou execução manual, como
   workflow principal, e nunca como prévia. O log do job é público: as
   dependências se instalam antes da credencial, que sai mascarada. Na falta
   da esteira, a pilha ainda se publica da máquina com
   `AWS_PROFILE=buildlabs npx cdk deploy` em `infra/` (o zip sai com o
   `run.sh` em 0755, então funciona também no Windows).

## 7. O que depende de quem

**Murilo**
- [ ] Ok do custo do site (~US$ 1/mês do crédito) e merge deste PR.
- [ ] Ok para registrar o repositório na esteira, sem prévia.
- [ ] Decisão do banco: D1 (~US$ 20/mês), D2 (grátis, com mudança no bot) ou D3.
- [ ] Ok para criar o projeto Neon e para a janela de cópia (bot parado).
- [ ] Depois da semana de volta: ok para apagar o projeto da Vercel, a role
      `fragiq-vercel`, o provedor OIDC da conta pessoal e o Supabase.

**Agente** (depois de cada ok): parâmetro, deploy, testes do passo 5,
virada, conferências e limpeza, e atualizar este documento, o
`docs/segredos.md` e o `_buildlabs/projetos.md`.

## 8. Resultado (02/10/2026, horários em UTC)

### Esteira

O `publicar` agora roda pelo `.github/workflows/publicar.yml` daqui, cópia
do modelo da `infra-compartilhada` (infra-compartilhada#10, fragiq#15). Prova:
run 37035575357 (push na `main`, 16:41), credencial `fragiq (producao)`, log
do corretor `liberado` para `Build-Labs-Group/fragiq`, e o `cdk diff` antes
mostrou que só o código da Lambda `Site` mudava (nada de DNS nem
certificado). Cada push na `main` publica a pilha `Fragiq-Prod`.

### Teste em `fragiq-aws.` (16:55)

| O quê | Resultado |
|---|---|
| `/` | 200; HSTS `max-age=63072000`, `X-Frame-Options: DENY`, CSP Report-Only, sem `x-powered-by`; estático 200 com `immutable` |
| `/cs2`, `/admin` sem sessão | 307 para `/games/730` e `/`, igual à Vercel |
| `/api/health` | 200, `collector ok`, mesma última coleta da Vercel (05:54) |
| Login pela Steam | 307 para `steamcommunity.com/openid/login` com `return_to` e `realm` do próprio domínio; callback forjado volta com "Sessão de login expirada" (a validação roda). O login completo precisa de uma pessoa com conta Steam |
| `/api/bot/outbox`, `partidas`, `demos` | 401 sem segredo; com segredo, 200 e o **mesmo corpo** da Vercel na mesma hora |
| `POST /api/bot/logs` | 200 `{"gravadas":1}` (linha DEBUG "teste da migração", 16:55:42) |
| Agenda | a regra `fragiq-coleta-diaria` liga com a virada (05:00 UTC). Não rodei à mão antes: a rota do cron enfileira lembretes no chat da Steam com o link da `APP_URL`, e antes da virada ela era o domínio de teste. A primeira execução real é 03/10 05:00; confira a linha nova em `cron_runs` |

### Clientes que falavam com `*.vercel.app`

| Cliente | Antes | Depois | Prova |
|---|---|---|---|
| Bot (`bot/producao.env`, `FRAGIQ_WEBHOOK_URL`) | `fragiq-rouge.vercel.app` | `fragiq.buildlabs.com.br` | publicado no host 16:57 (fragiq#16); do host, a URL nova responde 401 JSON do app, sem desafio da Cloudflare |
| cogniflow, conexão `web` do tenant `fragiq` (`WEBHOOK_CALLBACK_URL` e `WEBHOOK_DATA_URL` em `/cogniflow/prod/platform`, versão 7) | `fragiq-rouge.vercel.app` | `fragiq.buildlabs.com.br` | o cogniflow não tem tela nem serviço que grave essa URL: ela mora no JSON da plataforma, trocado em processo (mesmo tamanho, resto igual, tags e descrição mantidas). `SECRET_REFRESH` mudou nas Lambdas do cogniflow que leem esse JSON, para relerem. Turno de teste às 16:59: `POST https://fragiq.buildlabs.com.br/api/cogniflow/callback 200` no `cogniflow-integration-outbound` |
| Retorno do login da Steam | `APP_URL` da Vercel | `APP_URL` da Lambda = `https://fragiq.buildlabs.com.br` (fragiq#17) | `return_to` conferido acima |
| Texto do grupo da Steam (`bot/src/grupo.ts`) | `fragiq-rouge.vercel.app` | código trocado | o grupo publicado na Steam só muda se alguém rodar o script |

### Virada do DNS (17:06)

- **Antes** (guardado para a volta): `fragiq.buildlabs.com.br` **A
  `76.76.21.21`, proxy ligado, TTL automático** (id Cloudflare
  `f27d97d0e2831bd925d8a5b3ff40006c`, sem comentário). Regra de SSL do host:
  "fragiq: SSL Full (Vercel)", que não mudou.
- **Depois**: **CNAME `d-mfi8fr4boe.execute-api.us-east-2.amazonaws.com`,
  proxy ligado, TTL automático** (`npm run virada-dns -- --ir --sim` em
  `infra/`).
- Conferência: `/` 200 sem `x-vercel-id`; `/api/health` 200; rotas do bot
  com segredo 200; turno de teste do cogniflow às 17:07 chegou na Lambda
  (`[cogniflow] resposta sem pergunta aberta: teste-migracao-depois:730`, sem
  gravar nada); log da Lambda sem erro (36 requisições em 4 min, P50 63 ms).
- Os dois turnos de teste usam um usuário que não existe
  (`teste-migracao-antes` e `-depois`): o callback responde `orphan` e o
  banco do FragIQ não muda; a conversa de teste fica no cogniflow.

**Volta do site (menos de 1 min):** `AWS_PROFILE=buildlabs npm run virada-dns -- --voltar --sim`
em `infra/` (recria o A `76.76.21.21` com proxy). A Vercel continua no ar e
lendo o Supabase. Enquanto o banco for o Supabase, nada se perde.

### Ainda na Vercel (de propósito, como volta)

- O projeto `fragiq` da Vercel segue publicado em `fragiq-rouge.vercel.app`,
  com o cron das 05:00 lendo e gravando no **Supabase**. Depois que o banco
  for para o Neon, esse cron grava num banco que ninguém lê: inofensivo, mas
  o Supabase deixa de ser cópia fiel para uma volta tardia.
- Sem deploy da Vercel desde a transferência do repositório: o painel dela
  mostra o bot "parado" entre os turnos do repouso.

### Medição do D2 (20:50–21:20)

`scripts/banco/medir.ts --minutos 30 --passo 60` no Supabase, com o bot já em
repouso (fragiq#16): **0,5 consulta/min** (antes do D2: 35,2). Dessas, 0,3/min
são o `cron_runs` do `/api/health`, chamado a cada ~3 min por um monitor de
fora no endereço da **Vercel** (`fragiq-rouge.vercel.app`; log da Vercel, 20
chamadas em 1 h; nenhum repositório da Build Labs chama). A Vercel continua no
Supabase, então essas chamadas não acordam o Neon. O resto (~0,2/min) é o bot
pela AWS: `steam_messages`, `pending_captures`, `matches` e o `bot_status`
quando há trabalho. A estimativa do script (Neon acordado ~93%, ~170 CU-hora)
conta o monitor da Vercel; a prova de verdade é o consumo do projeto Neon.

### Banco: Supabase → Neon (21:26–21:28)

Neon `fragiq` = `bold-credit-22972289` (aws-us-east-2, plano grátis, branch
`main`, endpoint `ep-lively-wave-b5pd5hff`, 0,25 CU, suspensão padrão de 5
min). Schema aplicado às 17:11 com `prisma migrate deploy` das 39 migrações de
produção.

| Hora (UTC, relógio do host) | Passo |
|---|---|
| 21:25 | ensaio sem `--sim`: Neon vazio, mesmo schema, 28 tabelas na ordem das FKs |
| 21:26:27 | bot parado (`docker stop fragiq-bot` no host, pelo SSM) |
| 21:26 | `copiar.ts --sim`: cópia em 13,3 s, conferência igual (linhas, checksums, datas máximas, sequences, índices, restrições, enums) |
| 21:27 | `/fragiq/prod/site` versão 1 → **2** (`DATABASE_URL` com pooler e `DIRECT_DATABASE_URL` do Neon); `SEGREDO_RELIDO` nas Lambdas `fragiq-site` e `fragiq-migracoes` para ambientes novos lerem a versão 2 |
| 21:27:40 | bot religado (`docker start`); 73 s parado. Na volta ele já reportou o fim de uma partida e agendou a captura |

Conferência depois (`conferir.ts`, Supabase → Neon): **nenhuma diferença de
estrutura, nenhuma tabela com menos linhas no Neon**, e só linhas novas do
bot no Neon (bot_logs 6674 → 6687, bot_observations 242 → 244,
pending_captures 0 → 2, sync_runs 975 → 977). O Supabase ficou com as mesmas
contagens do momento da cópia: nada mais grava lá pela AWS.
`/api/health` na AWS: 200, `dbLatencyMs` 11 a 76.

**Volta do banco:** `/fragiq/prod/site` de volta para a versão 1 (Supabase) e
renovar as duas Lambdas. O que foi gravado no Neon depois das 21:27 não volta
sozinho; a volta depois de horas pede uma cópia no sentido contrário, numa
janela igual.

**A acompanhar:** consumo de CU-hora do projeto Neon (API
`/projects/bold-credit-22972289`, `compute_time_seconds`) no dia 03/10 e por
uma semana. Se a projeção do mês passar de ~80 CU-hora, achar o caminho que
ainda acorda o banco antes que a cota de 100 acabe. Depois da semana, com ok:
apagar o projeto da Vercel e o Supabase.

### Legado da Vercel e do Supabase (03/10/2026)

Decisão do Murilo em 03/10: o que não tem risco sai já; o que tem risco
espera data. Situação levantada às 19:00 UTC:

| Peça | Quem ainda usa | Situação |
|---|---|---|
| Bot no host (`FRAGIQ_WEBHOOK_URL` no container) | só `https://fragiq.buildlabs.com.br` | nada aponta para a Vercel nem para o Supabase |
| `/cogniflow/prod/platform` v8 e `/fragiq/prod/site` v3 | só `fragiq.buildlabs.com.br` e o Neon | idem |
| DNS `fragiq.buildlabs.com.br` | CNAME para o API Gateway (AWS) | a Vercel não recebe tráfego do domínio |
| Erros do Prisma em `/api/bot/*` na Vercel | último em 01/10 03:37 | eram o bot antigo (EC2), antes da migração do bot |
| Projeto `fragiq` da Vercel | o cron diário dela (05:55, grava no Supabase) e um **monitor do Better Stack** (conta `murilosantoseduardo@gmail.com`) em `https://fragiq-rouge.vercel.app/api/health` a cada ~3 min | **mantido**: apagar agora dispara alarme falso e deixa o fragiq sem monitor |
| Supabase `wxkjpadcpxeugpxyupcr` (store `fragiq-db` da Vercel) | só a Vercel: o `/api/health` lê `cron_runs` e o cron grava. O bot parou de gravar às 21:26 de 02/10 | **mantido** pelo mesmo motivo; **backup final feito** |

**Backup final do Supabase:** `s3://fragiq-backups-576951332499/supabase-wxkjpadcpxeugpxyupcr/2026-10-03/`
(bucket privado, SSE-S3, versionado, só TLS, tags da empresa). `pg_dump` 17.7
do banco inteiro (formato custom, 3,0 MB, sha256 `fb8db958…37beb439`,
conferido depois de baixar), a lista do conteúdo, um `LEIA-ME.txt` e a
conferência: restore do schema `public` num Postgres 17.7 local sem erro, 28
de 28 tabelas com as mesmas linhas do Supabase ao vivo (9.924) e o mesmo
conteúdo. O Neon tem as mesmas tabelas com mais linhas (11.228).
Para restaurar: `pg_restore -d <url> --no-owner --no-privileges [--schema=public] <arquivo>.dump`.

**Para apagar os dois (quando o monitor sair da Vercel):**

1. No Better Stack, trocar a URL do monitor para
   `https://fragiq.buildlabs.com.br/api/health` (responde 200 de fora, pela
   Cloudflare) ou apagar o monitor.
2. `vercel project rm fragiq` (time `murilo-eduardo-dos-santos-projects-7b517b00`).
3. `vercel integration-resource remove fragiq-db` (apaga o projeto Supabase
   pela integração da Vercel).
4. Na conta pessoal 981629165995 (quando houver sessão): role
   `fragiq-vercel` e segredo `cogniflow/tenants/fragiq`, que só a Vercel lia.

Também na Vercel e fora deste plano: o store `neon-frag-iq-db` (Neon
`curly-art-60176107`, de 03/09, sem projeto ligado). A API não entrega a
credencial, então não dá para medir uso nem fazer backup por aqui; fica até
alguém abrir pelo console.
