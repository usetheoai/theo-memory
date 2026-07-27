#!/usr/bin/env bash
# Reconciliador PULL-BASED do dev host. Roda NO host, disparado por um systemd timer de usuário
# (`themory-reconcile.timer`), NÃO pelo CI.
#
# POR QUE ISTO EXISTE. O `deploy-dev.sh` é push-based: o CI empurra uma versão e verifica UMA VEZ.
# Depois disso ninguém reconcilia — se um container reiniciar de imagem antiga, se alguém der um
# `docker compose up` manual neste box compartilhado, ou se um deploy falhar sem sucessor, o
# ambiente fica defasado em silêncio. O gate `dev-version-drift` DETECTA isso de hora em hora, mas
# não corrige. Este script é a metade que corrige: o host converge sozinho para a tag `:develop`.
#
# O QUE ELE NÃO É: não é GitOps. O estado desejado aqui é "o que a tag `:develop` aponta agora",
# não "o que o git declara". Reconciliação declarativa contra o repositório exigiria um controlador
# tipo ArgoCD, que é Kubernetes — este ambiente é Docker Compose. A diferença importa: um rollback
# feito movendo a tag é obedecido por este script sem deixar rastro no git.
#
# IDEMPOTENTE POR CONSTRUÇÃO: só recria container quando a imagem puxada difere da que está
# rodando. Rodar de 5 em 5 minutos sem novidade não reinicia nada e não gera ruído.
set -euo pipefail

DIR="${THEMORY_DIR:-/home/paulo/theo-data-plane/theo-memory}"
PORT="${THEMORY_PORT:-8080}"
IMAGE="${THEMORY_IMAGE:-ghcr.io/usetheoai/themory:develop}"
STATE_DIR="${XDG_STATE_HOME:-${HOME}/.local/state}/themory-reconcile"

# CREDENCIAL ISOLADA — a razão mais importante deste bloco.
#
# O job `deploy-dev` do CI faz `docker login ghcr.io` com o `secrets.GITHUB_TOKEN`, que é EFÊMERO
# (morre no fim do run) e SOBRESCREVE a entrada `ghcr.io` em `~/.docker/config.json`. Se este
# reconciliador usasse o config padrão, todo deploy do CI apagaria o PAT e o agente passaria a
# falhar em silêncio até alguém investigar. Um DOCKER_CONFIG próprio mantém as duas credenciais
# vivas e independentes: o CI usa a dele, este script usa a dele.
export DOCKER_CONFIG="${THEMORY_DOCKER_CONFIG:-${HOME}/.config/themory-reconcile/docker}"

COMPOSE=(docker compose -f docker-compose.yaml -f docker-compose.deploy.yml)
mkdir -p "${STATE_DIR}"
cd "${DIR}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

if [ ! -s "${DOCKER_CONFIG}/config.json" ]; then
  log "ERRO: sem credencial em ${DOCKER_CONFIG}/config.json — rode scripts/install-reconciler.sh"
  exit 1
fi

# --- 1. Puxa a tag. Falha de rede/credencial NÃO deve derrubar o que está rodando. ---
if ! "${COMPOSE[@]}" pull -q themory themory_mcp 2>/dev/null; then
  log "ERRO: pull de ${IMAGE} falhou (rede ou credencial expirada). Containers atuais intocados."
  exit 1
fi

DESIRED="$(docker image inspect "${IMAGE}" --format '{{.Id}}' 2>/dev/null || echo '')"
if [ -z "${DESIRED}" ]; then
  log "ERRO: imagem ${IMAGE} ausente localmente mesmo após pull."
  exit 1
fi

# --- 2. Compara com o que está EM EXECUÇÃO, container a container. ---
# Gatear os dois é deliberado: `themory_mcp` é a superfície MCP servida pelo gateway e roda a MESMA
# imagem sob outro verbo. Reconciliar só o app deixaria o MCP servindo build antiga em silêncio —
# a mesma armadilha que o version gate do deploy já cobre.
NEEDS_RECREATE=0
for container in themory_app themory_mcp; do
  RUNNING="$(docker inspect "${container}" --format '{{.Image}}' 2>/dev/null || echo 'ausente')"
  if [ "${RUNNING}" != "${DESIRED}" ]; then
    log "divergência: ${container} roda '${RUNNING:0:19}', desejado '${DESIRED:0:19}'"
    NEEDS_RECREATE=1
  fi
done

if [ "${NEEDS_RECREATE}" -eq 0 ]; then
  log "em dia — ambos os containers rodam ${DESIRED:0:19}; nada a fazer."
  exit 0
fi

# --- 3. GUARDA ANTI-FLAP: não reaplica uma imagem que já provou não subir. ---
# Sem isto, uma imagem quebrada publicada em `:develop` faria o timer recriar os containers a cada
# 5 minutos, indefinidamente — trocando um ambiente defasado (ruim) por um ambiente em restart loop
# (pior), e afogando o journal. Registrado o digest que falhou, o agente para de tentar ATÉ QUE UM
# DIGEST NOVO apareça — ou seja, até alguém publicar um fix.
FAILED_MARKER="${STATE_DIR}/last-failed-digest"
if [ -f "${FAILED_MARKER}" ] && [ "$(cat "${FAILED_MARKER}")" = "${DESIRED}" ]; then
  log "ERRO: ${DESIRED:0:19} já falhou o health gate antes; não vou entrar em restart loop."
  log "      Publique um digest novo, ou remova ${FAILED_MARKER} para forçar nova tentativa."
  exit 1
fi

log "reconciliando para ${DESIRED:0:19}"
"${COMPOSE[@]}" up -d pgvector themory themory_mcp

# --- 4. Health gate — mesmos critérios do deploy push-based, para os dois caminhos concordarem. ---
# `/v1/health` é liveness; `/v1/health/db` é readiness (prova que alcança o Postgres). O MCP fala
# TLS e não HTTP/JSON, então é gateado pelo healthcheck do próprio container.
for _ in $(seq 1 30); do
  MCP_HEALTH="$(docker inspect themory_mcp --format '{{.State.Health.Status}}' 2>/dev/null || echo missing)"
  if curl -fsS "http://127.0.0.1:${PORT}/v1/health" >/dev/null 2>&1 \
    && curl -fsS "http://127.0.0.1:${PORT}/v1/health/db" >/dev/null 2>&1 \
    && [ "${MCP_HEALTH}" = "healthy" ]; then
    rm -f "${FAILED_MARKER}"
    SHA="$(curl -fsS "http://127.0.0.1:${PORT}/v1/version" 2>/dev/null | sed -n 's/.*"git_sha":"\([^"]*\)".*/\1/p')"
    log "OK — reconciliado. /v1/health + /v1/health/db verdes, mcp healthy, git_sha=${SHA:-desconhecido}"
    exit 0
  fi
  sleep 2
done

# Marca o digest ANTES de sair, para a guarda anti-flap valer no próximo tick.
printf '%s' "${DESIRED}" > "${FAILED_MARKER}"
log "ERRO: health gate não ficou verde em 60 s após reconciliar (mcp: ${MCP_HEALTH:-desconhecido})."
log "      Digest ${DESIRED:0:19} marcado como ruim; sem novas tentativas até mudar."
"${COMPOSE[@]}" logs --tail=30 themory || true
"${COMPOSE[@]}" logs --tail=30 themory_mcp || true
exit 1
