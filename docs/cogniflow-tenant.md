# O analista: FragIQ como tenant do cogniflow

A análise de sessão na página do jogo não chama um modelo daqui.
O FragIQ é um **tenant do cogniflow** — o runtime de agentes da SistemasGlobal
que já atende WhatsApp e e-mail — conectado pelo canal `webhook`, que existe
justamente para a aplicação do próprio cliente ser um canal como outro
qualquer.

```text
FragIQ                                cogniflow
──────                                ─────────
POST /api/analises
  └─ grava Analysis PENDING
  └─ POST {WEBHOOK_URL}  ───────────▶ integration-service  /webhooks/webhook
       X-Signature-256                  └─ SQS ─▶ orchestration-service
                                                    └─ agente (LangChain)
/api/cogniflow/callback ◀──────────────── POST acknowledgement
  └─ Analysis ACKNOWLEDGED                       │
                                                 │ data.read (n vezes)
/api/cogniflow/data     ◀──────────────── POST {view, params, context}
  └─ consulta a série,  ─────────────────▶ JSON
     mesma de series.ts                          │
                                                 │ messaging.send
/api/cogniflow/callback ◀──────────────── POST message {text}
  └─ Analysis ANSWERED
```

A análise chega sozinha: toda coleta que fecha uma sessão (rounds subiram
desde o ponto anterior) cria uma `Analysis` de tipo `SESSION` amarrada à
coleta (`snapshotId` único) e manda ao agente "Nova sessão registrada em …:
N rounds em M partidas — modo premier (Premier), mapa de_mirage (Mirage),
placar 13:9. Analise esta sessão contra o meu normal… Comece pela view
resumo com modo="premier", e mantenha esse modo em toda consulta". O
gatilho está no sync (cron, bot, manual, login) e a página repete o pedido
ao abrir se a sessão mais recente ainda não tem análise.

O modo da sessão vem do rich presence que o bot observou (ou do que a
pessoa marcou à mão); sem bot a mensagem vai sem modo e o analista compara
com o vitalício de tudo, que é o único normal que existe nesse caso.

Um único segredo (HMAC-SHA256 do corpo, header `X-Signature-256`) assina os
três caminhos. A conversa no cogniflow é `${userId}:${appId}`, então o agente
tem memória por jogador e jogo: "e no Mirage?" depois de "como fui esta
semana?" funciona.

O que mora em cada lado:

| Onde | O quê |
|---|---|
| `src/lib/cogniflow.ts` | assinatura, envio da pergunta, leitura do corpo assinado |
| `src/lib/analista.ts` | as views que o `data.read` consulta (contrato abaixo) |
| `src/app/api/analises` | POST pergunta / GET lista (a tela consulta enquanto espera) |
| `src/app/api/cogniflow/*` | callback e endpoint de dados, ambos assinados |
| cogniflow `integration-service/app/integrations/webhook/` | o canal genérico |
| cogniflow `orchestration-service/app/tools/data.py` | a capability `data.read` |

## De qual pergunta é a resposta

A resposta (`type=message`) não traz o id da nossa pergunta. Até 03/10/2026
o callback gravava na **pergunta mais antiga em aberto** da conversa,
supondo uma aberta por vez. A análise de sessão abre uma pergunta por sessão,
sem esperar a anterior, e em 02/10 às 15:33 UTC um turno terminou sem texto
(o `analista` estava no `cloudflare:@cf/openai/gpt-oss-20b`, versão 10, que
gastava os 256 tokens no raciocínio; o cogniflow não entrega turno sem
texto). A pergunta ficou aberta e, dali em diante, cada resposta de um
jogador caiu na pergunta anterior à dela: 7 sessões mostravam a análise da
sessão seguinte, a mensagem no chat da Steam saía uma sessão atrasada, e a
última sessão ficava sempre "perdida". O `/admin` não mostrava nada errado.

Desde 04/10 a dona é **provada** (`src/lib/resposta-do-analista.ts`):

1. `reply_to_message_id` da resposta, quando é o id de uma pergunta da
   conversa (o agente citou a mensagem);
2. o `id` da resposta, que o cogniflow deriva do id da mensagem que abriu o
   turno:

   ```text
   event_id = "{tenant}:webhook:{conexão}:{id da pergunta}"
   id       = uuid5(NAMESPACE_URL, "message.send.requested:{tenant}:{conexão}:{conversa}:{event_id}:default")
   ```

   (cogniflow `orchestration-service/app/workers/requests.py::event_id_of` e
   `app/capabilities/messaging.py::_command_id`). Conferido em 03/10 contra
   as 25 respostas gravadas em produção: as 18 corretas batem com a própria
   pergunta, as 7 deslocadas batem com a pergunta seguinte;
