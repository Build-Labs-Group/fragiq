# FragIQ — design da área do jogo

O que a área do jogo (`/games/[appId]`) é hoje: as regras que valem para
todas as telas, as peças que as implementam e onde cada peça mora. Descreve
o sistema no código; o que ainda não existe está no backlog da rotina
(`holding/backlog/fragiq.md`, fora deste repositório), não aqui.

Identidade (escuro, laranja, números em mono, rótulos HUD) vem de
`src/app/globals.css` e não é assunto deste documento — o que é assunto é
o que cada tela diz, em que ordem, e contra o quê cada número é lido.

Vocabulário, usado com este sentido no código e nas telas:

- **coleta** — um snapshot dos contadores vitalícios da Steam (`StatSnapshot`).
- **sessão** — o intervalo entre duas coletas em que `total_rounds_played`
  subiu. É a unidade do produto: um ponto de gráfico, uma linha de tabela,
  uma análise.
- **normal** — a referência contra a qual uma sessão é lida.
- **lente** — o modo de jogo aplicado como destaque, nunca como corte.

---

## 1. Princípios

São as cinco regras das quais o resto decorre. Quando uma tela nova
contradiz alguma, é a tela que está errada.

1. **Um número, um lugar.** Cada valor aparece grande uma vez por tela; nas
   outras vezes é referência pequena ou não aparece.
2. **A série é inteira; o modo é uma lente.** Nenhum gráfico perde pontos
   por causa do modo — o modo destaca, escolhe a última sessão e a
   referência, e diz quantas sessões cobre.
3. **Referência honesta ou nenhuma.** O normal nunca inclui a sessão que
   está sendo lida e nunca tem menos de N sessões; sem isso o chip some e a
   linha de referência diz por quê. `0%` por falta de base não é impresso.
4. **Escassez declarada.** Todo gráfico diz quantos pontos tem e desde
   quando; abaixo do mínimo mostra pontos em vez de linha; um bloco vazio
   sempre nomeia o que falta e o próximo passo.
5. **Rótulo antes de frase.** Copy curto, baseado em rótulo, número e data
   formatados por locale; se um bloco precisa de um parágrafo para ser
   entendido, o bloco está errado.

---

## 2. Sistema

### 2.1 Tokens

**Cores** (`globals.css`, `:root` e `@theme inline`):

| Token | Valor | Papel |
|---|---|---|
| `--accent` | `#ff6b3d` | marca, aba ativa, lente ativa, linha do gráfico, ação. Medido 6,2:1 sobre `--surface` |
| `--good` / `--good-soft` | `#4fd1a5` / `#0f2b22` | movimento bom para a estatística. Mint frio, para não se confundir com a marca; 8,9:1 sobre `--surface` |
| `--bad` / `--bad-soft` | `var(--danger)` / `#331a17` | movimento ruim |
| `--neutral` | `var(--ink-muted)` | sem valência, ou diferença dentro do ruído |
| `--warn` | `#e8c25a` | nota que qualifica a leitura (amostra curta) |
| `--surface` / `--surface-2` | `#13161a` / `#1a1e24` | cartão / bloco interno |
| `--line` / `--line-soft` | `#262b32` / `#1e2228` | anel de cartão / divisória de tabela |

Contraste: todo token de texto (`--ink`, `--ink-muted`, `--ink-faint`,
`--accent`) tem pelo menos 4,5:1 sobre `--canvas`, `--surface`,
`--surface-2` e `--accent-soft`, nos dois temas — inclusive o `--ink-faint`
dos rótulos `.hud` de 11px. `tests/app/contraste-tokens.test.ts` faz a conta
do WCAG em cima de `globals.css` e quebra se um token novo não alcançar.

Regra dura: **`--accent` nunca codifica valência.** Subiu/caiu é
`--good`/`--bad`; laranja é "olhe aqui", não "bom".

**Classes utilitárias** (as únicas fora do Tailwind):

