# Bot de presença

Processo separado que fica online na Steam como amigo dos usuários e avisa a
aplicação quando alguém termina de jogar CS2.

## Por que existe

A coleta agendada roda uma vez por dia e captura o que houver. Se a pessoa
jogou cinco partidas entre duas execuções, a série ganha um ponto só — a
diferença agregada, não a evolução dentro da sessão.

O bot troca isso por coleta reativa: percebe o fim de cada partida — o rich
presence perde o mapa quando a pessoa volta ao lobby, ou ela fecha o jogo —
e avisa a aplicação naquele momento. Como as estatísticas do CS2 são gravadas
ao fim da partida, isso rende um ponto por partida sem o usuário clicar em
nada.

Como efeito colateral, a amizade também destrava perfis marcados como
"somente amigos" — a Web API respeita a privacidade em relação ao dono da
chave, e é a maior causa de dashboard vazio.

## O bot é um sensor; a memória é do site

O aviso (`POST /api/sync/steam-event`) só grava um pedido de coleta, com o
mapa, modo e placar observados. A Steam demora a publicar (medido: mais de
5 min depois de sair do jogo), então o site espera 90 s e tenta; se as stats
vieram iguais, tenta de novo em 2, 4, 8 e 16 min; depois desiste — e, se a
pessoa nunca teve um ponto, avisa no chat que os "Detalhes do jogo" estão
privados. Tudo isso vive na tabela `pending_captures`. O bot só chama
`GET /api/bot/tick` a cada 30 s (`BOT_TICK_MS`) para o site processar o que
venceu: reiniciar o bot não perde nada, e o cron processa o mesmo balde.

Além do tick, o bot busca duas filas do site: mensagens de chat
(`/api/bot/outbox`) e share codes para perguntar ao Game Coordinator
(`/api/bot/partidas`).

## Ficar logado é política do bot, não da biblioteca

`src/conexao.ts` supervisiona a sessão: o cliente nasce com
`autoRelogin: false`, toda queda (`error` ou `disconnected`) agenda uma nova
tentativa com espera crescente (30 s → 10 min; 30 min se a Steam pediu
calma), e um vigia confere a cada minuto que existe sessão. Só dois casos
encerram o processo, e nos dois o Docker recria o container: credencial
que a Steam não aceita mais (`InvalidPassword`, `AccessDenied`, `Expired`…
— aí é preciso gerar um refresh token novo, como no primeiro login) e uma
hora inteira sem conseguir voltar.

O heartbeat (`POST /api/bot/tick`) bate mesmo sem sessão, com `logado`,
`desconectadoDesde` e `motivo`: no painel `/admin`, "parado" é processo
morto e "deslogado" é processo vivo esperando a Steam. Antes disso, um
`LogonSessionReplaced` (alguém entrou na conta do bot em outro lugar)
deixava o bot vivo, mudo e sem ninguém saber por quê — foi o que aconteceu
de 15/09 a 16/09/2026.

## Preços do Mercado

`src/precos.ts`: a Steam responde 429 ao `priceoverview` para o IP da
plataforma (ECS) e 200 para este host, então quem lê o Mercado é o bot. O
site entrega a fila de nomes vencidos em `GET /api/bot/precos` (≤ 10 por
rodada, 24 h de validade; 7 dias para item fora do mercado), o bot lê um
por vez com 4 s de espaço e devolve em `POST /api/bot/precos`. Um 429
encerra a rodada e dobra a espera até a próxima (máx. 30 min).

## Demos

`src/demos.ts` + `src/demo-parse.ts`: cada partida que o GC respondeu tem
uma URL de demo (~100 MB, some em ~30 dias). A cada 5 min o bot pergunta
ao site (`GET /api/bot/demos`) qual falta, baixa para `/tmp/fragiq-demos`,
descomprime (`bzip2` do sistema — a imagem instala; JS como reserva) e
roda o parser (`@laihoe/demoparser2`) **num processo filho**: a demo
inteira fica em memória (~250 MB para 8 rounds, estimados ~400 MB para
24) e, se a instância não aguentar, morre o filho e a partida fica
`FAILED` com o motivo — a conexão com a Steam não cai. O resultado vai
gzipado em `POST /api/bot/demos` (`FRAGIQ_DEMOS_URL` sobrescreve). O que
sai, o que vira métrica e as medições: `docs/demos.md`.

O mesmo commit passou a mandar a resposta do GC inteira (`gc`) e os pings
no `POST /api/bot/partidas`: o site guarda o fato, não só o placar.

## O log vai para o painel

