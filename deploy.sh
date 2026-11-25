#!/usr/bin/env bash
# Deploy blue/green do fechai. A versão ativa só para depois que a candidata
# passa no health check e o Traefik tem tempo de descobrir o novo container.
set -Eeuo pipefail

MODE="${1:-all}"
case "${MODE}" in
  web|worker|all|rollback) ;;
  *) echo "Uso: ./deploy.sh [web|worker|all|rollback]" >&2; exit 2 ;;
esac

cd "$(dirname "${BASH_SOURCE[0]}")"

# Impede dois pushes próximos de trocarem os containers ao mesmo tempo.
exec 9>/tmp/fechai-deploy.lock
if ! flock -n 9; then
  echo "Já existe um deploy do fechai em andamento." >&2
  exit 1
fi

COMPOSE=(docker compose --profile blue --profile green)

# Imagem pronta (GHCR, construída no GitHub Actions) ou build local. O build do
# Next consome a VPS inteira por dezenas de minutos e derruba o que está no ar;
# com APP_IMAGE a VPS só baixa as camadas que mudaram.
IMAGE_PULLED=0
prepare_image() {
  local service="$1"
  if [[ -n "${APP_IMAGE:-}" ]]; then
    if [[ "${IMAGE_PULLED}" == "0" ]]; then
      echo "==> Baixando imagem pronta ${APP_IMAGE}..."
      docker pull "${APP_IMAGE}"
      IMAGE_PULLED=1
    fi
  else
    echo "==> APP_IMAGE não definida: construindo ${service} NA VPS (lento e pesado)..." >&2
    nice -n 19 ionice -c3 "${COMPOSE[@]}" build "${service}"
  fi
}

# Imagens antigas do GHCR que nenhum container (nem o parado do rollback) usa.
prune_old_images() {
  [[ -n "${APP_IMAGE:-}" ]] || return 0
  docker image prune -af \
    --filter "label=org.opencontainers.image.source=https://github.com/mavellium/Fechai" \
    --filter "until=72h" >/dev/null || true
}

running_web() {
  "${COMPOSE[@]}" ps --status running --services 2>/dev/null |
    grep -E '^web-(blue|green)$' | head -n 1 || true
}

container_id() {
  "${COMPOSE[@]}" ps -aq "$1" 2>/dev/null | head -n 1
}

wait_healthy() {
  local id="$1" deadline=$((SECONDS + 180)) status
  while (( SECONDS < deadline )); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${id}" 2>/dev/null || true)"
    [[ "${status}" == "healthy" ]] && return 0
    [[ "${status}" == "exited" || "${status}" == "dead" || "${status}" == "unhealthy" ]] && return 1
    sleep 2
  done
  return 1
}

ensure_infra() {
  echo "==> Garantindo bancos, Redis e auto-recuperação da Evolution..."
  # Sem --force-recreate: serviços saudáveis e sem mudança ficam intactos. Na
  # primeira aplicação desta proteção, só Evolution (config alterada) e o novo
  # autoheal são criados/recriados; os volumes e bancos são preservados.
  "${COMPOSE[@]}" up -d --wait --wait-timeout 180 \
    postgres redis evolution-postgres evolution autoheal
}

rollback() {
  local active previous previous_id active_id
  active="$(running_web)"
  [[ -n "${active}" ]] || { echo "Nenhuma versão web ativa para reverter." >&2; exit 1; }
  [[ "${active}" == "web-blue" ]] && previous="web-green" || previous="web-blue"
  previous_id="$(container_id "${previous}")"
  [[ -n "${previous_id}" ]] || { echo "Não há container anterior preservado para rollback." >&2; exit 1; }

  echo "==> Iniciando ${previous} preservado..."
  docker start "${previous_id}" >/dev/null
  if ! wait_healthy "${previous_id}"; then
    docker stop --time 10 "${previous_id}" >/dev/null 2>&1 || true
    echo "Rollback abortado: a versão anterior não ficou saudável; ${active} continua no ar." >&2
    exit 1
  fi
  sleep "${TRAEFIK_DISCOVERY_SECONDS:-10}"
  active_id="$(container_id "${active}")"
  docker stop --time 30 "${active_id}" >/dev/null
  echo "==> Rollback concluído: ${previous} está saudável e atendendo."
}

deploy_web() {
  local active candidate candidate_id legacy_ids
  active="$(running_web)"
  if [[ "${active}" == "web-blue" ]]; then candidate="web-green"; else candidate="web-blue"; fi

  echo "==> Versão ativa: ${active:-legada ou primeira instalação}"
  echo "==> Preparando ${candidate}; a aplicação atual continua atendendo..."
  prepare_image "${candidate}"

  if [[ "${DEPLOY_DB_PUSH:-0}" == "1" ]]; then
    echo "==> Aplicando schema antes da troca (use somente mudanças retrocompatíveis)..."
    "${COMPOSE[@]}" run --rm --no-deps "${candidate}" npx prisma db execute \
      --file prisma/manual/002-broadcast-retry-index.sql --schema prisma/schema.prisma
    "${COMPOSE[@]}" run --rm --no-deps "${candidate}" npx prisma db execute \
      --file prisma/manual/003-crm-tenant-id-unique.sql --schema prisma/schema.prisma
    "${COMPOSE[@]}" run --rm --no-deps "${candidate}" npx prisma db push
  fi

  echo "==> Subindo ${candidate} em paralelo..."
  if ! "${COMPOSE[@]}" up -d --no-deps --no-build --force-recreate "${candidate}"; then
    echo "A nova versão não iniciou; a atual continua atendendo." >&2
    exit 1
  fi
  candidate_id="$(container_id "${candidate}")"
  if [[ -z "${candidate_id}" ]] || ! wait_healthy "${candidate_id}"; then
    "${COMPOSE[@]}" logs --tail 100 "${candidate}" >&2 || true
    [[ -n "${candidate_id}" ]] && docker stop --time 10 "${candidate_id}" >/dev/null 2>&1 || true
    echo "Deploy abortado: a nova versão não ficou saudável; a atual continua atendendo." >&2
    exit 1
  fi

  echo "==> Nova versão saudável; aguardando descoberta pelo proxy..."
  sleep "${TRAEFIK_DISCOVERY_SECONDS:-10}"

  if [[ -n "${active}" ]]; then
    docker stop --time 30 "$(container_id "${active}")" >/dev/null
  fi

  # Migração transparente do compose antigo, cujo serviço se chamava apenas web.
  legacy_ids="$(docker ps -q --filter label=com.docker.compose.service=web)"
  if [[ -n "${legacy_ids}" ]]; then
    while IFS= read -r id; do docker stop --time 30 "${id}" >/dev/null; done <<<"${legacy_ids}"
  fi

  echo "==> Troca concluída: ${candidate} está saudável e atendendo."
  "${COMPOSE[@]}" ps "${candidate}"
}

deploy_worker() {
  echo "==> Atualizando worker; jobs pendentes permanecem no Redis..."
  prepare_image worker
  "${COMPOSE[@]}" up -d --no-deps --no-build --force-recreate --wait --wait-timeout 180 worker
}

"${COMPOSE[@]}" config -q

case "${MODE}" in
  rollback) rollback ;;
  web) ensure_infra; deploy_web ;;
  worker) ensure_infra; deploy_worker ;;
  all) ensure_infra; deploy_web; deploy_worker ;;
esac

[[ "${MODE}" == "rollback" ]] || prune_old_images