| Classe | O que é |
|---|---|
| `.hud` | 11px mono, caixa alta, tracking `0.12em`, `--ink-faint`. Rótulo de cartão, cabeçalho de tabela, título de seção |
| `.num` | mono, tabular, tracking `-0.02em`. Todo número grande |
| `.tnum` | só `tabular-nums`. Números em texto corrido e em células |
| `.glow` | anel + brilho do acento. **Um por tela**: é o hero |
| `.grid-bg` | malha discreta atrás do hero |
| `.tracar` | a linha do gráfico se desenhando. Só no gráfico grande sem lente; nos tiles foi removida (doze animações simultâneas eram ruído) |
| `.serie .ponto` | hover/foco de um ponto do gráfico grande, em CSS puro (2.4) |

**Direção de cada estatística.** Cada `PanelStat` declara `melhorQuando:
"sobe" | "desce" | "nenhuma"` (`src/lib/cs2-panel.ts`). `nenhuma` (hoje:
rounds por partida) pinta o chip em `--neutral` com sinal, sem verde nem
vermelho. Nenhum componente adivinha a direção.

### 2.2 O motor: série, normal, delta, domínio

Cinco módulos, cada um com uma responsabilidade única. Nenhum componente
recalcula o que eles fazem.

| Módulo | Responde |
|---|---|
| `src/lib/series.ts` | o que é uma sessão, a série de uma estatística, o normal |
| `src/lib/referencia.ts` | o normal com a amostra padrão, e como nomeá-lo numa frase |
| `src/lib/delta.ts` | a distância entre um valor e o normal, julgada |
| `src/lib/dominio.ts` | o eixo vertical de um gráfico, sem outlier mandando |
| `src/lib/formato.ts` | todo número e toda data, por locale |

**As doze estatísticas** (`cs2-panel.ts`) são todas razões entre dois
contadores, de propósito: razão é o único modo que se compara com o
vitalício de forma honesta. Cada uma declara `decimals`, `unit`,
`melhorQuando`, `amostra` (`rounds`, mínimo 10 — ou `partidas`, mínimo 3) e,
quando é taxa por partida, `movel: 5`.

**A série** (`serieDeSessoes`) é uma sessão por ponto, sem recorte. Um
`PontoSerie` carrega `valor`, `rounds`, `partidas`, `modo`, `sessaoId` e
`fraco` — o que a interface precisa para julgar o ponto sem recalcular nada.
`fraco` é `amostra < stat.amostra.minimo`. Stats com `movel` usam a razão
móvel das últimas 5 sessões (soma dos deltas, não média das razões), porque
uma sessão de duas partidas só sabe dizer 0, 50 ou 100.

**O normal** (`normalDe`) tem quatro resultados, e o tipo faz parte da
resposta para que nenhum texto chame de "vitalício" o que é o acumulado do
modo:

```
NORMAL_MIN_SESSOES = 5   NORMAL_MIN_ROUNDS = 150

sem lente            → vitalicio        rótulo "vitalício"
lente com base       → modo             rótulo "normal · Premier · 8 sessões"
lente sem base       → vitalicio-fraco  rótulo "vs vitalício · Premier sem base (2 de 5)"
sem vitalício/sessões→ nenhum           motivo "sem-vitalicio" | "sem-sessoes"
```

A base do normal do modo são as sessões **fortes** daquele modo,
**excluindo a sessão lida** (`sessaoId`) — sem isso uma sessão sozinha vira
o próprio normal e o delta é zero por construção. Abaixo do mínimo volta ao
vitalício com o rótulo dizendo quantas sessões faltam: comparar é a promessa
do produto, e o vitalício existe desde a primeira coleta; fingir que ele é o
normal do Premier é que não pode.

`referencia.ts` é a porta para quem não tem um `PanelStat` em mãos (as
leituras, as views do analista): `referenciaDe` aplica a mesma regra com a
amostra padrão de 10 rounds, e `nomeDaReferencia` devolve o nome dentro de
uma frase ("do seu Premier (7 sessões)", "de vitalício").

**O delta** (`calcularDelta`) é um cálculo só, para o hero, o cartão e a
página da estatística — e, dentro das regras de `insights/`, para os chips
que a tabela de sessões passou a ler prontos (§4.3):

- estatísticas com `unit: "%"` comparam em **pontos percentuais**
  (`▲ 17 pp`), as outras em **razão relativa** (`▼ 19%`);