`src/logs.ts` captura tudo o que passa por `console.*`, enfileira e envia
em lotes para `POST /api/bot/logs` (10 s ou 50 linhas; `FRAGIQ_LOGS_URL`
sobrescreve a URL, que deriva do webhook). O `/admin` mostra os últimos
logs na seção **Bot**, com nível, jogador e trace. Cada aviso de fim de
partida nasce com um `traceId` que vai no corpo do webhook; o site grava
a observação (`bot_observations`) e a captura com ele, e o ponto que a
coleta criar carrega o mesmo id — do "o bot viu" ao número na tela
(`docs/dados-confiaveis.md` §3.4). `docker logs` continua funcionando; é
o caminho de emergência.

## Por que não roda na Vercel

Um cliente Steam mantém conexão TCP persistente. Serverless não comporta.
Precisa de um host sempre ligado: Railway, Fly.io ou um VPS pequeno.

## Onde roda

No **host compartilhado da Build Labs** (conta 576951332499, us-east-2): a
instância `infra-compartilhada-host`, uma t4g.small (ARM) da pilha
`InfraCompartilhada-Host` do repositório `Build-Labs-Group/infra-compartilhada`
(`docs/host-compartilhado.md` lá). O bot é o container `fragiq-bot`
(`compose.yaml`, 900 MB de limite). A migração da EC2 antiga está em
`docs/migracao-bot-build-labs.md`.

- **Acesso:** sem SSH e sem porta aberta. Shell pelo Session Manager:
  `aws ssm start-session --target <InstanciaId> --profile buildlabs --region us-east-2`.
  Comando avulso: `aws ssm send-command ... --document-name AWS-RunShellScript`.
- **Segredos:** não há `.env` no servidor. O refresh token e o segredo do
  webhook vivem no Parameter Store, `SecureString` **`/fragiq/prod/bot`**
  (JSON com as mesmas chaves das variáveis). A role do host só lê e grava esse
  parâmetro (do fragiq). O bot lê no boot e grava de volta quando o steam-user
  renova o token. `FRAGIQ_SECRET_ID` (Secrets Manager da conta pessoal) ainda
  funciona, para a volta.
- **Variáveis não sensíveis:** `producao.env`, no git.
- **Publicar:** `./deploy.sh` (perfil `buildlabs`) empacota esta pasta, sobe
  no bucket de deploy e roda o `run.sh` no host pelo `aws ssm send-command`.
  Ele reconstrói a imagem e só recria o container se o bot já estava rodando:
  `INICIAR=1 ./deploy.sh` liga um bot parado. **Nunca dois bots logados na
  mesma conta** (`LogonSessionReplaced`).
- **Trocar um valor do segredo:** grave o JSON inteiro de um arquivo temporário
  (`aws ssm put-parameter --name /fragiq/prod/bot --type SecureString --overwrite
  --value file://...`), apague o arquivo e `docker restart fragiq-bot` no host.
- **Logs:** no `/admin`; no host, `docker logs -f fragiq-bot`.
- **IP:** o Mercado da Steam é lido pelo IPv4 público do host. Parar e ligar
  a instância troca o IP; teste o `priceoverview` depois.

## Primeiro login

A conta precisa ser **dedicada**. Ela ficará amiga de desconhecidos, e um
comprometimento numa conta pessoal levaria inventário e trades junto.

```bash
cp .env.example .env      # preencha ACCOUNT e PASSWORD
npm install
npm start                 # confirme o Steam Guard quando pedir
```

O steam-user imprime um refresh token. Guarde-o em
`STEAM_BOT_REFRESH_TOKEN`, apague `STEAM_BOT_PASSWORD` e reinicie — daí em
diante ele reconecta sozinho.

## Limite de amigos

O teto é 250 mais 5 por nível da conta — uma conta nova para em torno de 300,
não em 1.000 como se costuma dizer. Medido: a conta recém-criada mostrava
"1 / 300".

Isso antecipa o momento de precisar de um segundo bot. Subir o nível custa
dinheiro (é preciso comprar itens ou jogos), então na prática o caminho é
sharding: várias contas, cada uma responsável por uma faixa de SteamID.

## Experimento pendente

```bash
npm run probe -- <SteamID64>
```

Com o alvo **dentro de uma partida**, imprime os campos de rich presence que
o CS2 publica e responde se o mapa está entre eles. Se estiver, dá para
rastrear mapa sem parsear demo — o que contornaria a ausência de Mirage,
Ancient, Anubis e Overpass nos contadores da Steam.

## Mensagens no chat

O site enfileira a análise de cada sessão em `GET /api/bot/outbox` (mesmo
Bearer do webhook). O bot busca a cada 20 s (`BOT_OUTBOX_POLL_MS`), entrega
por `client.chat.sendFriendMessage` a quem é amigo e confirma em
`POST /api/bot/outbox` com `SENT` ou `FAILED`. Quem não é amigo não recebe
— o chat da Steam só existe entre amigos. `FRAGIQ_OUTBOX_URL` sobrescreve a
URL, que por padrão deriva de `FRAGIQ_WEBHOOK_URL`.
