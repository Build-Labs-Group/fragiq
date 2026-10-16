# Gamers Club no FragIQ

Pedido (15/10/2026): login e extração de dados com a Gamers Club (GC).
Este documento diz o que a investigação achou, o que foi feito e o que
depende de uma autorização que só a Build Labs pode pedir à GC.

> **16/10/2026: o vínculo declarado foi removido do código** (rota, tela, lib e testes). Sem dado da GC que se possa obter de forma legítima, um campo digitado pela pessoa não vale o custo. Ficam a tabela vazia `contas_gamersclub` e o modelo no `schema.prisma` (a migração já foi aplicada; apagar exige migração destrutiva, só com ok do Murilo). A seção "O que foi feito" abaixo descreve o que existiu.

## O que é viável (investigado em 15/10/2026)

| Pergunta | Resposta |
|---|---|
| A GC tem API pública ou OAuth para terceiros? | **Não.** Nenhuma documentação de desenvolvedor, nenhum fluxo "entrar com Gamers Club". As bibliotecas da comunidade (`gamersclub-api` no npm/Packagist) se descrevem como scrapers, dizem que a GC não oferece API, e uma delas está abandonada. |
| O login é só por Steam? | A conta da GC é ligada à Steam, mas não existe um provedor que o FragIQ possa usar. Quem entra no FragIQ já entrou pela Steam: o SteamID é a identidade comum, e não precisa de login extra. |
| Dá para ler o perfil público? | **Tecnicamente só por scraping**, e o site está atrás de Cloudflare (bloqueia `curl`; as bibliotecas usam Puppeteer e cookie de sessão copiado do navegador, `gclubsess`). |
| Os termos permitem? | **Não.** Os Termos de Uso (privacy.gamersclub.gg/use-terms) proíbem arquivar, baixar, reproduzir, distribuir, exibir ou "utilizar" o conteúdo e as informações do serviço sem autorização expressa e por escrito da GC. Apps de terceiros só importam dados "mediante autorização específica" da própria GC/usuário no canal deles, que não existe. Usar o cookie de sessão de alguém é pior ainda. |

Conclusão: **não há como extrair partidas, nível ou estatísticas da GC de
forma legítima hoje.** Nenhum scraper foi escrito e nenhuma credencial de
usuário é pedida ou guardada.

## O que foi feito

Um vínculo **declarado pela pessoa**, dito como tal:

- `ContaGamersClub` (tabela `contas_gamersclub`, migração aditiva
  `20261015120000_gamersclub_vinculo`): `gcPlayerId`, `nivel` (opcional),
  `fonte = "USUARIO"`, `verificada = false`, `informadoEm`, `vinculadaEm`.
  Uma linha por usuário, em cascata com a conta.
- `src/lib/gamersclub.ts`: lê o número ou o link do perfil
  (`gamersclub.com.br/player/<id>`), grava, desvincula.
- `/api/conta/gamersclub` (GET, POST, DELETE), só com sessão.
- Configurações → "Gamers Club": vincular, ver "informado por você · não
  verificado", abrir o perfil na GC, "Desvincular e apagar".
- LGPD: o export (`/api/conta/exportar`) inclui o vínculo; desvincular apaga
  a linha; apagar a conta leva em cascata.
- Testes: `tests/lib/gamersclub.test.ts` (leitura do perfil) e
  `tests/integracao/gamersclub.test.ts` (rotas reais contra Postgres de
  verdade, conferindo a linha em SQL; roda com `FRAGIQ_TEST_PG_URL`, como
  `banco-pg18.test.ts`).

Não há verificação de posse: sem ler o perfil da GC não dá para provar que o
número é da pessoa, então `verificada` fica `false` e a UI não sugere o
contrário. Por isso o vínculo não alimenta nada que dependa de confiança
(ranking, comparação pública): hoje só aparece para a própria pessoa.

## O que falta, e só o Murilo consegue

Pedir à GC **autorização por escrito** (contato@gamersclub.com.br, o canal
que os próprios termos citam) para um acesso programático: API/OAuth, ou
parceria de dados. Com isso, o desenho é:

1. credenciais no SSM `/fragiq/prod/site` (nunca no git);
2. uma flag desligada por padrão (`GAMERSCLUB_ENABLED`);
3. novas colunas/tabelas aditivas com `fonte = "GAMERSCLUB_API"` e
   `verificada = true`, sem sobrescrever o que a pessoa declarou;
4. a UI mostra a proveniência de cada valor (fonte, data da coleta).

Sem a autorização, nada disso deve ser construído.