- limiar de ruído: `< 3 %` ou `< 1 pp` → `direcao: "igual"`, chip `≈` sem
  cor;
- `valencia = direcao × melhorQuando`;
- amostra pequena não muda o número, muda a confiança: `fraco: true`
  (herdado também de um normal `vitalicio-fraco`);
- sem base não há delta: `{ estado: "sem-base", motivo }`, e quem explica é
  a linha de referência do cartão.

**O domínio** (`dominioRobusto`) sai da mediana e do desvio absoluto mediano
dos pontos fortes: o que estiver a mais de 3 MAD é grampeado na borda e
desenhado com marcador — mostrado, nunca omitido. O normal entra no domínio
sempre, porque a altura de um ponto significa "acima ou abaixo do seu
normal" e essa leitura exige a baseline dentro do quadro. Com menos de 3
pontos não há recorte. Stats em `%` ficam presas a `[0, 100]`.

**A formatação** (`formato.ts`) é a única que chama `toLocaleString`:
`formatarStat` usa as casas e a unidade que a estatística declara,
`formatarQuando`/`formatarDia`/`formatarDuracao` cuidam de tempo.
`getLocale()` devolve `pt-BR`/`America/Sao_Paulo` hoje; é a única função que
muda quando a internacionalização entrar.

### 2.3 O cartão de estatística

`src/components/stat-card.tsx` — o mesmo cartão no Resumo, em Estatísticas e
no topo de `painel/[key]`. Não calcula nada: recebe a série, o ponto lido, o
normal e a lente, e mostra. Seis zonas, nesta ordem:

```
┌─────────────────────────────────────────────┐
│ K/D                              ● Premier  │  1 rótulo (hud) + chip da lente
│ 0,57  ▼ 19%                                 │  2 número (num 3xl) + chip de delta
│ normal 0,70 · 22 sessões                    │  3 linha de referência
│ ┄┄┄┄┄┄┄┄┄●┄┄┄┄┄┄┄┄○┄┄┄┄┄┄●┄┄┄┄┄┄┄┄┄┄┄┄┄┄●   │  4 sparkline (h-10)
│ 11 sessões · desde 03 set                ↗  │  5 rodapé: cobertura + seta
└─────────────────────────────────────────────┘
```

- **Número**: `atual.valor` — a última sessão da lente, ou a última de
  qualquer modo. Sem sessão nenhuma, cai no valor do normal e o rodapé passa
  a ser a explicação (`só vitalício · jogue uma partida`).
- **Referência**: uma linha, sempre. `normal 0,70 · 8 sessões` /
  `vitalício 0,70` / `vs vitalício 0,70 · 2 de 5 sessões` / `sem base`. É a
  única linha que explica o chip; nunca mais de uma.
- **Rodapé**: `{n} sessões · desde {dia}`, mais `· média móvel · 5` quando a
  estatística é por partida. `sem uso no período` quando a série é vazia.
- O cartão inteiro é `<a>` para `painel/[key]`, preservando a lente em
  `?modo=`.

`stat-panel.tsx` é a grade: para cada estatística calcula a série inteira
(nunca recortada pela lente), o ponto lido e o normal; descarta as que não
têm nem ponto nem normal; corta em `limite` (6 no Resumo, todas em
Estatísticas). Grade de 3 colunas em `lg`, 2 em `sm`, 1 abaixo.

### 2.4 Gráficos

SVG à mão, renderizados no servidor, sem biblioteca. Recharts está no
`package.json` e não é usado em `src/`; hover e seleção são CSS
(`:hover`/`:focus-visible` em `<g tabindex="0">`), o que funciona no toque e
no teclado sem JavaScript.

A entrada dos dois é `PontoSerie[]` — não `number[]`. Sem amostra não dá
para marcar um ponto como fraco; sem modo não dá para a lente destacá-lo;
sem o id da coleta não dá para excluir a própria sessão do normal.
`pontosSimples` e `pontosDeSerie` adaptam séries sem sessão por trás
(métricas cruas, demonstrações).

**`sparkline.tsx`** — a linha de dentro do cartão, 240×40.

