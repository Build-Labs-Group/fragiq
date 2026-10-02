#!/bin/bash
# Publica o bot no host compartilhado da Build Labs (pilha
# InfraCompartilhada-Host, conta 576951332499, us-east-2), sem SSH:
#   1. empacota bot/ (nunca o .env) e sobe no bucket de deploy;
#   2. `aws ssm send-command` baixa, extrai em /opt/buildlabs/fragiq/atual
#      (a versão anterior fica em .../anterior) e roda o run.sh;
#   3. espera o comando e mostra a saída.
# Uso: ./deploy.sh            reconstrói; só recria o container se ele já roda
#      INICIAR=1 ./deploy.sh  liga o bot (só na virada: nunca dois bots logados)
set -euo pipefail
export MSYS_NO_PATHCONV=1
PERFIL="${AWS_PROFILE:-buildlabs}"
REGIAO=us-east-2
aws_() { aws --profile "$PERFIL" --region "$REGIAO" "$@"; }
cd "$(dirname "$0")"

saida() {
  aws_ cloudformation describe-stacks --stack-name InfraCompartilhada-Host \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
INSTANCIA=$(saida InstanciaId)
BUCKET=$(saida BucketDeDeploy)
VERSAO="$(git rev-parse --short HEAD)$(git diff --quiet HEAD -- . || echo -sujo)-$(date -u +%Y%m%dT%H%M%SZ)"
CHAVE="fragiq/bot-$VERSAO.tar.gz"

TEMP=$(mktemp -d)
trap 'rm -rf "$TEMP"' EXIT
tar --exclude node_modules --exclude '.env' --exclude '.env.*' -czf "$TEMP/bot.tar.gz" .
LOCAL="$TEMP/bot.tar.gz"
command -v cygpath > /dev/null && LOCAL=$(cygpath -w "$LOCAL")
aws_ s3 cp "$LOCAL" "s3://$BUCKET/$CHAVE" --only-show-errors
echo "Pacote: s3://$BUCKET/$CHAVE"

D=/opt/buildlabs/fragiq
PARAMETROS=$(node -e 'console.log(JSON.stringify({ executionTimeout: ["1800"], commands: process.argv.slice(1) }))' \
  "set -euo pipefail" \
  "rm -rf $D/novo && mkdir -p $D/novo" \
  "aws s3 cp s3://$BUCKET/$CHAVE - --region $REGIAO | tar -xz -C $D/novo" \
  "if [ -d $D/atual ]; then rm -rf $D/anterior && mv $D/atual $D/anterior; fi" \
  "mv $D/novo $D/atual && chmod +x $D/atual/run.sh" \
  "INICIAR=${INICIAR:-0} $D/atual/run.sh")

COMANDO=$(aws_ ssm send-command --instance-ids "$INSTANCIA" --document-name AWS-RunShellScript \
  --comment "fragiq bot $VERSAO" --parameters "$PARAMETROS" --query Command.CommandId --output text)
echo "Comando $COMANDO na $INSTANCIA; esperando..."

while true; do
  STATUS=$(aws_ ssm get-command-invocation --command-id "$COMANDO" --instance-id "$INSTANCIA" \
    --query Status --output text 2> /dev/null || echo Pending)
  case "$STATUS" in Pending | InProgress | Delayed) sleep 10 ;; *) break ;; esac
done
aws_ ssm get-command-invocation --command-id "$COMANDO" --instance-id "$INSTANCIA" \
  --query '[StandardOutputContent, StandardErrorContent]' --output text | tail -40
echo "Status: $STATUS"
[ "$STATUS" = Success ]
