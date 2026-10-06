-- Uma análise, uma janela (src/lib/analise-sessao.ts). A análise guarda a
-- sessão que a pergunta descreveu (coletas de/até e os totais), e a tela só
-- a mostra enquanto a sessão de hoje bate com ela. `pedidaEm` é quando a
-- pergunta saiu pela última vez (pedir de novo não mexe em `createdAt`), e
-- `historico` guarda cada correção com o texto anterior. Tudo nulo nas
-- análises antigas: elas são conferidas pelo conteúdo, e
-- `scripts/banco/reprocessar-analises.ts` preenche a janela das que conferem.
ALTER TABLE "analyses" ADD COLUMN "janela" JSONB,
ADD COLUMN "janelaHash" TEXT,
ADD COLUMN "pedidaEm" TIMESTAMP(3),
ADD COLUMN "historico" JSONB;