| Pontos | Desenho |
|---|---|
| 0 | baseline tracejada + `sem sessões` centralizado |
| 1–2 | os pontos, cheios, sobre a baseline |
| ≥ 3 | linha, com o último ponto marcado |

Ponto fraco sai vazado em `--ink-faint` com opacidade 0,7. Ponto fora do
domínio vira um traço vertical curto na borda (o viewBox é esticado só na
horizontal, então um triângulo sairia deformado; o traço, medido em pixels
de tela, não). A baseline é o normal, tracejada `4 4`. Sem tooltip: o tile é
resumo.

**`serie-chart.tsx`** — o gráfico de página inteira, 720×280. Tudo do
sparkline, mais:

- eixo Y com quatro marcas em números redondos (`escalaY`), rotuladas pelo
  `formatar` da estatística;
- eixo do tempo: primeiro e último instante, mais uma marca por semana
  quando o intervalo passa de 14 dias;
- baseline com rótulo na ponta direita (`normal 0,70` / `vitalício 0,70`);
- ponto fora do domínio vira triângulo `▲`/`▼` com o valor real e a amostra
  ao lado (`6,30 ▲ · 7 r`);
- rótulo permanente em até 8 pontos; acima disso, só o primeiro, o último e
  os dois extremos;
- cada ponto é `<g tabindex="0">` com uma guia vertical e a legenda
  `valor · quando · modo · amostra`, reveladas no hover e no foco.

**A lente no gráfico**: a linha inteira vai para `--line` (cinza) e os
pontos do modo ficam cheios em `--accent`, raio 4; os demais, raio 2,5 em
`--ink-faint`. Não se desenha uma segunda linha ligando só os pontos do
modo — ligaria sessões com semanas de buraco entre elas.

### 2.5 O chip de delta

`src/components/delta-chip.tsx`, um para o site inteiro. `▲ 19%` /
`▼ 17 pp` / `≈`. O ícone é o sinal, então não se repete `+`/`−`. A cor é a
valência: `text-good` sobre `bg-good-soft`, `text-bad` sobre `bg-bad-soft`,
`text-neutral` sem fundo. `fraco` tira o fundo e pontilha a borda — o número
fica, a confiança não. `estado: "sem-base"` não renderiza nada.

### 2.6 Estados vazios e escassos

`src/components/estado.tsx`: título em hud (≤ 5 palavras), uma linha de
texto opcional, uma ação opcional (link interno ou externo). Substituiu as
sete caixas tracejadas que cada página escrevia à sua maneira. Onde aparece:

| Situação | Onde | Texto |
|---|---|---|
| lente sem sessões | Resumo | `Sem sessões de Premier` / `A próxima partida nesse modo aparece aqui.` / `Ver tudo` |
| 1 coleta | Resumo | `Primeira coleta gravada` / `A próxima partida vira a primeira sessão.` |
| nenhum cartão possível | Estatísticas | `Sem estatísticas ainda` / `A primeira coleta com partidas preenche este painel.` |
| série vazia | `painel/[key]` | `Sem sessões` / `A primeira partida depois de duas coletas vira o primeiro ponto.` |
| sem sessão | Sessões | `Nenhuma sessão ainda` / `É preciso duas coletas com partidas entre elas.` |
| lista vazia na lente | Partidas | `Nenhuma partida em Premier` / `Partidas sem modo conhecido ficam em Tudo.` / `Ver todas` |
| `last_match_*` congelado | Métricas | grupo colapsado: `▸ 19 contadores de última partida congelados pela Valve` |

Estados que não passam por `Estado` porque são outra coisa: a página inteira
sem estatísticas públicas na Steam (`sem-dados.tsx`, bloqueante) e o cartão
do analista (5).

### 2.7 Skeletons

Só onde há busca no cliente: o corpo do cartão do analista, que consulta
`/api/analises` a cada 2,5 s enquanto houver análise em aberto. Uma barra
`h-6 w-1/2` no lugar da manchete e três `h-3` (`w-4/5`, `w-full`, `w-2/3`)
em `bg-surface-2 animate-pulse`. O cabeçalho do cartão vem do servidor e não
tem skeleton.