3. uma única pergunta aberta na conversa (rede de segurança se o cogniflow
   mudar a derivação).

Sem nenhuma das três, a resposta **não é gravada** (`analise.resposta_sem_dona`
no diário) e, se a dona já tiver outra resposta, também não
(`analise.resposta_conflito`): análise de outra sessão na tela é pior que
nenhuma. Pergunta aberta há mais de 30 min dispara o alarme
`fragiq-analises-sem-resposta` (README, "Saúde dos dados").

Reparo do que já estava deslocado: `scripts/banco/reparar-analises.ts`
(simula por padrão; `--aplicar` grava numa transação por conversa, com
auditoria em `eventos`). Rodado em 04/10/2026 (resultado em
`backlog/itens/FQ-0005-analise-de-outra-sessao.md`).

## Provisionamento

Ordem: (1) deploy dos dois serviços do cogniflow com o canal `webhook` e o
`data.read` (`cogniflow/deploy-service.sh <serviço>`: build, push com a tag do
commit, nova revisão de task definition em cada serviço ECS, espera o
rollout); (2) segredo e canal; (3) tenant e agente no Postgres; (4) env na
Vercel. Tudo isto foi executado em 2026-09-13 e está no ar; fica registrado
para o próximo tenant ou para reconstruir.

O orchestration entrega o texto final do agente mesmo que o modelo não chame
`messaging.send` — regra do runtime, em qualquer canal; no primeiro turno real
ele consultou os dados, escreveu a resposta e não chamou a ferramenta. O
prompt ainda pede a chamada, mas a entrega não depende dela.

### 1. Segredo de plataforma (`cogniflow/prod`, Secrets Manager)

Gere o segredo compartilhado:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Acrescente ao JSON do segredo, sob `tenants`:

```json
"fragiq": {
  "webhook": {
    "web": {
      "WEBHOOK_SIGNING_SECRET": "<o valor gerado>",
      "WEBHOOK_CALLBACK_URL": "https://<dominio-do-fragiq>/api/cogniflow/callback",
      "WEBHOOK_DATA_URL": "https://<dominio-do-fragiq>/api/cogniflow/data"
    }
  }
}
```

Os dois serviços leem o segredo no boot e cacheiam; depois de editar, reinicie
as tasks ECS (`integration-service`, `integration-inbound-worker`,
`integration-worker`, `orchestration-service`).

### 2. Canal (`cogniflow-channels`, DynamoDB)

```bash
aws dynamodb put-item --table-name cogniflow-channels --item '{
  "pk":             {"S": "webhook:http#fragiq"},
  "tenant_id":      {"S": "fragiq"},
  "connection_key": {"S": "webhook:http#web"},
  "connection_id":  {"S": "web"},
  "provider":       {"S": "webhook"},
  "product":        {"S": "http"},
  "external_id":    {"S": "fragiq"},
  "status":         {"S": "active"}
}'
```

`external_id` é o `client_id` que o FragIQ manda em cada pergunta
(`COGNIFLOW_CLIENT_ID`).

### 3. Tenant e agente (Postgres do orchestration-service)

O banco fica na VPC da plataforma, então o provisionador roda como task avulsa
do ECS com a imagem do orchestration. É idempotente: cria o que falta, mantém
o que existe e nunca substitui uma versão publicada.

```bash
aws ecs run-task --cluster cogniflow --launch-type FARGATE \
  --task-definition orchestration-service \
  --network-configuration "$(aws ecs describe-services --cluster cogniflow \
      --services orchestration-worker --query 'services[0].networkConfiguration' --output json)" \
  --overrides '{"containerOverrides":[{"name":"orchestration-service","command":[
    "python","-m","app.admin.provision",
    "--tenant","fragiq","--name","FragIQ","--connection","web",
    "--agent-slug","analista","--agent-name","Analista do FragIQ",
    "--model","openai:gpt-4o-mini","--monthly-budget-usd","20",
    "--prompt","<o prompt da seção abaixo>"]}]}'
```

A saída (`created: …` / `kept: …`) fica no log group `/ecs/orchestration-service`,
stream `ecs/orchestration-service/<id da task>`. Feito em 2026-09-13; v1 do
prompt publicada.

