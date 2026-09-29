# FragIQ

Plataforma de acompanhamento temporal de estatísticas de jogos, com login via
Steam. A ideia central: a Steam só guarda o **total de hoje**; o FragIQ guarda a
**série inteira** e deixa o jogador montar as próprias consultas em cima dela.

## Rodando

```bash
docker compose up -d          # Postgres em localhost:5433
cp .env.example .env          # preencha AUTH_SECRET e as variáveis COGNIFLOW_*
npm run db:migrate
npm run dev
npm test                      # vitest: series, leituras, analista, delta, analise-texto
```

Onde os números nascem, como são guardados e como aparecem está decidido em
[docs/dados-confiaveis.md](docs/dados-confiaveis.md) (fatos imutáveis com
proveniência, sessões e insights materializados e versionados, modo só com
prova, UI de uma linha).

Para avaliar a interface sem o cogniflow (e portanto sem Steam):

```bash
npm run seed                  # 90 dias de histórico fictício de CS2
npm run seed:partidas         # 12 partidas oficiais fictícias, uma com demo (página da partida)
npm run recompute:sessions    # refaz as sessões materializadas (após mudar a regra de modo)
npm run recompute:insights    # refaz os insights (após mudar a versão de uma regra)
```

e acesse `/api/auth/dev-login` (só existe fora de produção; aceita
`?steamId=` para escolher a conta).

Para diagnosticar uma conta real sem gravar nada:

```bash
npm run probe -- 76561198000000000
```

No VS Code, `.vscode/launch.json` traz o compound **FragIQ: full stack**, que
sobe o servidor e o Chrome juntos — no App Router os dois lados são o mesmo
processo Next, então breakpoints em Server Components e no explorador
funcionam na mesma sessão.

## Como os dados entram

**A Steam não tem webhooks para dados de jogador.** Os únicos webhooks do
Steamworks são de comércio, para publishers. A Web API é 100% *pull*, então a
única questão é *quando* puxar. Existem três gatilhos:

| Gatilho | Onde | Quando |
|---|---|---|
| `LOGIN` | `api/auth/steam/callback` | no login, se os dados estiverem > 6 h velhos |
| `MANUAL` | `POST /api/sync` | botão "Sincronizar", com cooldown de 2 min |
| `CRON` | `GET /api/cron/sync` | diário às 05:00 UTC (`vercel.json`; na AWS, EventBridge Scheduler → `infra/lambdas/agenda.ts`) |

O cron é o que importa: sem ele a série só tem pontos nos dias em que a pessoa
abriu o site, e uma plataforma de evolução com buracos não serve. Em produção
a coleta é automática — o botão é conveniência, não requisito.

O cron para por **orçamento de tempo**, não por contagem de usuários: um sync
varia de 1s a 40s conforme a biblioteca, então 50 usuários podem estourar o
limite da função e perder o lote inteiro. Quem não coube volta primeiro na
execução seguinte (a ordenação é por `lastSyncedAt` ascendente), então a fila
gira sem estado extra. O campo `skipped` na resposta é o sinal de que a fila
não está sendo vazada no ritmo do agendamento.

Limites da Vercel a considerar: no **Hobby** o cron roda no máximo 1×/dia e a
função morre em 60s (daí o `CRON_TIME_BUDGET_MS` padrão de 45s, que dá ~25
usuários por dia — suficiente para validar, não para escalar). No **Pro** a
cadência é por minuto e a função vai a 300s.

### Quem fala com a Steam é o cogniflow

O FragIQ não tem chave da Steam. `src/lib/steam/api.ts` mantém as funções
de sempre (`getOwnedGames`, `getUserStatsForGame`…), mas cada uma é uma
chamada `POST /capabilities/steam.*` na API de capabilities do cogniflow,
assinada com o mesmo segredo da conexão webhook (`src/lib/cogniflow-api.ts`).
A chave, a cota e as semânticas da Web API (400 em stats é "não há stats",
401 em amigos é "lista privada") moram lá; a regra de *quando* e *o que*
pedir mora aqui. As mesmas capabilities são as tools que o analista tem no
turno — o cron e o agente leem a Steam pelo mesmo caminho.