Desde 29/09 as telas do servidor também têm, pelos `loading.tsx` do App
Router: `app/loading.tsx` (qualquer página, com a forma do cabeçalho do
site), `games/[appId]/loading.tsx` (a forma do Resumo, dentro do layout —
cabeçalho do jogo e abas continuam clicáveis), `sessoes/` e `partidas/`
(forma de lista) e `partida/[id]/` (placar, faixa e times). As peças moram
em `components/esqueleto.tsx` e usam `.esqueleto` (brilho lento, sem
número nem texto inventado). A regra é a da geometria: o esqueleto tem a
forma do bloco real, para que a troca não mova nada.

Erros do servidor caem em `error.tsx` (`components/falha.tsx`): uma linha,
**Tentar de novo** (refaz só o trecho) e o `digest` que aparece nos logs do
servidor (CloudWatch da Lambda `fragiq-site`). Dentro do jogo o erro fica
no lugar do conteúdo, com as abas vivas.

### 2.8 Movimento

Três animações, todas desligadas por `prefers-reduced-motion`:
`.tracar` (2.1), `.entrar` — blocos sobem e acendem em cascata, 45 ms entre
um e outro pela variável `--i` (hero, cartões, atividade, painel de
partidas) — e `.crescer`, barras que sobem do eixo. Nada anima em loop além
do esqueleto; número nenhum "conta" até o valor, porque um número que muda
enquanto se lê é um número em que não se confia.

---

## 3. O modo de jogo é uma lente

`src/lib/modo.ts` — o modo é **global** (URL `?modo=`, com o cookie
`fragiq_modo` como memória; a URL vence, porque é o que torna o link
compartilhável). Um modo que não existe na série cai para `tudo` em vez de
mostrar uma página vazia. Só modos com ao menos uma sessão viram opção
(`abasDeModo`).

O contrato tem dois lados, e a diferença entre eles é o ponto:

- **Listas** (Sessões, Partidas, Análises) são naturalmente filtráveis. Em
  Sessões a lente não esconde: as linhas fora do modo ficam na tabela em
  `ink-faint` e um rótulo diz `2 de 7 sessões em Competitivo` — sete linhas
  cabem na tela, esconder cinco não ajuda ninguém. E a lente não muda mais o
  **número** de nenhuma linha: o chip de K/D é o insight materializado da
  sessão (§4.3), a mesma leitura em qualquer aba. Em Partidas e Análises a
  lente filtra de verdade, com o estado vazio nomeando o corte.
- **Números e gráficos** nunca perdem pontos. Com lente ativa, um
  cartão/hero/gráfico mostra a série inteira com os pontos do modo em
  destaque, usa como número grande a última sessão **do modo**, usa como
  normal a regra de 2.2, diz no chip do cartão de que modo é o número e no
  rodapé quantas sessões existem.

**Apresentação** (`nav-jogo.tsx`): as abas à esquerda e o controle
segmentado `MODO` à direita, na mesma linha — não é navegação, é um recorte
que vale para todas as abas. Sem contagens nas opções (um "Premier 1" é
convite a tela vazia); a contagem vive na linha de cobertura logo abaixo,
`3 de 7 sessões com modo · Adicionar o bot`, que some quando toda sessão tem
modo. Sem nenhum modo marcado, o controle não aparece.

**Por modo** (`por-modo.tsx`): no Resumo, os modos lado a lado — uma linha
por modo com sessões, K/D, dano por round, headshot e a última data, mais a
linha `○ sem modo` e a do vitalício para ancorar. É onde "não misturar
Premier com casual" acontece sem esvaziar nada. Linha com menos de
`NORMAL_MIN_SESSOES` fica apagada e mostra o progresso (`2/5`); clicar na
linha ativa a lente. Só aparece com dois modos ou mais: com um, seria uma
tabela de uma linha repetindo o hero.

---

## 4. Páginas

Ordem de leitura comum: **contexto → número → referência → gráfico → o que
falta**. Largura `max-w-6xl`.

### 4.1 Resumo — `page.tsx`

"Como foi a última sessão, e o que fazer na próxima", em uma dobra e meia.

