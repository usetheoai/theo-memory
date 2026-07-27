#!/usr/bin/env bash
# Instalador do reconciliador pull-based. Roda NO dev host, uma vez.
#
#   ssh paulo@<DEV_HOST>
#   cd /home/paulo/theo-data-plane/theo-memory
#   read -rsp 'PAT: ' PAT && echo && printf '%s' "$PAT" | ./scripts/install-reconciler.sh && unset PAT
#
# O PAT É LIDO DE STDIN, NUNCA DE ARGV. Argumento de linha de comando aparece em `ps` para
# qualquer usuário do box — e este box é COMPARTILHADO com outros stacks. Ele também não é
# ecoado, não vai para o histórico do shell (o `read -rs` acima) e nunca é escrito em disco em
# claro por este script: quem persiste é o `docker login`, no formato do próprio docker.
#
# PAT NECESSÁRIO: fine-grained, permissão `read:packages`, com acesso ao pacote
# `usetheoai/themory`. Leitura apenas — este agente nunca publica.
#
# ROTAÇÃO: PAT fine-grained EXPIRA (o GitHub exige data de validade). Quando expirar, o pull passa
# a falhar e o `dev-version-drift` fica vermelho apontando host defasado — o sintoma será real,
# mas a causa é a credencial. Reexecute este script com um PAT novo.
set -euo pipefail

DIR="${THEMORY_DIR:-/home/paulo/theo-data-plane/theo-memory}"
IMAGE="${THEMORY_IMAGE:-ghcr.io/usetheoai/themory:develop}"
GH_USER="${GH_USER:-usetheodev}"
DOCKER_CFG="${HOME}/.config/themory-reconcile/docker"
UNIT_DIR="${HOME}/.config/systemd/user"

echo "==> instalando reconciliador em ${DIR}"

if [ -t 0 ]; then
  echo "ERRO: nada em stdin. O PAT deve ser enviado por pipe, não digitado como argumento." >&2
  echo "      Uso: printf '%s' \"\$PAT\" | $0" >&2
  exit 1
fi
PAT="$(cat)"
if [ -z "${PAT}" ]; then
  echo "ERRO: PAT vazio." >&2
  exit 1
fi

# --- 1. Credencial isolada do config padrão do docker. ---
# O deploy do CI faz `docker login` em ~/.docker/config.json com um GITHUB_TOKEN efêmero e
# SOBRESCREVE a entrada `ghcr.io`. Se o agente compartilhasse esse arquivo, todo deploy apagaria
# este PAT e o reconciliador morreria em silêncio. Store próprio = as duas credenciais coexistem.
mkdir -p "${DOCKER_CFG}"
chmod 700 "${HOME}/.config/themory-reconcile" "${DOCKER_CFG}"
echo "==> autenticando no ghcr.io (store isolado: ${DOCKER_CFG})"
printf '%s' "${PAT}" | DOCKER_CONFIG="${DOCKER_CFG}" docker login ghcr.io -u "${GH_USER}" --password-stdin
unset PAT
chmod 600 "${DOCKER_CFG}/config.json"

# --- 2. Prova que a credencial serve ANTES de instalar o timer. ---
# Instalar um agente que não consegue puxar produziria uma falha a cada 5 min no journal e nenhuma
# reconciliação — exatamente o tipo de "instalado mas quebrado" que este projeto combate.
echo "==> validando pull de ${IMAGE}"
if ! DOCKER_CONFIG="${DOCKER_CFG}" docker pull -q "${IMAGE}" >/dev/null; then
  echo "ERRO: pull falhou com este PAT. Confira o escopo read:packages e o acesso ao pacote." >&2
  exit 1
fi
echo "    pull OK"

# --- 3. Units. ---
mkdir -p "${UNIT_DIR}"
install -m 644 "${DIR}/deploy/systemd/themory-reconcile.service" "${UNIT_DIR}/"
install -m 644 "${DIR}/deploy/systemd/themory-reconcile.timer" "${UNIT_DIR}/"
chmod +x "${DIR}/scripts/reconcile-dev.sh"

systemctl --user daemon-reload
systemctl --user enable --now themory-reconcile.timer

# `linger` faz o timer disparar sem ninguém logado. Sem isto o agente só roda enquanto houver
# sessão aberta — e um reconciliador que dorme quando você desconecta não reconcilia nada.
if [ "$(loginctl show-user "$(id -un)" --property=Linger --value 2>/dev/null)" != "yes" ]; then
  echo "==> habilitando linger (timer precisa rodar sem sessão aberta)"
  sudo loginctl enable-linger "$(id -un)"
fi

echo
echo "==> instalado. Verificação:"
systemctl --user list-timers themory-reconcile.timer --no-pager || true
echo
echo "    execução manual : systemctl --user start themory-reconcile.service"
echo "    logs            : journalctl --user -u themory-reconcile -f"
echo "    desinstalar     : systemctl --user disable --now themory-reconcile.timer"
