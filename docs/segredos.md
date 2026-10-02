# Segredos: da Vercel para o Secrets Manager

> **Em migração (02/10/2026):** o site vai para a conta da Build Labs, e lá
> os segredos vêm do SSM `/fragiq/prod/site` (SecureString, ADR 0005), lidos
> pela role da própria Lambda: `FRAGIQ_SECRET_PARAM`, que tem prioridade
> sobre `FRAGIQ_SECRET_ID`. Na AWS o JSON leva também `DATABASE_URL`,
> `DIRECT_DATABASE_URL`, `CRON_SECRET` e a configuração, carregados no boot
> (`aws/iniciar.mjs`). O caminho abaixo (Secrets Manager por OIDC) vale para
> a Vercel até a virada. Plano e desligamento: `docs/migracao-site-build-labs.md`.

Decisão de 13/09/2026: os segredos do FragIQ moram no Secrets Manager, num
segredo só do tenant, e a Vercel chega nele por OIDC — sem chave AWS
estática em variável de ambiente. O código está em `src/lib/segredos.ts`:
`segredo()`/`segredoOpcional()` carregam o JSON na primeira leitura, dentro
de uma requisição, e guardam em `process.env` pela vida da instância.

Não é no boot de propósito. O token OIDC da Vercel é um header da
requisição (`x-vercel-oidc-token`); um `instrumentation.ts` que tentou
trocá-lo por credencial antes da primeira requisição derrubou a produção
por alguns minutos em 14/09/2026 (rollback pela CLI). Todo leitor de
segredo é async por isso: `authSecret()`, `cogniflow()`, `cogniflowApi()`,
`cifrar()`/`decifrar()` e a autorização das rotas do bot.

## O que vai e o que fica

| Variável | Onde | Por quê |
|---|---|---|
| `AUTH_SECRET` | segredo | assina a sessão; só o runtime precisa |
| `COGNIFLOW_SIGNING_SECRET` | segredo | é o mesmo valor de `tenants.fragiq.webhook.web` no cogniflow |
| `BOT_WEBHOOK_SECRET` | segredo | autentica o bot de presença (`bot/`), que é nosso |
| `DATABASE_URL`, `DIRECT_DATABASE_URL` | Vercel | o build roda `prisma migrate deploy` antes de existir runtime |
| `CRON_SECRET` | Vercel | a Vercel só injeta o Bearer do cron se a variável estiver nela |
| `COGNIFLOW_*_URL`, `*_ID`, `ADMIN_STEAM_IDS`, `APP_URL` | Vercel | configuração, não segredo |

Regra: o segredo vence a variável para as chaves que ele tem; uma chave
que falta nele cai para o ambiente com um aviso no log. Sem
`FRAGIQ_SECRET_ID` o loader não faz nada — é o modo dev, com `.env`.

Feito em 14/09/2026: segredo criado, provider e role `fragiq-vercel`
criados, variáveis trocadas na Vercel. O `AUTH_SECRET` foi gerado novo (o
da Vercel era *Sensitive*, ilegível), o que deslogou todo mundo uma vez.

## 1. O segredo (uma vez)

```bash
aws secretsmanager create-secret --name cogniflow/tenants/fragiq \
  --description "FragIQ (tenant do cogniflow): segredos de runtime" \
  --secret-string "$(jq -n \
    --arg auth "$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" \
    --arg cf "<WEBHOOK_SIGNING_SECRET de tenants.fragiq.webhook.web em cogniflow/prod>" \
    --arg bot "<BOT_WEBHOOK_SECRET atual da Vercel>" \
    '{AUTH_SECRET:$auth, COGNIFLOW_SIGNING_SECRET:$cf, BOT_WEBHOOK_SECRET:$bot}')"
```

Trocar `AUTH_SECRET` desloga todo mundo; para migrar sem isso, copie o
valor atual da Vercel em vez de gerar outro.

## 2. OIDC da Vercel na AWS (uma vez por conta)

Na Vercel: Project → Settings → Security → *Secure backend access with
OIDC federation* → Enabled, issuer mode **Team** (`https://oidc.vercel.com/<team-slug>`).

```bash
TEAM=<team-slug>          # o slug da equipe na Vercel
PROJECT=fragiq            # o nome do projeto na Vercel
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)

aws iam create-open-id-connect-provider \
  --url "https://oidc.vercel.com/$TEAM" \
  --client-id-list "https://vercel.com/$TEAM"

cat > /tmp/trust.json <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::$ACCOUNT:oidc-provider/oidc.vercel.com/$TEAM" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "oidc.vercel.com/$TEAM:aud": "https://vercel.com/$TEAM",
        "oidc.vercel.com/$TEAM:sub": [
          "owner:$TEAM:project:$PROJECT:environment:production",
          "owner:$TEAM:project:$PROJECT:environment:preview"
        ]
      }
    }
  }]
}
JSON
aws iam create-role --role-name fragiq-vercel --assume-role-policy-document file:///tmp/trust.json

SECRET_ARN=$(aws secretsmanager describe-secret --secret-id cogniflow/tenants/fragiq --query ARN --output text)
aws iam put-role-policy --role-name fragiq-vercel --policy-name read-tenant-secret \
  --policy-document "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"secretsmanager:GetSecretValue\",\"Resource\":\"$SECRET_ARN\"}]}"
```

O role lê **um** ARN. Ele não enxerga `cogniflow/prod` nem o segredo de
outro tenant — é isso que torna aceitável um site na Vercel ler o Secrets
Manager da plataforma.

## 3. Vercel

| Variável | Valor |
|---|---|
| `FRAGIQ_SECRET_ID` | `cogniflow/tenants/fragiq` |
| `AWS_ROLE_ARN` | `arn:aws:iam::<conta>:role/fragiq-vercel` |
| `AWS_REGION` | `us-east-1` |

Redeploy. O log da primeira requisição de cada instância mostra
`[segredos] carregado de cogniflow/tenants/fragiq via OIDC`.
Só então apague `AUTH_SECRET`, `COGNIFLOW_SIGNING_SECRET` e
`BOT_WEBHOOK_SECRET` da Vercel — e redeploy de novo para provar que o site
sobe sem elas.

## Local

Com `FRAGIQ_SECRET_ID` no `.env` e sem `AWS_ROLE_ARN`, o loader usa a cadeia
de credenciais da máquina (`aws sso login`, perfil). É o jeito de testar o
caminho real; no dia a dia o `.env` com os valores basta.
