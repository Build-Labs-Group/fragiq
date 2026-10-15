-- Vínculo declarado com a Gamers Club (docs/gamersclub.md). Aditiva: tabela
-- nova, nada existente muda. `fonte` e `verificada` guardam a proveniência;
-- sai em cascata com o usuário.
CREATE TABLE "contas_gamersclub" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gcPlayerId" TEXT NOT NULL,
    "nivel" INTEGER,
    "fonte" TEXT NOT NULL DEFAULT 'USUARIO',
    "verificada" BOOLEAN NOT NULL DEFAULT false,
    "informadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vinculadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contas_gamersclub_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contas_gamersclub_userId_key" ON "contas_gamersclub"("userId");
CREATE INDEX "contas_gamersclub_gcPlayerId_idx" ON "contas_gamersclub"("gcPlayerId");

ALTER TABLE "contas_gamersclub" ADD CONSTRAINT "contas_gamersclub_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
