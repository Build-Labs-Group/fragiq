---
id: FQ-0002
titulo: Texto secundário (text-ink-faint) abaixo do contraste mínimo na home
projeto: fragiq
tipo: ux
prioridade: P2
status: feito
esforco: P
area: tokens de cor (text-ink-faint, text-accent)
criado_por: po
criado_em: 2026-09-29
atualizado_em: 2026-10-01
commits: []
relacionados: []
---

## Problema
O axe (WCAG 2 AA) acusa 21 elementos com contraste insuficiente na home de
produção. Quase todos são o cinza `#7c8695` (`text-ink-faint`) em 11–12 px sobre
branco ou `#f5f6f8`, com razão 3,1–3,7 (mínimo 4,5). É justamente o texto que
explica cada estatística ("178 contadores do CS2…", "10 s", rótulos "A tese").
Quem ganha: quem lê no celular sob luz forte e quem tem baixa visão; a home é a
porta de entrada do beta aberto.

## Evidências
![Home em produção, 1280x800](../evidencias/FQ-0002/01-home-desktop.png)
- Resultado do axe agrupado por cor: `../evidencias/FQ-0002/axe-color-contrast.txt`
  (inclui "IQ" do logo em `#c2410c` sobre `#f2eae8`, razão 4,36).

## Critérios de aceite
- [ ] Dado a home em produção, quando o axe roda com `wcag2aa`, então não há
      violação `color-contrast`.
- [ ] A troca é feita no token (uma cor para `ink-faint` com razão ≥ 4,5 sobre
      `#ffffff` e `#f5f6f8`), não página a página.
- [ ] Um teste com `@axe-core/playwright` (ou vitest calculando a razão dos
      tokens) impede a regressão.

## Notas técnicas
Cálculo de referência: `#6b7280` dá 4,83 sobre branco mas 4,47 sobre
`#f5f6f8` (não basta); `#5f6875` dá 5,64 / 5,22 / 4,76 sobre branco, `#f5f6f8`
e `#f2eae8`. Conferir com `docs/design.md` antes de escolher.

## Conversa
### 2026-09-29 · PO
Aberto na varredura diária.

### 2026-10-01 · Dev
Reproduzido em produção (axe 4.10.2, tema claro): as mesmas 21 violações
(`dev-antes-axe-producao.txt`). Peguei, fiz e passei para `feito`.

Decisões que tomei sozinho:
- `--ink-faint` claro vira `#5f6875`, a sugestão da PO: 5,6 / 5,2 / 5,0 / 4,9
  sobre `--surface`, `--canvas`, `--surface-2` e `--accent-soft`, e 4,8 no
  cabeçalho da home. Fica mais perto do `--ink-muted` (`#565e6b`), mas ainda
  um degrau abaixo.
- O "IQ" do logo (4,36) só passa mudando a marca: `--accent` claro foi de
  `#c2410c` para `#b83d0b` (mesmo matiz, 5,7:1 no branco, 4,8:1 no cabeçalho).
  O escuro não muda.
- O teste também cobre o tema escuro, e lá o `--ink-faint` (`#7d8590`) dava
  4,49 sobre `--surface-2` e 4,16 sobre `--accent-soft`: virou `#858d99`
  (5,0 / 4,6). Ninguém tinha medido o escuro; entrou porque o teste pegou.
- Não houve E2E com Playwright: a `main` ainda não tem Playwright (ele está no
  branch do FQ-0001, não publicado). O critério aceita "vitest calculando a
  razão dos tokens", que é o que o teste faz; o axe rodou no navegador contra
  o build local e roda de novo em produção depois do deploy.
- Achado no caminho, aberto como FQ-0004: o selo "beta" deveria ser laranja
  (`text-accent`), mas a classe `.hud` fora de camada vence os utilitários do
  Tailwind e pinta de `--ink-faint`.

## Entrega
**Resumo:** o texto secundário da home (rótulos HUD, legendas das
estatísticas, tempos) e o "IQ" do logo passam do mínimo de contraste do
WCAG AA nos dois temas. A troca foi nos tokens de `globals.css`, então vale
para o site inteiro.

**Commits:** (preenchido no commit do backlog)

**Arquivos:** `src/app/globals.css` (tokens `--ink-faint` claro e escuro,
`--accent` e `--accent-glow` claros) · `docs/design.md` (regra de contraste) ·
`tests/app/contraste-tokens.test.ts` (novo).

**Testes:** `tests/app/contraste-tokens.test.ts` faz a conta do WCAG sobre os
tokens lidos de `globals.css`: `--ink`, `--ink-muted`, `--ink-faint` e
`--accent` contra `--canvas`, `--surface`, `--surface-2` e `--accent-soft`,
nos dois temas, mais o fundo do cabeçalho da home. Falhava em 7 casos antes
da troca; 35 verdes depois. Resultado: `../evidencias/FQ-0002/dev-testes.txt`.

**Antes / depois:** `../evidencias/FQ-0002/dev-antes-axe-producao.txt` (21
violações) · `../evidencias/FQ-0002/dev-depois-axe-local.txt` (0 nos dois
temas) · `../evidencias/FQ-0002/dev-depois-axe-producao.txt` (depois do
deploy). Sem prints novos: a mudança de cor é sutil e o axe mede melhor que o
olho.

**Como validar:** abrir https://fragiq.buildlabs.com.br/ no tema claro, rodar
o axe com `wcag2aa` e conferir zero `color-contrast`; repetir no tema escuro.