1. **Primeiros passos**, só enquanto faltar passo (6);
2. **Hero** (`sessao-hero.tsx`): a última sessão da lente. Contexto numa
   linha — modo (chip, ou o botão `modo? ▾` quando falta), mapa, placar,
   partidas, rounds, duração — com o **fim da sessão** à direita; o
   intervalo `de → até` fica só no `title`, porque 17 h entre coletas não é
   tempo jogado. Três números em `num` 3xl/5xl, cada um com chip de delta e
   **uma** linha de referência. No rodapé, as notas que qualificam a leitura
   (amostra curta, rounds em mapa que a Steam não conta) como chips, não
   como parágrafo. É o único `glow` da tela.
3. **Análise** (5): manchete e ação, sem repetir os números do hero.
4. **Estatísticas**: seis cartões (2.3), com link para a aba.
5. **Atividade · 30 dias** (`atividade.tsx`): cinco contagens — sessões,
   partidas, rounds, horas em partida, dias com sessão — contra os 30 dias
   anteriores, com chip **neutro** (volume não tem valência:
   `melhorQuando: "nenhuma"`), e as barras de rounds por dia, pelo dia em
   que a sessão fechou. Com lente, a parte do modo acende e o resto apaga.
6. **Por modo** (3).

As leituras de K/D, headshot e modo saíram do Resumo: eram o hero em prosa.
Na tela, `lerSerie` só alimenta os chips-nota do hero (`amostra`, `mapas`);
`arma-melhor`/`arma-pior` saíram de Estatísticas em 17/09, substituídas
pelos insights materializados por arma, e sobrevivem apenas nas views do
analista, que ainda leem a série.

### 4.2 Estatísticas — `estatisticas/page.tsx`

"Como estou, estatística por estatística", com a série inteira sempre à
vista.

1. **Destaques**: os insights por arma lidos do banco (`arma.precisao`,
   `arma.destaque`), um `Insight` cada — visual à esquerda, uma linha de
   texto, marca de confiança à direita;
2. os **doze cartões** na lente;
3. **Sobre estes contadores** (`counter-scope.tsx`): `details` colapsado com
   quatro linhas — somam todos os modos, só o pool antigo de mapas, última
   partida congelada desde o CS:GO (com "confirmado nos seus dados" quando
   `gaugesLookStale`), dano por round não é ADR. O detalhe medido está em
   `docs/dados-profundos.md`.

Não há recorte por mapa aqui: filtrar por mapa tinha o mesmo defeito de
filtrar por modo — esvaziava os gráficos — e com menos dados ainda. Mapa é
coluna em Sessões e dimensão de partida em Partidas.

### 4.3 Sessões — `sessoes/page.tsx`

Cada sessão como uma linha, comparável com o normal: `quando · modo · mapa ·
placar · partidas · rounds · K/D (+chip) · dano/round · HS · min`. Kills,
deaths e MVP ficam no `title` da linha. Sessão sem modo tem o chip `modo? ▾`
(`marcar-modo.tsx`): é aqui que a marcação em massa acontece. No mobile,
cada linha vira um cartão de duas linhas.

O chip do K/D é **lido**, não calculado: vem do insight `kd.vs.normal` da
sessão (`chipsDeSessao`, casado por `Session.ateSnapshotId`, que é o
`snapshotId` da linha). A página não chama `calcularDelta` nem
`normaisDoHero`. Isso trocou a referência do chip, e a troca é o ganho: era
o normal **da lente** — na aba "tudo", o vitalício da última coleta, o mesmo
número para todas as linhas, que se movia quando entravam coletas novas — e
passou a ser o normal do **modo da própria sessão** na hora em que ela
fechou (`normalNaHora`, §3.3 de `dados-confiaveis.md`), ou o vitalício
daquela coleta enquanto não há base. Duas consequências na tela: uma legenda
de uma linha diz `chip de K/D: cada sessão contra o normal do modo dela
(vitalício enquanto não há base) — não muda com a aba`, e a linha fora do
modo também tem chip, porque a comparação dela não depende mais da aba. A
linha inteira do insight vai no `title` da célula. Sessão sem insight
materializado fica sem chip (§4.4: vazio é vazio).

