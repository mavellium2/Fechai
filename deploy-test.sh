#!/usr/bin/env bash
# Publica o laboratório online sem tocar nos containers ou volumes de produção.
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

ENV_FILE="${TEST_ENV_FILE:-.env.test-vps}"
[[ -f "${ENV_FILE}" ]] || {
  echo "Falta ${ENV_FILE}. Copie deploy/test.env.example e preencha os segredos de teste." >&2
  exit 1
}

COMPOSE=(docker compose --project-name fechai-test --env-file "${ENV_FILE}" -f docker-compose.test.yml)

# Lock diferente do deploy de produção: os dois ambientes não compartilham
# containers, mas duas publicações do laboratório não podem correr juntas.
exec 9>/tmp/fechai-test-deploy.lock
if ! flock -n 9; then
  echo "Já existe um deploy do laboratório em andamento." >&2
  exit 1
fi

"${COMPOSE[@]}" config -q

echo "==> Subindo PostgreSQL e Redis isolados..."
"${COMPOSE[@]}" up -d --wait postgres redis

echo "==> Construindo a imagem do laboratório..."
"${COMPOSE[@]}" build web

echo "==> Sincronizando somente o schema do banco saas_test..."
"${COMPOSE[@]}" run --rm --no-deps web npx prisma db execute \
  --file prisma/manual/002-broadcast-retry-index.sql --schema prisma/schema.prisma
"${COMPOSE[@]}" run --rm --no-deps web npx prisma db push --skip-generate

echo "==> Inserindo as contas de demonstração (operação idempotente)..."
"${COMPOSE[@]}" run --rm --no-deps web npx prisma db seed

echo "==> Publicando o aplicativo de laboratório..."
"${COMPOSE[@]}" up -d --no-deps --force-recreate --wait --wait-timeout 180 web

echo "==> Laboratório saudável em https://${TEST_APP_DOMAIN:-dominio-configurado}"
"${COMPOSE[@]}" ps