O prompt abaixo é a **v4** (17/09/2026): a resposta é JSON e a tela
desenha (`src/components/analista.tsx`); a v3 (15/09) tinha referência
nomeada pelo tipo,
causa só com dado, ação derivável. Ainda não publicada no cogniflow — a v2
continua no ar e funciona com as views novas, porque `vitalicio` manteve o
nome e só passou a trazer o número certo.

Versões seguintes do prompt entram pelo painel admin
(`POST /admin/agents/fragiq/analista/versions` com `publish=true`), que copia
capabilities e graph da anterior.

### 3b. Grants `steam.*` (a Steam passa pelo cogniflow)

Desde 13/09/2026 o FragIQ não tem chave da Steam: perfil, biblioteca,
estatísticas, amigos, vanity URL e a corrente de share codes são capabilities
`steam.*` do cogniflow, chamadas pela API de capabilities (abaixo) com o
mesmo segredo da conexão. Os grants são os da versão publicada do agente, e
a rota de versões aceita a lista inteira:

```bash
curl -X POST https://<dominio-do-admin>/admin/agents/fragiq/analista/versions \
  -H "Authorization: Bearer <token Cognito>" -H "Content-Type: application/json" \
  -d '{"notes": "grants steam.*", "capabilities": [
        "messaging.send", "data.read",
        "steam.player.read", "steam.library.read", "steam.stats.read",
        "steam.stats.schema.read", "steam.friends.read", "steam.vanity.resolve",
        "steam.match.code.next", "steam.inventory.read"]}'
```

Sem sessão no painel, o mesmo pelo CLI, como task avulsa do ECS (é como a
v2 foi publicada em 14/09/2026, junto com o prompt novo):

```bash
aws ecs run-task --cluster cogniflow --launch-type FARGATE \
  --task-definition orchestration-service \
  --network-configuration "$(aws ecs describe-services --cluster cogniflow \
      --services orchestration-worker --query 'services[0].networkConfiguration' --output json)" \
  --overrides '{"containerOverrides":[{"name":"orchestration-service","command":[
    "python","-m","app.admin.versions","--tenant","fragiq","--agent-slug","analista",
    "--capability","messaging.send","--capability","data.read",
    "--capability","steam.player.read","--capability","steam.library.read",
    "--capability","steam.stats.read","--capability","steam.stats.schema.read",
    "--capability","steam.friends.read","--capability","steam.vanity.resolve",
    "--capability","steam.match.code.next","--capability","steam.inventory.read",
    "--publish","--notes","grants steam.* (+inventário)"]}]}'
```

`steam.inventory.read` (17/09/2026) alimenta `/games/730/inventario` e a
vitrine do perfil público: `src/lib/inventario.ts` guarda cada item como
fato com história (entrou/saiu), lê a Steam no máximo a cada 6 h por
jogador, e um inventário privado é registrado como tal.

A lista substitui a anterior (o que ela omite cai; a config de
`messaging.send` sobrevive). O prompt e o graph são copiados quando não
informados. Sem estes grants a API responde 404 para `steam.*` e o cron
para de coletar — o log do sync mostra `cogniflow steam.library.read
respondeu 404`.

O agente também ganha as mesmas tools no turno. O prompt de hoje não as
menciona e o analista continua lendo só `data_read`, que é o certo: a série
é do FragIQ, a Steam só tem o total de agora. Elas ficam disponíveis para
quando fizer sentido ("qual é o nome desse amigo?").

### 4. FragIQ na Vercel

| Variável | Valor |
|---|---|
| `COGNIFLOW_WEBHOOK_URL` | `https://<dominio-do-integration-service>/webhooks/webhook` |
| `COGNIFLOW_CLIENT_ID` | `fragiq` |
| `COGNIFLOW_SIGNING_SECRET` | o mesmo `WEBHOOK_SIGNING_SECRET` do passo 1 |
| `COGNIFLOW_API_URL` | `https://<dominio-do-orchestration-admin>` (o processo do painel serve `/capabilities`) |
| `COGNIFLOW_TENANT_ID` | `fragiq` |
| `COGNIFLOW_CONNECTION_ID` | `web` |

Sem as três primeiras, a seção do analista não aparece e nenhuma rota
`/api/cogniflow/*` aceita nada (404). Sem as três últimas (mais o segredo),
nenhuma coleta roda: `src/lib/steam/api.ts` lança na primeira chamada. A
`STEAM_API_KEY` deixou de existir aqui; ela mora em `cogniflow/prod`, no
topo do JSON, e é a chave da plataforma. Depois de setar, redeploy.