### 4.4 Partidas — `partidas/page.tsx`

Partidas oficiais, uma a uma, com o placar dos dez — o que a Web API não dá.
Sem a corrente ligada, a página é o convite: título, uma frase, três bullets
(`Só histórico de partidas`, `Cifrado; revogável aqui`, `FACEIT e Gamers
Club não entram`) e o formulário ao lado. Com ela ligada, é a tabela, mais o
estado da fila (o bot pergunta ao Game Coordinator em até um minuto), o erro
quando a Steam para de aceitar o código, e o rodapé `Corrente ligada ·
Revogar · gerar outro código`.

Acima da tabela, com duas partidas ou mais, o painel (`partidas-painel.tsx`):
vitórias, K/D, HS e kills por round **somados** dos scoreboards listados; a
**forma** (as últimas 20, da mais antiga para a mais recente, cada quadrado
um link, com o K/D da partida em barra sob o quadrado e a linha do 1,00); e
**por mapa** (barra = partidas, dividida em vitórias e derrotas). Aqui
verde e vermelho são valência de verdade — vencer é bom.

A página da partida (`partida/[id]`) ganhou a faixa **round a round**
(`rounds-da-partida.tsx`), lida de `MatchDemo.linhaDoTempo`
(`lib/demo/linha-do-tempo.ts`): a diferença de rounds depois de cada round
(acima do zero, seu time na frente), e uma célula por round na linha de quem
venceu, na cor do lado (`--side-ct`/`--side-t`) e com o ícone de como
acabou; a troca de lados abre um vão, e com economia (payload v2) um traço
de três níveis diz a compra do time. Os times ficam um sob o outro, com as
tabelas rolando na horizontal em tela estreita.

### 4.5 Métricas — `metricas/page.tsx`, `metric-table.tsx`

Os ~178 contadores, já comparados, para quem quer procurar. Cada contador
vira taxa por round no período contra a taxa de vitalício, que é a única
comparação honesta entre um recorte e uma vida inteira.

A ordem é informação, em três camadas (`todasAsMetricas`): primeiro o que
aconteceu e pesou, por **impacto** = |período − normal| × rounds do período;
depois o que aconteceu pouco; por último o que não aconteceu. Ordenar por
porcentagem punha cinco abates de MP9 (+4540 % sobre uma base minúscula) na
frente de 125 abates a mais que o normal. `relevante` exige ao menos
`MINIMO_NO_PERIODO = 5` eventos no período e vitalício maior que zero.

Na tela: chips de grupo (`Geral · Por arma · Por mapa · Última partida`),
busca, e uma linha por métrica com label, total no período, período,
referência (rotulada `normal do modo` / `vitalício` / `vitalício · sem
base`), chip e sparkline. O grupo congelado fica colapsado no fim.

### 4.6 Análises — `analista/page.tsx`

Histórico das leituras do analista, uma por sessão: a mais recente aberta,
as anteriores colapsadas. Sem bloco de números, sem `glow`.

### 4.7 `painel/[key]` — a estatística de perto

O mesmo `StatCard` no topo (para a leitura não mudar entre a grade e aqui),
ao lado de um bloco **Como ler** que nomeia cada marcador do gráfico: ponto
= sessão, tracejado = normal, vazado = amostra pequena, triângulo = fora da
escala, laranja = a lente, e a média móvel quando a estatística é por
partida. Abaixo, o `SerieChart`, e depois cada sessão como linha com o seu
delta (`quando · modo · rounds · valor · vs normal`).

Sessão por sessão, sem agrupar por dia, semana ou mês: a sessão é a unidade
do produto, e agrupar escondia justamente a que importava.

### 4.8 `metricas/[key]` — uma métrica sozinha

Taxa por round, acumulado e cada coleta com o seu delta, porque é do delta
que sai todo o resto e quem duvida do número deveria poder conferir a conta.

**Esta página ainda não segue o sistema**: recomputa a referência com
`lifetimeValue` por fora (sem lente e sem limiar de ruído), tem o próprio
`fmt` e o próprio `toLocaleString`, e mostra "variação" como texto em vez do
chip. O mesmo número pode, portanto, mudar de sinal ao clicar na linha da
lista. Está no backlog como item; até ele ser feito, é a única tela da área
do jogo fora do padrão descrito aqui.