### O gate que torna o polling barato

A chave da Steam Web API permite ~100k chamadas/dia — e é uma só, da
plataforma, dividida entre todos os tenants do cogniflow. Uma varredura
ingênua (1 chamada por jogo por usuário) estoura isso com poucas centenas de
usuários.

`GetOwnedGames` devolve o `playtime_forever` de **toda** a biblioteca em uma
única chamada. Se o playtime de um jogo não mudou desde a última coleta, o
jogador não jogou, e buscar as stats dele produziria um ponto idêntico ao
anterior. `src/lib/steam/sync.ts` compara antes de gastar chamadas:

- usuário que não jogou nada: **2 chamadas** (perfil + biblioteca)
- usuário que jogou: 2 + 1 por jogo tocado, com teto de 40

Na prática isso sustenta dezenas de milhares de usuários numa chave só.

## O balde de estatísticas

`StatSnapshot.metrics` é um JSONB com os contadores crus no instante da coleta:

```json
{ "total_kills": 41234, "total_deaths": 39001, "total_shots_fired": 802431 }
```

Nada é pré-agregado. Métricas novas não exigem migração nem recoleta — o jogo
passa a expor um contador e ele aparece sozinho no explorador. É também o que
torna o sistema agnóstico de jogo: qualquer appid da Steam que exponha stats
funciona sem uma linha de código nova.

### O que o CS2 realmente expõe

Medido com `npm run probe`: **197 contadores**, dos quais 178 vão para o
explorador.

| Grupo | Qtd | Exemplos |
|---|---|---|
| Geral | 36 | `total_kills`, `total_damage_done`, `total_mvps` |
| Por arma | 94 | `total_kills_ak47`, `total_hits_awp`, `total_shots_deagle` |
| Por mapa | 30 | `total_wins_map_de_mirage`, `total_rounds_map_de_nuke` |
| Última partida | 18 | `last_match_kills`, `last_match_damage` |
| Ocultos | 19 | `GI.lesson.*` — flags de tutorial, ruído |

Isso é bem mais do que "K/D ao longo do tempo": dá precisão **por arma** e
taxa de vitória **por mapa** em série temporal, que nem csstats nem csrep
grafica hoje.

Duas ressalvas medidas experimentalmente, não documentadas pela Valve: os
contadores globais e por arma **somam todos os modos** (casual entra junto com
competitivo), e os contadores por mapa estão **congelados em mapas legados** —
Mirage, Ancient, Anubis e Overpass não são rastreados. Detalhes em
[docs/dados-profundos.md](docs/dados-profundos.md).

A primeira ressalva tem saída, e é a razão de a sessão existir
materializada: o vitalício por arma mistura modos para sempre, mas o que o
contador andou **entre duas coletas** pertence ao que foi jogado nesse
intervalo. `Session.armas` guarda esse delta (kills/tiros/acertos por arma)
e a sessão já sabe, com prova, qual foi o modo — então `arma.destaque`
(fatia dos abates) e `arma.precisao` (acertos ÷ tiros) são números por arma
de um modo só, e não do vitalício misturado. Os dois são insights
materializados e aparecem em **Destaques**, na aba Estatísticas.

### Nem todo contador é cumulativo

Tratar todos como cumulativos gera gráficos silenciosamente errados, então
`classifyMetric()` separa três naturezas:

- **`counter`** — só sobe (`total_kills`). O delta entre coletas é o período.
- **`gauge`** — reseta a cada partida (`last_match_*`). O valor **já é** do
  período; tirar delta dele compararia duas partidas diferentes. Estes só
  aceitam os modos "valor da coleta" e "razão", e a UI reconcilia o modo
  sozinha quando você troca a métrica.
- **`hidden`** — `GI.lesson.*`, fora do catálogo.

Os `last_match_*` são valiosos: dão a granularidade mais próxima de "por
partida" sem precisar parsear demo.

