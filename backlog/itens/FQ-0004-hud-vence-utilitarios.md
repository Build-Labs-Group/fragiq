---
id: FQ-0004
titulo: Classe .hud fora de camada vence cor e tamanho do Tailwind (selo "beta" sai cinza)
projeto: fragiq
tipo: ux
prioridade: P2
status: feito
esforco: P
area: src/app/globals.css (.hud)
criado_por: dev
criado_em: 2026-10-01
atualizado_em: 2026-10-13
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
- [x] Dado o selo "beta" da home, então ele sai na cor `--accent`.
- [x] Dado um `hud` sem cor explícita, então continua em `--ink-faint` 11px.
- [x] A correção é mover `.hud` (e as outras classes próprias, se fizer
      sentido) para `@layer components`, não `!important` página a página.
- [x] Conferir as 10 combinações: alguma pode ter sido escrita contando com
      o cinza; nessa, tirar a cor do `className` em vez de mudar a tela.

## Notas técnicas
Ao virar laranja, o "beta" de 10px sobre o cabeçalho precisa de 4,5:1: com o
`--accent` `#b83d0b` do FQ-0002 dá 4,8 sobre `#f2eae8`.

## Conversa
### 2026-10-01 · Dev
Achado ao fazer o FQ-0002; fora do escopo dele, então virou item próprio.

## Entrega
- **Resumo:** `.hud` passou para `@layer components` em `src/app/globals.css`;
  os utilitários do Tailwind (`@layer utilities`) agora vencem. O selo "beta"
  da home sai em `--accent`; `hud` sem cor continua `--ink-faint` a 11px.
- **As combinações conferidas** (todas escritas pedindo a cor ou o tamanho, nenhuma
  contava com o cinza, então nenhuma tela foi mexida): `text-accent` em "beta"
  (home), "vs" (comparação), "próxima" (analista), "demo", "próximo" e
  "Primeiros passos concluídos", chip do bot amigo e selos Fundador/Dev;
  `text-[10px]` nos rótulos de cartão (de 11px para os 10px pedidos);
  `text-xs` na linha de Sessões (12px). Efeito colateral bom: o
  `hover:text-ink` do link do quadro, que nunca funcionou, passa a funcionar.
- **Teste:** `tests/app/hud-camada.test.ts` (falha na CSS antiga, 3 casos) e
  `steam` entrou na conta de contraste de `tests/app/contraste-tokens.test.ts`
  (o selo Dev passa a sair azul, 10px).
