# Indicadores e manifesto para o painel da Build Labs

O FragIQ aparece no painel da empresa (https://painel.buildlabs.com.br) por
duas peças, as duas do contrato do projeto `painel`
(`docs/contratos/manifesto-e-indicadores.md`, decisão na ADR 0006 da empresa):

1. **`buildlabs.json`** na raiz: links, saúde, publicação e onde ficam os
   indicadores. O painel lê pelo GitHub a cada coleta (30 min). A chave
   `local` não existe aqui; os comandos do `bl` ficam em `bl.json`.
2. **`GET /api/buildlabs/indicadores`**: números agregados do produto e da
   integridade dos dados, que o painel chama no máximo a cada 60 min (`intervaloMinutos` do manifesto: o Neon está acima da cota de CU-h e cada chamada pode acordá-lo).

O contrato vive no `painel`; este repositório não o copia. O teste
`tests/lib/indicadores-painel.test.ts` replica o esquema zod só para provar
que a resposta cabe nele.

## O endpoint

- Código: `src/app/api/buildlabs/indicadores/route.ts`, regras em
  `src/lib/indicadores-painel.ts` (sem banco, fontes injetadas) e consultas em
  `src/lib/indicadores-fonte.ts`.
- **Autenticação**: `Authorization: Bearer <token>`. O token é o do SSM
  SecureString `/infra-compartilhada/prod/indicadores-token` (um só para todos
  os projetos). A Lambda do site recebe só o **nome** em
  `PARAMETRO_INDICADORES` e lê o valor em tempo de execução com a própria role
  (`src/lib/indicadores-token.ts`, guardado 10 min na memória). Em dev vale
  `INDICADORES_TOKEN` no ambiente. Comparação em tempo constante (hash
  SHA-256 dos dois lados + `timingSafeEqual`).
  - sem token configurado (ou o SSM negou a leitura): **503**;
  - token ausente ou errado: **401**;
  - certo: **200** com `Cache-Control: no-store`.
- **Permissão**: a pilha `Fragiq-Prod` (`infra/lib/site-stack.ts`) dá à role da
  Lambda do site `ssm:GetParameter` no nome exato do token (ADR 0005, nunca o
  prefixo). Só o site: a agenda e as migrações não leem. Entra com o
  `bl publicar` (mudança de IAM sem custo).
- **Só leitura e só agregados**: contagens e idades. Nada de SteamID, nome,
  e-mail, ID de jogador nem texto. As fontes (`FontesDeIndicadores`) nem
  devolvem linhas. Um teste varre a resposta atrás de SteamID, `@` e cuid.
- **Fonte que falha** (banco dormindo, limite de 9 s, contagem inválida)
  vira `valor: null` com o motivo em `detalhe`, só nos indicadores daquela
  fonte. O erro bruto vai para o log da Lambda, nunca para a resposta.
- **Custo**: Cerca de 20 consultas pequenas por chamada, em paralelo (o Neon já está acordado nos
  turnos de :00 e :30 do bot e da checagem de saúde). Tabelas na casa de
  milhares de linhas; as janelas usam os índices existentes onde há.

## Os indicadores

Os níveis são decisão do FragIQ: `atencao` e `critico` entram em "Precisa de
atenção" no painel. As pendências usam a **mesma regra e os mesmos prazos** dos
alarmes da AWS (`src/lib/saude-dos-dados.ts`), então o painel e o SNS contam
igual. As métricas `FragIQ/*` do CloudWatch são emitidas a partir dessa mesma
medição (EMF no stdout de `/api/cron/saude`); o endpoint lê o banco direto e
não chama a API do CloudWatch, o que dispensa permissão a mais na role.

| id | O que conta | Nível |
|---|---|---|
| `partidas_sem_sessao` | Partidas do GC (DONE, jogador do site) terminadas há mais de 24 h que nenhuma sessão do jogador contém. Cada partida conta uma vez | `critico` se > 0 |
| `analises_sem_resposta` | Análises (cogniflow) em PENDING/ACKNOWLEDGED há mais de 30 min | `atencao` se > 0 |
| `capturas_vencidas` | `pending_captures` com `proximaEm` há mais de 1 h (tick do bot ou cron parado) | `critico` se > 0 |
| `bot_ultimo_tick_min` | Minutos desde `bot_status.ultimoTickEm`; o estado vem de `estadoDoBot` (repouso de 30 min é normal) | `critico` parado; `atencao` deslogado ou nunca; senão `ok` |
| `coleta_diaria_idade_h` | Horas desde o último `cron_runs` (mesmo limite do `/api/health`: 26 h) | `critico` acima de 26 h; `null` sem nenhuma |
| `sessoes_regra_atrasada` | Sessões com `regraVersao` diferente de `REGRA_VERSAO`. `npm run recompute:sessions` refaz | `atencao` se > 0 |
| `insights_regra_atrasada` | Insights de regras em vigor com versão diferente da atual (`REGRAS_EM_VIGOR`) | `atencao` se > 0 |
| `sessoes_partida_inexistente` | Itens de `sessions.matchIds` (30 dias) sem a partida em `matches`: a prova da sessão aponta para o vazio | `critico` se > 0 |
| `observacoes_sem_ponto` | `bot_observations` MATCH_ENDED (1 a 7 dias, jogador do site) sem `stat_snapshots` com o mesmo `traceId` | `info`: a captura desiste de propósito (detalhes do jogo privados), e o efeito no jogador já é `partidas_sem_sessao` |
| `bot_erros_24h` | `bot_logs` ERROR nas últimas 24 h | `ok` em 0, `atencao` a partir de 10, senão `info` |
| `mensagens_steam_falhas_24h` | `steam_messages` FAILED nas últimas 24 h | `ok` em 0, `atencao` a partir de 5, senão `info` |
| `partidas_gc_pendentes` | `matches` em PENDING há mais de 24 h (o bot não buscou o scoreboard) | `atencao` se > 0 |
| `usuarios_total` | Jogadores cadastrados (detalhe: novos em 7 dias) | `info` |
| `snapshots_24h`, `partidas_24h`, `sessoes_24h` | Pontos da série, partidas DONE e sessões criados nas últimas 24 h | `info` |

`avisos[]` leva só o que tem um "desde" claro: bot parado ou deslogado e
coleta diária parada.

Mudou o significado de um indicador? Troque o `id` (o painel guarda o "desde"
de cada alerta por ele). Indicador novo: uma fonte em `FontesDeIndicadores`,
os níveis em `indicadores-painel.ts`, uma linha na tabela acima e o teste.

## Como verificar

- `npm test` (`tests/lib/indicadores-*.test.ts`, `tests/app/indicadores-rota.test.ts`)
  e `npm run verificar` em `infra/` (a role só lê o parâmetro por nome exato).
- Em produção: `curl -i https://fragiq.buildlabs.com.br/api/buildlabs/indicadores`
  sem token deve dar **401** (503 significa token não lido: confira a permissão
  da role e o parâmetro). Com o token, quem chama é o painel; o botão
  "Atualizar" dele força uma coleta.
