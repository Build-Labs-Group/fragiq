-- A partida round a round (src/lib/demo/linha-do-tempo.ts), pronta para a
-- página: quem venceu cada round, de que lado, como e com que compra.
-- Montá-la exige o payload inteiro (`dados`, com os tiros); guardada, a
-- página lê uns poucos KB. Nula nas demos lidas antes: a página preenche
-- na primeira visita, e `npm run recompute:demos` preenche todas.
ALTER TABLE "match_demos" ADD COLUMN "linhaDoTempo" JSONB;