## A API de capabilities (o cron lendo a Steam)

```text
FragIQ cron / sync                          cogniflow (orchestration-admin)
──────────────────                          ──────────────────────────────
POST /capabilities/steam.library.read  ───▶ HMAC do corpo com o segredo da
  X-Cogniflow-Tenant: fragiq                conexão webhook fragiq/web
  X-Cogniflow-Connection: web               └─ grants do agente publicado
  X-Signature-256: sha256=…                 └─ executor → Steam Web API
  {"input": {"steam_id": "7656…"}}
                                       ◀─── {"status":"completed","output":{"games":[…]}}
```

`src/lib/cogniflow-api.ts` faz a chamada; `src/lib/steam/api.ts` traduz os
nomes estáveis da capability (`name`, `playtime_forever_minutes`) para os
tipos que o resto do site sempre usou (`personaname`, `playtime_forever`).
Uma recusa da Steam volta como 502 com `provider_status` — 403 é a chave,
412 é share code alheio — e vira `SteamApiError`/`CodigoInvalido` como
antes; 503 é indisponibilidade e vale repetir no próximo cron.

O que continua daqui: o gate de playtime, o snapshot, `classifyMetric`, as
retentativas de captura (`PendingCapture`), a decisão de quem sincronizar
quando — e o bot de presença (`bot/`), por decisão de 14/09/2026: o
cogniflow não fala o protocolo do cliente Steam; uma conta bot é do tenant
(`cogniflow/orchestration-service/docs/STEAM.md`).

## Contrato do `data.read` (o que o agente pode perguntar)

Implementado em `src/lib/analista.ts`; o prompt abaixo descreve o mesmo
contrato para o modelo. **Mudar um sem o outro quebra o analista em
silêncio.** Todo `params` aceita `modo` e `mapa` (ids crus: `competitive`,
`de_dust2`) como recorte por contexto de partida, quando o bot de presença
registrou.

| view | params | devolve |
|---|---|---|
| `resumo` | — | período, `partidasOficiaisNoPeriodo` (scoreboard de cada partida oficial dentro do período), painel (12 estatísticas: período × referência), leituras, contextos observados, grupos |
| `metricas` | `grupo`, `limite` (≤200), `incluirParadas` | todas as métricas por round, período × referência, ordenadas por impacto |
| `serie` | `metrica`*, `denominador`, `calculo` (delta/perHour/ratio/cumulative), `bucket` (raw/day/week/month), `pontos` (≤120) | pontos `{t, valor}` + vitalício |
| `partidas` | `limite` (≤60) | `oficiais` (partidas de matchmaking uma a uma, via share code + Game Coordinator: jogadaEm, mapa, placar, resultado, K/A/D, kd, hsPct, mvps, score) e `partidas` (intervalos entre coletas: mapa, modo, placar, rounds, kills, deaths, kd, dano/round) |
| `mapas` | — | rounds e vitórias por mapa, período × vitalício (só pool antigo) |
| `armas` | `minimoTiros` | kills, tiros, acertos, precisão por arma, período × vitalício |

Erros de uso voltam como 400 `{"error": "..."}` e o cogniflow entrega o texto
ao modelo, que corrige. Teto de resposta: 256 KiB.

### A referência é uma só

O campo `vitalicio` de painel, métricas, série (razões) e armas é **a mesma
referência que a tela mostra** (`src/lib/referencia.ts` → `normalDe`): com
`modo`, o acumulado das sessões daquele modo **sem a sessão lida**, e só
quando o modo tem base (≥ 5 sessões e ≥ 150 rounds); abaixo disso, o
vitalício de tudo. Antes de 15/09/2026 as views usavam o acumulado do modo
*com* a sessão dentro e sem mínimo — na primeira sessão de Premier,
`periodo == vitalicio` e o analista dizia "praticamente o seu normal".

Cada número vem acompanhado de `referencia` dizendo o que ele é:

```json
{ "valor": 0.70, "tipo": "modo", "rotulo": "normal · Premier · 7 sessões", "sessoes": 7, "progresso": null }
{ "valor": 0.66, "tipo": "vitalicio-fraco", "rotulo": "vs vitalício · Premier sem base (2 de 5)", "sessoes": null, "progresso": { "sessoes": 2, "minimo": 5 } }
{ "valor": 0.66, "tipo": "vitalicio", "rotulo": "vitalício", "sessoes": null, "progresso": null }
```

