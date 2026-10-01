---
id: FQ-0004
titulo: Classe .hud fora de camada vence cor e tamanho do Tailwind (selo "beta" sai cinza)
projeto: fragiq
tipo: ux
prioridade: P2
status: pronto
esforco: P
area: src/app/globals.css (.hud)
criado_por: dev
criado_em: 2026-10-01
atualizado_em: 2026-10-01
commits: []
relacionados: [FQ-0002]
---

## Problema
`.hud` está em `globals.css` fora de qualquer `@layer`. No Tailwind 4 os
utilitários ficam em `@layer utilities`, e CSS sem camada sempre vence CSS em
camada. Resultado: em todo elemento `hud` + cor ou tamanho do Tailwind, a cor
e o tamanho da `.hud` ganham. O selo "beta" do cabeçalho da home pede
`text-accent text-[10px]` e sai em `--ink-faint` a 11px; o axe do FQ-0002 o
mediu como `#7c8695`, não laranja. São 10 combinações `hud` + `text-<cor>` em
`src/` (ex.: `src/app/page.tsx:59`, `src/app/p/[steamId]/vs/[outro]/page.tsx:36`).

## Evidências
- `../evidencias/FQ-0002/dev-antes-axe-producao.txt`: "beta" medido em
  `#7c8695` sobre `#f2eae8`, apesar do `text-accent`.

## Critérios de aceite
- [ ] Dado o selo "beta" da home, então ele sai na cor `--accent`.
- [ ] Dado um `hud` sem cor explícita, então continua em `--ink-faint` 11px.
- [ ] A correção é mover `.hud` (e as outras classes próprias, se fizer
      sentido) para `@layer components`, não `!important` página a página.
- [ ] Conferir as 10 combinações: alguma pode ter sido escrita contando com
      o cinza; nessa, tirar a cor do `className` em vez de mudar a tela.

## Notas técnicas
Ao virar laranja, o "beta" de 10px sobre o cabeçalho precisa de 4,5:1: com o
`--accent` `#b83d0b` do FQ-0002 dá 4,8 sobre `#f2eae8`.

## Conversa
### 2026-10-01 · Dev
Achado ao fazer o FQ-0002; fora do escopo dele, então virou item próprio.

## Entrega
(preenchido pelos devs)