### Uma armadilha da Valve

`total_shots_hit` está quebrado há anos — no perfil de teste devolve 8.635
contra 940.530 de `total_shots_fired`, uma precisão impossível de 0,9%. Os
pares por arma (`total_hits_ak47` / `total_shots_ak47`) são confiáveis, e é
por isso que o preset "Precisão por arma" existe.

## Modos: Premier, Competitivo, Casual

A Steam soma todos os modos num contador só, e um K/D de Premier misturado
com casual não diz nada. Por isso o modo é uma **lente** — não um filtro:
o controle `MODO` na linha das abas vale para todas elas, e nenhum gráfico
perde pontos por causa dele. A série é sempre inteira; a lente destaca as
sessões do modo, escolhe a "última sessão" e decide o normal. A escolha vai
na URL (`?modo=premier`) e num cookie de 90 dias (`src/lib/modo.ts`,
`modo-servidor.ts`, `components/nav-jogo.tsx`). Listas (Sessões, Partidas,
Análises) filtram, porque uma lista vazia é honesta; números e gráficos
não.

O **normal** por modo (`normalDe` em `series.ts`) só existe com
`NORMAL_MIN_SESSOES` sessões e `NORMAL_MIN_ROUNDS` rounds no modo,
excluindo a sessão lida; abaixo disso a referência é o vitalício, rotulado
(`vs vitalício 0,70 · 2 de 5 sessões`) e com o chip de delta pontilhado.
`0%` por falta de base nunca é impresso. O bloco **Por modo** do Resumo
mostra os modos lado a lado, sem filtrar — é onde "não misturar" acontece
sem esvaziar a tela.

Uma exceção, desde 18/09: o chip de K/D da tabela de **Sessões** não sai da
lente. Ele é o insight `kd.vs.normal` já materializado da sessão, lido por
`chipsDeSessao` e casado com a linha por `Session.ateSnapshotId`, e a
referência dele é o normal do modo daquela sessão na hora em que ela fechou
(ou o vitalício daquela coleta, enquanto não há base). Trocar de aba não
muda o chip de uma linha, e a legenda da página diz isso.

De onde vem o modo de cada coisa: sessão = rich presence que o bot observou
(`StatSnapshot.matchMode`) ou marcação à mão (chip `modo? ▾`); partida
oficial = `Match.modo` (pelo `gameType` do GC — 8 competitivo, 264 Wingman;
Premier ainda depende da presença — ou pela presença de quem jogou);
análise = o modo da sessão analisada.

### Uma referência só

Hero, cartões, tabela de métricas, leituras e as views do analista leem
contra o mesmo normal (`lib/referencia.ts` sobre `normalDe`): com lente, o
acumulado do modo sem a sessão lida e só com base; sem base, o vitalício
dito como tal. Até 15/09 as leituras e o analista usavam outro (o acumulado
do modo com a sessão dentro), e na primeira sessão de um modo diziam
"praticamente o seu normal" por construção. `tests/lib/leituras.test.ts`
fixa isso.

### Cartões e gráficos

Um cartão só (`components/stat-card.tsx`): rótulo e chip da lente, número
e chip de delta (`delta-chip.tsx`, regras em `lib/delta.ts`: pontos
percentuais para stats em `%`, `≈` abaixo de 3 %, verde/vermelho pela
direção que é boa para a stat — o laranja nunca diz "subiu"), uma linha de
referência, o gráfico e o rodapé com a cobertura. Os gráficos são SVG à
mão sobre `PontoSerie` (`serieDeSessoes`), com domínio robusto por
mediana/MAD (`lib/dominio.ts`): um outlier vira marcador na borda com o
valor real, não achata a linha. Pontos com amostra pequena saem vazados e
ficam fora do domínio e do normal; stats por partida usam a razão móvel das
últimas 5 sessões. Formatação de números e datas passa por
`lib/formato.ts` — é o único lugar que muda na internacionalização.

### Avisos do que falta compartilhar

