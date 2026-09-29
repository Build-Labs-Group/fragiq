---
id: FQ-0003
titulo: Site sem cabeçalhos de segurança (frame-ancestors, nosniff, CSP)
projeto: fragiq
tipo: seguranca
prioridade: P2
status: pronto
esforco: P
area: next.config.ts
criado_por: po
criado_em: 2026-09-29
atualizado_em: 2026-09-29
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

## Entrega
(preenchido pelos devs)
