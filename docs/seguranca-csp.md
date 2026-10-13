# CSP em Report-Only: como ler os avisos e quando bloquear

A CSP completa do `next.config.ts` vai em `Content-Security-Policy-Report-Only`:
o navegador **avisa** o que bloquearia e não bloqueia nada. Até 13/10/2026
esse aviso só aparecia no console de quem abria a página, ou seja, em lugar
nenhum que a gente leia. Agora cada violação chega ao site e vira uma linha
de log.

## Como funciona

1. A política leva `report-uri /api/csp-report` (formato antigo, que todo
   navegador entende) e `report-to csp-fragiq`, com o cabeçalho
   `Reporting-Endpoints: csp-fragiq="/api/csp-report"` (formato novo).
2. `src/app/api/csp-report/route.ts` recebe o POST sem login e sem banco,
   responde sempre `204` e escreve uma linha no stdout da Lambda:

   ```text
   [csp] {"diretiva":"img-src","bloqueado":"https://cdn.exemplo.com/a.png","documento":"https://fragiq.buildlabs.com.br/p/7656...","suprimidas":0}
   ```

3. `src/lib/csp-relatorio.ts` cuida de duas coisas: **tira query e hash** das
   URLs (um `?q=` ou um token na barra não vai para o log) e **deduplica**
   por instância: o mesmo par (diretiva, bloqueado) sai uma vez a cada
   10 minutos, com a contagem do que foi suprimido em `suprimidas`. Uma
   violação presente em toda página não vira uma linha por visita.
   Corpo acima de 8 KB ou que não seja JSON é ignorado.

Não há tabela nem recurso novo na AWS: é o log que a `fragiq-site` já tem.

## Como ler

CloudWatch Logs Insights em `/aws/lambda/fragiq-site`:

```text
fields @timestamp, @message
| filter @message like /\[csp\]/
| parse @message '"diretiva":"*","bloqueado":"*","documento":"*","suprimidas":*}' as diretiva, bloqueado, documento, suprimidas
| stats count() as linhas, sum(suprimidas) as repetidas by diretiva, bloqueado
| sort linhas desc
```

Ou, pela CLI: `aws logs filter-log-events --log-group-name /aws/lambda/fragiq-site
--filter-pattern '"[csp]"' --start-time <ms>` (perfil `buildlabs`).

## O que esperar e o que fazer com cada achado

| Achado | O que é | Ação |
|---|---|---|
| `bloqueado: inline` em `script-src*` | scripts inline do Next | esperado: a política já tem `'unsafe-inline'`; só some do relatório se algo mudar |
| host de extensão (`chrome-extension`, `moz-extension`, `safari-extension`) | extensão do navegador do visitante | ignorar; não é do site |
| host de CDN da Steam fora de `*.steamstatic.com` / `*.steampowered.com` / `*.akamaihd.net` | imagem nova | acrescentar o host em `img-src` no `next.config.ts` **antes** de bloquear |
| `static.cloudflareinsights.com` / `cloudflareinsights.com` | beacon do Cloudflare | já liberado; se aparecer, o domínio mudou |
| qualquer outro host de terceiro | script, imagem ou conexão que ninguém pediu | investigar: pode ser dependência nova ou injeção |

## Quando promover a `Content-Security-Policy`

Critérios, nesta ordem:

1. **14 dias** de relatórios coletados (a partir da publicação desta
   mudança) cobrindo as telas públicas, a área logada e `/admin`;
2. nenhuma linha de host legítimo sem exceção (tabela acima) nos últimos
   7 dias, descontadas as de extensão;
3. trocar o nome do cabeçalho em `cabecalhosDeSeguranca` e ajustar
   `tests/app/cabecalhos-seguranca.test.ts` (hoje ele **exige** Report-Only e
   que a CSP bloqueante só tenha `frame-ancestors`);
4. manter `report-uri` na política bloqueante: é ela que avisa quando um
   bloqueio real quebrar uma tela;
5. publicar e olhar o log por 24 h; a volta é recolocar o nome
   `-Report-Only`.

Fica de fora desta promoção, e é o passo seguinte: tirar `'unsafe-inline'`
de `script-src` (exige nonce por requisição no Next) e de `style-src`.