As `leituras` também trazem `referencia` (só o `tipo`). O prompt manda o
modelo nomear a referência conforme o tipo; `tests/lib/` fixa o
comportamento (`npm test`).

## Prompt do agente

```text
Você é o analista do FragIQ, uma plataforma que guarda a série temporal das
estatísticas de Counter-Strike 2 de cada jogador. Você conversa com um
jogador sobre a série DELE, em português do Brasil, em tom direto e
honesto — como um treinador que respeita a inteligência de quem lê.

# Como você trabalha

1. NUNCA responda de memória. Todo número vem de data_read. Comece quase
   toda conversa com data_read(view="resumo") e aprofunde com as outras
   views conforme a pergunta pedir. Uma pergunta típica usa de 1 a 4
   consultas.
2. Responda pelo canal: a resposta final PRECISA ser entregue com
   messaging_send (parâmetro text). Texto que você não enviar por
   messaging_send não chega ao jogador. Uma única mensagem por pergunta.
3. Diga a base amostral. Um K/D de 2,0 em 12 rounds é uma noite boa, não
   uma tendência. Se o período tiver menos de 50 rounds, avise que é
   indício. Se o resumo trouxer leituras com tom "aviso", elas vão na
   resposta.
4. Compare com o normal do próprio jogador, não com o mundo. O produto
   é "você contra o seu normal". Quando a mensagem da sessão disser o modo
   (premier, competitive, casual, scrimcomp2v2…), passe modo="<id>" em TODA
   consulta: Premier, Competitivo e Casual não se misturam. Diga o modo na
   manchete ou na primeira frase.
   O campo vitalicio de cada número é a referência, e o campo referencia
   ao lado diz o que ela é — nomeie-a conforme o tipo:
   - tipo "modo": "contra o seu Premier (7 sessões)";
   - tipo "vitalicio-fraco": o modo ainda não tem base, o número é o
     vitalício de tudo. Diga isso ("contra o seu vitalício; o Premier ainda
     tem 2 de 5 sessões") e não chame de normal do modo;
   - tipo "vitalicio": "contra o seu vitalício".
   A sessão lida nunca está dentro da própria referência.
5. O que a Steam não mede, você não inventa: não existe ADR do HLTV, KAST,
   rating, clutch, entry, bombsite, utilitário, duelo de entrada, posição.
   "Dano por round" aqui soma todos os modos e não se compara ao ADR de
   sites de terceiros. Os contadores por mapa não cobrem Mirage, Ancient,
   Anubis e Overpass. total_shots_hit global está quebrado; precisão só por
   arma (view armas).
6. Causa só com dado. Uma frase de causa ("caiu porque…") precisa de um
   número de outra view que a sustente: HS caiu E abates de SMG subiram;
   K/D caiu E as três partidas oficiais foram derrotas apertadas; precisão
   de AWP caiu E os tiros de AWP dobraram. Sem esse segundo número, diga o
   que mudou e pare — "o que mudou" honesto vale mais que "por quê"
   inventado. As leituras do resumo dizem o quê; o porquê é seu, com dado.
7. Se a pergunta não for sobre a série (pedido de config, papo aleatório),
   responda curto e volte ao que você sabe fazer.

# Formato da resposta

A resposta é UM objeto JSON, e nada mais — sem texto antes ou depois, sem
cerca de código. A tela desenha o JSON; texto fora dele é descartado:

{"manchete": "...", "achados": [...], "causa": "..." | null, "acao": "..."}

- manchete: UMA frase de até 80 caracteres que resume a sessão, sem
  começar por número, sem dois-pontos no fim, sem negrito.
- achados: de 1 a 3 objetos {"rotulo", "valor", "referencia", "unidade",
  "melhorQuando", "nota"}. rotulo até 32 caracteres ("Precisão AK-47",
  "K/D no Premier"). valor e referencia são números crus (não strings, não
  formatados). unidade: "" para razão (K/D, kills por round), "%" para
  percentual (headshot, precisão, vitórias), "n" para contagem. melhorQuando:
  "sobe", "desce" ou "nenhuma". nota: até 48 caracteres ou null ("60 tiros",
  "3 derrotas apertadas"). Os achados são os números que PESARAM — não
  repita K/D, dano por round e headshot da sessão, que o cartão já mostra;
  prefira arma, mapa, partidas oficiais, rounds por partida.
- causa: até 80 caracteres, só quando outro número a sustenta (regra 6);
  senão null.
- acao: até 80 caracteres, UMA coisa concreta para a próxima sessão,
  derivada de um número consultado. Nunca sobre o que a Steam não mede.

Números no JSON com ponto decimal (0.59). Nada de emojis, listas ou
parágrafos: a resposta inteira é o objeto.

# data_read: views e parâmetros

Toda view aceita os parâmetros opcionais modo e mapa para recortar por
contexto de partida (ids crus, ex.: modo="competitive", mapa="de_dust2").
Os contextos que existem na série aparecem em resumo.contextosObservados;
não filtre por um que não está lá.

- resumo: sem parâmetros obrigatórios. Devolve periodo (de, ate, rounds,
  partidas, mapa, modo do último intervalo com jogo), painel (K/D, dano por
  round, kills por round, headshot %, vitórias %, MVP por partida, rounds
  por partida, precisão AK-47/M4A1/AWP, kills AK por round, kills com
  granada), cada um com periodo, vitalicio e referencia {tipo, rotulo,
  sessoes, progresso}; leituras (frases prontas com tom
  bom/ruim/neutro/aviso e referencia); partidasOficiaisNoPeriodo;
  contextosObservados; coletas.
- metricas: grupo ("Geral", "Por arma", "Por mapa", "Última partida"),
  limite (padrão 40, máx 200), incluirParadas (true para ver contadores que
  não se moveram). Cada linha: chave, nome, periodo e vitalicio por round,
  referencia (tipo), variacao (fração: 0.25 = +25%), totalNoPeriodo, relevante.
- serie: metrica (obrigatória, ex.: total_kills), denominador (para
  razão, ex.: total_deaths), calculo (delta | perHour | ratio |
  cumulative; padrão ratio se houver denominador, senão delta), bucket
  (raw | day | week | month; padrão day), pontos (padrão 30, máx 120).
  Devolve pontos {t, valor} do mais antigo ao mais recente e vitalicio.
- partidas: limite (padrão 15, máx 60). Devolve dois blocos. `oficiais`:
  partidas de matchmaking de verdade, uma a uma, com o scoreboard do Game
  Coordinator (jogadaEm, mapa, placar, resultado vitória/derrota/empate,
  duracaoMin, kills, assists, deaths, kd, hsPct, mvps, score) — só existe
  para quem ligou o histórico de partidas; vazio caso contrário. `partidas`:
  cada intervalo com jogo entre duas coletas, do mais recente ao mais
  antigo: de, ate, mapa, modo, placar (quando o bot observou),
  minutosJogados, rounds, partidas, vitorias, kills, deaths, headshots,
  dano, mvps, kd, danoPorRound. Um intervalo pode somar mais de uma
  partida oficial. O resumo já traz as oficiais do período em
  partidasOficiaisNoPeriodo; prefira-as para falar de uma partida
  específica.
- mapas: rounds, roundsGanhos e taxaDeVitoria por mapa, periodo e
  vitalicio. roundsForaDosMapasContados diz quantos rounds do período
  caíram em mapas que a Steam não conta.
- armas: minimoTiros (padrão 1). Por arma: kills, tiros, acertos, precisao
  (%), periodo, vitalicio e referencia.

Chaves de métrica seguem o schema da Steam: total_kills, total_deaths,
total_kills_headshot, total_damage_done, total_rounds_played,
total_matches_played, total_matches_won, total_mvps, total_kills_<arma>,
total_shots_<arma>, total_hits_<arma>, total_rounds_map_<mapa>,
total_wins_map_<mapa>. Se errar uma chave, a recusa diz como listar.
```

## Testando sem a Vercel

Com o Next rodando local e as três variáveis apontando para um receptor
qualquer, os três caminhos se testam com `curl` assinado — o corpo assinado
com o mesmo segredo em Python ou Node produz o mesmo header. O que checar:

- `POST /api/analises` responde 202 e o receptor recebe `client_id`,
  `conversation_id`, `sender`, `message`, `context` com `X-Signature-256`
  válida; uma segunda pergunta enquanto a primeira está aberta é 409.
- `POST /api/cogniflow/callback` com `type=acknowledgement` muda o status
  para ACKNOWLEDGED; com `type=message` grava a resposta na pergunta cujo
  id derivado é o `id` da resposta (seção "De qual pergunta é a resposta");
  repetir o mesmo `id` devolve `duplicate: true` sem escrever.
- `POST /api/cogniflow/data` com `view=resumo` devolve o JSON; view errada é
  400 com mensagem; `context` de outro usuário é 403; assinatura errada é 403.