---

## 5. O cartão do analista

`analista.tsx` + `analise-texto.ts`. A divisão de trabalho com o hero é o
que impede a primeira dobra de mostrar o mesmo K/D duas vezes em 30 px:

| | Hero | Análise |
|---|---|---|
| Pergunta | "quanto?" | "por quê, e o que fazer?" |
| Conteúdo | 3 números, delta, referência, contexto | manchete, juízo em 2–3 parágrafos, uma ação |
| Números | grandes, por `formatarStat` | só inline no texto, em negrito, nunca em bloco |
| Destaque | `glow` | nenhum |

O contexto (modo, mapa, placar, quando) é o cabeçalho do cartão, porque na
aba Análises não há hero acima; no Resumo é redundante mas custa uma linha.

**Manchete é contrato, não heurística.** `lerAnalise` só promove o primeiro
bloco quando ele vem marcado — `**…**` inteiro ou iniciado por `# ` —, com
até 90 caracteres e sem dois-pontos no fim. Um primeiro parágrafo curto não
vira título por ser curto: foi assim que uma introdução de 24 px apareceu em
produção. Análises antigas e respostas desobedientes começam pelo corpo. A
ação é a última linha começando por `→` (inclusive quando colada no fim de
um parágrafo, via `separarAcaoColada`).

Estados do corpo, por `status`: `PENDING`/`ACKNOWLEDGED` → skeleton com o
cabeçalho real; `FAILED` → `Sem análise desta vez` + `Pedir de novo` (POST
`/api/analises`); `ANSWERED` → manchete opcional, corpo (`line-clamp-2` com
manchete, 3 sem, e `ler análise ▾` no Resumo; aberto em Análises) e a ação
em caixa `border-accent/30`.

O renderizador entende negrito e listas, e só. Um renderizador de markdown
inteiro traria tabelas e cabeçalhos que não cabem num cartão.

O que o prompt do agente deve pedir e proibir está em
`docs/cogniflow-tenant.md`: manchete marcada na primeira linha, juízo e
causa, e nada de listar cada métrica com valor e vitalício — o cartão ao
lado já mostra os números.

---

## 6. Avisos e pendências

Três portas, três lugares, sem repetição:

| Porta | Onde vive | Forma |
|---|---|---|
| `stats` (detalhes do jogo privados na Steam) | página inteira (`sem-dados.tsx`) e Primeiros passos | bloqueante: nada funciona sem |
| `bot` (sessão sem modo/mapa) | linha de cobertura sob as abas, chip `modo? ▾` no hero e em Sessões | inline e factual — é estado, não aviso; não tem "dispensar" |
| `partidas` (corrente do share code) | aba Partidas e um passo do onboarding | convite, só ali |

Não existe banner de pendências repetido em todas as abas. Um aviso `warn`
em seis telas, dispensável por sete dias, irritava quem já decidiu não
adicionar o bot e não ajudava quem queria — a informação chegava longe do
lugar onde o dado falta. Inline, o aviso está exatamente onde a lacuna
aparece.

**Primeiros passos** (`primeiros-passos.tsx`) tem duas formas: enquanto as
estatísticas não estão visíveis, o cartão completo; com elas visíveis e
passos pendentes, um `details` compacto `Primeiros passos · 2 de 4 ▾`. Some
quando todos os passos estão feitos.

Mensagens no chat da Steam são outro canal e têm outra cadência: três
lembretes, um por semana, com teto (`src/lib/pendencias.ts`). A interface
não insiste; o chat, com limite, sim.

---

## 7. Onde cada regra é testada

`tests/lib/`: `series.test.ts` (pares derivados, atraso da Steam, bucketing,
normal), `leituras.test.ts` (relevância, impacto, camadas),
`leituras-sessoes.test.ts`, `analise-texto.test.ts` (manchete marcada vs
introdução curta), `analista.test.ts` (views). Rodam com
`npx tsc --noEmit -p tsconfig.json`, `npm run lint` e `npm test`, que é o
que o CI roda.