Três portas e um dado atrás de cada: "Detalhes do jogo" privado (nenhuma
estatística), bot não é amigo (sessões sem modo nem mapa) e corrente de
share codes desligada (nenhuma partida oficial). `src/lib/pendencias.ts`
calcula; `components/pendencias-banner.tsx` mostra em toda aba do jogo
(no Resumo o onboarding já conta a história), dispensável por uma semana.
Não há banner: cada pendência aparece onde o dado falta — a linha de
cobertura sob as abas (`6 de 10 sessões com modo · Adicionar o bot`), o
chip `modo? ▾` da sessão, o onboarding do Resumo (compacto quando as
estatísticas já entram). No chat da Steam, para quem o bot alcança, o bot **insiste com teto**
(`lembrarPendenciasNoSteam`, chamado pelo cron diário): o primeiro lembrete
depois de dois dias de amizade — ou, para as partidas, já na terceira
sessão sem corrente —, os seguintes a cada sete dias, no máximo três por
porta, com texto diferente a cada vez e sempre dizendo o mesmo no fundo: é
seguro, é uma vez só, e é o que toda plataforma (Leetify, csstats, Scope)
pede. Para quando a pessoa liga, desliga os avisos em /seguranca ou já
ouviu três vezes (`User.avisoPrivacidadeEm/avisosPrivacidade`,
`avisoPartidasEm/avisosPartidas`). Os lembretes das partidas levam o link
direto da página da Steam que gera o código (`CODIGOS_STEAM`) e o da
página onde colar. Quem adicionou o bot e **nunca entrou** também é
convidado (`BotAmigo`, a lista de amigos como fato, com ou sem conta): um
dia depois da amizade, depois semanal, três no máximo, com o link da
própria página pública (`/p/<steamId>`) e o do login — remover o bot dos
amigos encerra. Textos em `src/lib/lembretes-texto.ts`.

## O explorador

`src/lib/series.ts` deriva tudo em tempo de consulta. Como os contadores são
cumulativos e vitalícios, a média de sempre não mostra evolução — depois de
mil horas, um mês excelente não move o número. Os modos derivados resolvem:

| Modo | O que responde |
|---|---|
| `cumulative` | valor cru do contador |
| `delta` | "quantas kills naquele dia" |
| `perHour` | delta ÷ horas jogadas, para comparar dias desiguais |
| `ratio` | A ÷ B no período: K/D, HS%, precisão |

Buckets: dia, semana, mês ou cada coleta. Um bucket guarda o **último**
snapshot do período — como os contadores são cumulativos, somar os snapshots
do dia contaria duplicado.

O cálculo roda no cliente: o page envia o balde uma vez e cada ajuste de query
re-renderiza sem round-trip.

## Autenticação

Steam fala **OpenID 2.0**, não OAuth2/OIDC — por isso o Auth.js não encaixa bem
aqui (ele é construído para OAuth). São dois passos, implementados direto em
`src/lib/steam/openid.ts`:

1. redirect para `steamcommunity.com/openid/login` com um nonce anti-CSRF
2. na volta, reenvio dos parâmetros com `mode=check_authentication`; só depois
   de `is_valid:true` o `claimed_id` (o SteamID64) é confiável

A sessão é um JWT HS256 em cookie `httpOnly` (`src/lib/session.ts`). Não há
token de acesso da Steam para renovar, então não há o que um framework de auth
administraria. Trocar por Auth.js depois significa reimplementar `getSession()`
— o resto do código não toca em sessão diretamente.

O SteamID64 é a chave; `personaName` e avatar são só cache de exibição.

### Cabeçalhos de segurança

