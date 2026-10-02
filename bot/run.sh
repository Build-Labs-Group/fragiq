#!/bin/bash
# Roda NO HOST, dentro do pacote extraído em /opt/buildlabs/fragiq/atual
# (o deploy.sh chama). Reconstrói a imagem e recria o container só se o bot
# já estava de pé ou se INICIAR=1: a Steam derruba uma das sessões quando
# dois bots logam na mesma conta (LogonSessionReplaced), então publicar
# nunca liga um bot que estava desligado sem alguém pedir.
set -euo pipefail
cd "$(dirname "$0")"

# A imagem sai do buildx do host (o 0.12 do Amazon Linux); o compose v5 só sobe
# o container, porque o build dele pede buildx 0.17 ou mais novo.
docker buildx build --pull --load -t fragiq-bot .
rodando=$(docker inspect -f '{{.State.Running}}' fragiq-bot 2>/dev/null || echo false)
if [ "${INICIAR:-0}" = 1 ] || [ "$rodando" = true ]; then
  docker compose up -d --no-build --remove-orphans
  docker compose ps
else
  echo "Imagem pronta; o bot NAO foi iniciado. Para ligar: INICIAR=1 no deploy.sh."
fi
docker image prune -f > /dev/null
free -m
