---
id: FQ-0003
titulo: Site sem cabeçalhos de segurança (frame-ancestors, nosniff, CSP)
projeto: fragiq
tipo: seguranca
prioridade: P2
status: feito
esforco: P
area: next.config.ts
criado_por: po
criado_em: 2026-09-29
atualizado_em: 2026-10-01
commits: []
relacionados: [LR-0002 (mesmo problema na plataforma da Lilian)]
---

## Problema
Produção só manda `Strict-Transport-Security`. Faltam `X-Frame-Options`/
`frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy`,
`Permissions-Policy` e CSP; `next.config.ts` está vazio e não há middleware.
Há sessão por cookie e botões de ação (seguir, sincronizar, configurações de
privacidade): sem `frame-ancestors`, dá para embutir essas telas num iframe.

## Evidências
- `../evidencias/FQ-0003/cabecalhos-producao.txt` (curl de 29/09 06:21 UTC e
  `next.config.ts` da `main` ab60712).

## Critérios de aceite
- [ ] Dado qualquer página HTML em produção, então vêm `X-Content-Type-Options:
      nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
      `frame-ancestors 'none'` (ou `X-Frame-Options: DENY`) e uma
      `Permissions-Policy` restritiva.
- [ ] CSP em `Report-Only` com as exceções de Steam (avatares), Vercel Analytics
      e Speed Insights, sem erro de console na home, `/cs2` e `/partida/[id]`.
- [ ] Teste falha se algum desses cabeçalhos sumir; `x-powered-by` desligado
      (`poweredByHeader: false`).

## Conversa
### 2026-09-29 · PO
Aberto na varredura diária.

### 2026-10-01 · Dev
Reproduzido: produção só manda `strict-transport-security` e `x-powered-by`
(`dev-antes-curl.txt`). Peguei, fiz e passei para `feito`.

Decisões que tomei sozinho:
- `frame-ancestors` é ignorado pelo navegador numa CSP Report-Only. Por isso
  ele vai numa `Content-Security-Policy` própria, que bloqueia de verdade e
  só tem essa diretiva, junto com `X-Frame-Options: DENY`. Nenhuma tela do
  FragIQ é embutida em lugar nenhum (procurei `iframe`/`embed` em `src/` e
  `docs/`).
- A CSP completa fica em Report-Only, como o item pede. Ela tem
  `unsafe-inline` em `script-src` porque o Next injeta scripts inline e a
  página ainda não tem nonce. Promover para `Content-Security-Policy` é um
  passo seguinte, depois de alguns dias sem aviso no console.
- Sem `report-uri`: não há endpoint para receber relatórios. Os avisos
  aparecem só no console de quem abre a página.
- `Permissions-Policy` tem só recursos que os navegadores reconhecem
  (`camera`, `microphone`, `geolocation`, `payment`, `usb`). Nome
  desconhecido, como `interest-cohort`, gera aviso no console.
- HSTS já vinha da Vercel e não mudou.

## Entrega
**Resumo:** toda resposta do site passa a dizer ao navegador que não pode
ser exibida dentro de iframe, que o tipo de arquivo não deve ser adivinhado,
quanto do endereço vai como referrer e que câmera, microfone, localização,
pagamento e USB estão desligados. A CSP completa vigia em Report-Only sem
bloquear nada. O `x-powered-by: Next.js` some.

**Commits:** (preenchido no commit do backlog)

**Arquivos:** `next.config.ts` (`headers()` e `poweredByHeader: false`) ·
`tests/app/cabecalhos-seguranca.test.ts` (novo) · `README.md` (seção
"Cabeçalhos de segurança").

**Testes:** `tests/app/cabecalhos-seguranca.test.ts` chama a mesma
`headers()` que a Vercel aplica e confere, para `/`, `/cs2`,
`/partida/[id]` e uma rota de API, cada cabeçalho, a CSP que bloqueia (só
`frame-ancestors`), as diretivas e exceções da Report-Only e o
`poweredByHeader`. Falhava nos 7 casos antes da mudança; 7 verdes depois
(`../evidencias/FQ-0003/dev-testes.txt`). No build local, `curl -sI` mostra os
cabeçalhos e o console da home não tem violação de CSP
(`../evidencias/FQ-0003/dev-depois-curl-local.txt`).

**Antes / depois:** `../evidencias/FQ-0003/dev-antes-curl.txt` ·
`../evidencias/FQ-0003/dev-depois-curl-local.txt` ·
`../evidencias/FQ-0003/dev-depois-producao.txt` (depois do deploy).

**Como validar:** `curl -sI https://fragiq.buildlabs.com.br/` mostra
`content-security-policy: frame-ancestors none`, `x-frame-options: DENY`,
`x-content-type-options: nosniff`, `referrer-policy`, `permissions-policy`,
`content-security-policy-report-only` e não mostra `x-powered-by`. Abrir a
home, `/cs2` e uma `/partida/<id>` com o console aberto: nenhum aviso
"[Report Only]".