`next.config.ts` põe em toda resposta: `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, uma `Permissions-Policy`
que desliga câmera, microfone, localização, pagamento e USB, e
`frame-ancestors 'none'` + `X-Frame-Options: DENY` (nenhuma tela é feita para
iframe; sem isso, seguir, sincronizar e as configurações de privacidade
poderiam ser clicados por baixo de outra página). `x-powered-by` está
desligado. O HSTS vem da Vercel; no build da AWS (`FRAGIQ_ALVO=aws`) o
`next.config.ts` o põe.

A CSP completa ainda está em **`Content-Security-Policy-Report-Only`**: o
navegador avisa no console o que ela bloquearia e não bloqueia nada. Ela
libera os CDNs de imagem da Steam, o Vercel Analytics/Speed Insights e o
beacon do Web Analytics que o Cloudflare injeta na página, e tem
`'unsafe-inline'` em `script-src` porque a página não tem nonce. O próximo
passo é promovê-la a `Content-Security-Policy` depois de um período sem
avisos. `tests/app/cabecalhos-seguranca.test.ts` quebra se algum cabeçalho
sumir. Imagem de um host novo pede a exceção em `img-src` antes.

## Limites desta camada de dados

O que a Steam Web API entrega são **contadores vitalícios agregados**. Isso dá
kills, mortes, headshots, precisão, dano, rounds, vitórias — tudo ao longo do
tempo, com granularidade diária.

O que ela **não** entrega, e que csstats.gg / csrep.gg / Leetify mostram:
ADR, KAST, HLTV rating, clutches, entry duels e dados por round. Nada disso
existe na Web API.

O primeiro passo já está dado: **partidas oficiais, uma a uma**. Com o código
de autenticação de histórico (que só a pessoa gera, numa página da Steam) e
um share code, a Web API entrega a corrente de share codes; o bot pergunta ao
Game Coordinator por cada um e recebe o scoreboard dos dez jogadores sem
baixar demo (`src/lib/partidas.ts`, `bot/src/partidas.ts`). É o que a aba
Partidas mostra. ADR, KAST e rating pedem a demo — e o bot passou a
baixá-la e lê-la (18/09/2026): eventos em `MatchDemo`, métricas por
jogador em `MatchPlayerDemo`, ADR e KAST na página da partida. Da mesma
demo sai a primeira métrica de **time** (19/09/2026), em `MatchTeamDemo`:
a vantagem numérica e a bomba plantada que viraram round — "converteu 2 de
2 vantagens" no rodapé de cada time. Desde 21/09/2026 a mesma linha diz o
**ritmo**: a que segundo do round, contado do fim do freeze, vem o
primeiro contato e a plantada — de T é o ritmo que o time impõe, de CT o
que ele sofre. Desde 24/09/2026 o parser do bot colhe também o dinheiro e
o equipamento de cada um no fim do freeze (payload v2), de que sai a classe
do round de cada time — pistol, eco, meia ou cheia. Desde 25/09/2026 ela
está na página da partida: "eco 1 de 3 · cheia 5 de 8" no rodapé de cada
time e o ADR de cada um separado pela compra; demo lida antes da v2 fica
sem esses números, em vez de zeros. O que a demo tem, o custo medido e a linguagem tática que
falta construir estão em [docs/demos.md](docs/demos.md).

Existem cinco caminhos para chegar lá, com credenciais e custos diferentes:

- [docs/dados-profundos.md](docs/dados-profundos.md) — o que cada caminho
  entrega, como funciona e quais limites ele impõe
- [docs/roadmap-dados.md](docs/roadmap-dados.md) — qual atacar primeiro, e
  qual medição decide isso

## O analista

A análise de cada sessão, na página do jogo, vem de um agente que lê a mesma
série e responde em texto — disparado por nós a cada sessão fechada (sync,
cron, bot, scoreboard do GC), nunca por uma pergunta digitada. A resposta
tem forma fixa (manchete **em negrito**, dois ou três parágrafos, uma linha
"→" com a ação), que `src/lib/analise-texto.ts` separa por contrato — uma
manchete só é manchete quando vem marcada — e o cartão de
`components/analista.tsx` mostra sem números em bloco: "quanto?" é do
hero, "por quê e o que fazer?" é da análise. Ele não roda aqui: o FragIQ é um tenant do **cogniflow**,
conectado pelo canal webhook — a pergunta sai assinada, a resposta volta por
callback, e durante o turno o agente consulta `/api/cogniflow/data`, que
expõe as mesmas derivações de `series.ts` como views. Provisionamento,
contrato das views e prompt do agente em
[docs/cogniflow-tenant.md](docs/cogniflow-tenant.md).

## Segredos

Em produção `AUTH_SECRET`, `COGNIFLOW_SIGNING_SECRET` e
`BOT_WEBHOOK_SECRET` não são variáveis da Vercel: vêm do segredo
`cogniflow/tenants/fragiq` no Secrets Manager, lido por OIDC na primeira
leitura dentro de uma requisição (`src/lib/segredos.ts`; não no boot — o
token OIDC é um header da requisição). O que precisa ficar na
Vercel, e o passo a passo da AWS, estão em [docs/segredos.md](docs/segredos.md).

## Saída da Vercel

O site está indo para a conta AWS da Build Labs (Lambda + HTTP API, domínio
na Cloudflare), e o banco do Supabase para o Neon. Plano, custos, ordem dos
passos e volta: [docs/migracao-site-build-labs.md](docs/migracao-site-build-labs.md).
O código está em `infra/` (CDK, pilha `Fragiq-Prod`), `aws/` (boot da Lambda),
`scripts/aws/construir.mjs` (`npm run build:aws`) e `scripts/banco/` (cópia e
conferência do banco). Na Vercel nada muda até a virada.

## O bot é nosso, a Web API é do cogniflow

Decisão de 14/09/2026: o cogniflow não fala o protocolo do cliente Steam
(chat, presença, amizades, Game Coordinator) — uma conta bot é um ativo do
tenant, e a única biblioteca mantida para esse protocolo é Node. Então
`bot/` continua aqui, com a outbox, `/api/bot/*` e `/api/sync/steam-event`,
e o que mudou de mão foi só a Web API: perfil, biblioteca, estatísticas,
amigos e a corrente de share codes vêm das capabilities `steam.*` do
cogniflow. A `STEAM_API_KEY` não existe mais neste projeto.

## Estrutura

```
prisma/schema.prisma          modelo de dados
scripts/seed.ts               histórico fictício para desenvolvimento
src/lib/
  env.ts                      validação de ambiente
  session.ts                  sessão JWT em cookie
  series.ts                   motor de consulta do explorador
  referencia.ts               o normal, um só, para tela, leituras e analista
  leituras.ts                 contador em frase: o que mudou, contra o normal, com base
  stats.ts                    formatação e métricas derivadas de CS2
  analista.ts                 views que o analista consulta (data.read)
  cogniflow.ts                assinatura e envio de pedidos de análise ao cogniflow
  cogniflow-api.ts            chamada assinada de uma capability (fora do turno)
  modo.ts / modo-servidor.ts  o modo como navegação: abas, URL, cookie
  pendencias.ts               o que falta compartilhar, e o aviso no chat
  analise-texto.ts            manchete / parágrafos / ação da resposta do analista
  segredos.ts                 segredos do SSM (AWS) ou do Secrets Manager via OIDC (Vercel), preguiçosos
  pg-config.ts                SSL do pg (Prisma e migrações da AWS)
  steam/openid.ts             OpenID 2.0
  steam/api.ts                a Steam como capabilities steam.* do cogniflow
  steam/sync.ts               ingestão com gate de playtime
src/app/
  page.tsx                    landing + login
  dashboard/                  biblioteca
  games/[appId]/              explorador
  api/auth/steam/             login OpenID
  api/sync/                   coleta manual
  api/cron/sync/              coleta agendada
  admin/                      painel de operação (ADMIN_STEAM_IDS)
  comunidade/                 quem participa, selo, feedback público
  p/[steamId]/                perfil público (só o que a Steam já mostra)
  p/[steamId]/vs/[outro]/     dois perfis lado a lado
  amigos/                     amigos da Steam no FragIQ, pedidos, quem segue quem
  seguranca/                  o que lemos, guardamos e nunca tocamos; exportar e apagar
  api/analises/               análises de sessão (listar; pedir a que falta)
  api/cogniflow/              callback e dados, assinados pelo cogniflow
```
