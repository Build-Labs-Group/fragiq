---
id: FQ-0001
titulo: /amigos cai com erro 500 quando a leitura da Steam pelo cogniflow falha
projeto: fragiq
tipo: bug
prioridade: P1
status: pronto
esforco: P
area: src/app/amigos, src/lib/social.ts
criado_por: po
criado_em: 2026-09-29
atualizado_em: 2026-09-29
commits: []
relacionados: []
---

## Problema
A página de amigos chama `steam.friends.read` no cogniflow durante o render e
não trata a falha. Qualquer erro dessa chamada (cogniflow fora, timeout de
`AbortSignal.timeout`, recusa da Steam, variável faltando) derruba a página
inteira com 500, e o app não tem nenhum `error.tsx`, então a pessoa vê a tela
de erro padrão em vez de "Seguindo" e "Seguidores", que vêm só do nosso banco.
A mesma falha em `/games/730/inventario` já é tratada e a página abre.

Também quebra a promessa do README de avaliar a interface sem Steam
(`npm run seed` + `/api/auth/dev-login`): `/amigos` é a única rota logada que
não abre nesse modo.

## Evidências
![/amigos no app local, 1280x800](../evidencias/FQ-0001/01-amigos-desktop-500-local.png)
![/amigos no app local, 390x844](../evidencias/FQ-0001/02-amigos-mobile-500-local.png)
- Pilha e comparação com as outras rotas: `../evidencias/FQ-0001/console.txt`
- Código: `src/app/amigos/page.tsx:33` → `src/lib/social.ts:32` →
  `src/lib/steam/api.ts:196` (sem try/catch no caminho).

## Critérios de aceite
- [ ] Dado que a capability `steam.friends.read` falha (lança erro ou dá
      timeout), quando a pessoa abre `/amigos`, então a página responde 200,
      mostra "Seguindo" e "Seguidores" e, no lugar da seção "Da sua lista da
      Steam", um aviso curto de que a lista não pôde ser lida agora.
- [ ] A falha fica no log do servidor com contexto (sem steamId completo nem
      segredo).
- [ ] Existe um `src/app/error.tsx` (ou por segmento) com a identidade do site
      para qualquer outro erro inesperado.
- [ ] Teste (vitest de `amigosNoFragiq` com a capability falhando) e e2e local
      (seed + dev-login sem `COGNIFLOW_*`) cobrem o cenário.

## Notas técnicas
Seguir o padrão de `inventario` (`[inventario.leitura]`). Diferenciar "lista
privada" (ids vazios) de "falhou a leitura": hoje só o primeiro tem texto.

## Conversa
### 2026-09-29 · PO
Aberto na varredura diária. P1: não vi o erro em produção nas últimas 24 h
(`get_runtime_errors` vazio), mas é a única rota logada que cai inteira quando
o cogniflow oscila.

## Entrega
(preenchido pelos devs)
