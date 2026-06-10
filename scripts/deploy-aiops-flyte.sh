#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-aiops-deploy}"
REMOTE_DIR="${REMOTE_DIR:-flyte-work}"
NAMESPACE="${NAMESPACE:-flyte}"
RELEASE="${RELEASE:-flyte-devbox}"
IMAGE_REPOSITORY="${IMAGE_REPOSITORY:-flyte-binary-v2}"
IMAGE_TAG="${IMAGE_TAG:-ssh-workspace}"
PROXY_URL="${PROXY_URL:-}"
DRY_RUN="${DRY_RUN:-0}"

shell_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

remote_env() {
  printf "REMOTE_HOST=%s REMOTE_DIR=%s NAMESPACE=%s RELEASE=%s IMAGE_REPOSITORY=%s IMAGE_TAG=%s PROXY_URL=%s" \
    "$(shell_quote "$REMOTE_HOST")" \
    "$(shell_quote "$REMOTE_DIR")" \
    "$(shell_quote "$NAMESPACE")" \
    "$(shell_quote "$RELEASE")" \
    "$(shell_quote "$IMAGE_REPOSITORY")" \
    "$(shell_quote "$IMAGE_TAG")" \
    "$(shell_quote "$PROXY_URL")"
}

if command -v scp.exe >/dev/null 2>&1 && command -v ssh.exe >/dev/null 2>&1 && command -v wslpath >/dev/null 2>&1; then
  SSH_BIN=ssh.exe
  SCP_BIN=scp.exe
  local_path_for_transport() {
    wslpath -w "$1"
  }
else
  SSH_BIN=ssh
  SCP_BIN=scp
  local_path_for_transport() {
    printf '%s' "$1"
  }
fi

remote_script="$(cat <<'REMOTE_SCRIPT'
set -euo pipefail

if [[ -z "${REMOTE_DIR:-}" ]]; then
  REMOTE_DIR="flyte-work"
fi
if [[ "$REMOTE_DIR" != /* ]]; then
  REMOTE_DIR="$HOME/$REMOTE_DIR"
fi
if [[ -n "${REMOTE_ARCHIVE:-}" ]]; then
  rm -rf "$REMOTE_DIR"
  mkdir -p "$REMOTE_DIR"
  tar -xf "$REMOTE_ARCHIVE" -C "$REMOTE_DIR"
  rm -f "$REMOTE_ARCHIVE"
fi

if [[ -n "${PROXY_URL:-}" ]]; then
  export HTTP_PROXY="$PROXY_URL"
  export HTTPS_PROXY="$PROXY_URL"
  export http_proxy="$PROXY_URL"
  export https_proxy="$PROXY_URL"
  export NO_PROXY="${NO_PROXY:-127.0.0.1,localhost,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,.svc,.cluster.local}"
  export no_proxy="$NO_PROXY"
fi

if ! command -v k3s >/dev/null 2>&1; then
  curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="server --write-kubeconfig-mode=644" sh -
fi

export KUBECONFIG="${KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"
sudo k3s kubectl get nodes

if ! command -v helm >/dev/null 2>&1; then
  curl -fsSL -o /tmp/get_helm.sh https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3
  chmod 700 /tmp/get_helm.sh
  /tmp/get_helm.sh
fi

if ! command -v docker >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl gnupg docker.io
  sudo usermod -aG docker "$USER" || true
fi

sudo systemctl enable --now docker || true

cd "$REMOTE_DIR"
docker build -t "${IMAGE_REPOSITORY}:${IMAGE_TAG}" -f Dockerfile .
tmp_image="/tmp/${IMAGE_REPOSITORY}-${IMAGE_TAG}.tar"
docker save "${IMAGE_REPOSITORY}:${IMAGE_TAG}" -o "$tmp_image"
sudo k3s ctr images import "$tmp_image"

sudo k3s kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | sudo k3s kubectl apply -f -
helm dependency update charts/flyte-devbox
helm upgrade --install "$RELEASE" charts/flyte-devbox \
  --namespace "$NAMESPACE" \
  --set flyte-binary.deployment.image.repository="$IMAGE_REPOSITORY" \
  --set flyte-binary.deployment.image.tag="$IMAGE_TAG" \
  --set flyte-binary.deployment.image.pullPolicy=Never

kubectl -n "$NAMESPACE" rollout status deploy/flyte-binary --timeout=10m
kubectl -n "$NAMESPACE" get svc,pod
printf '\nLocal web UI tunnel command:\n'
printf 'ssh -L 8088:127.0.0.1:8088 %s "kubectl -n %s port-forward svc/flyte-binary-http 8088:80"\n' "${REMOTE_HOST}" "${NAMESPACE}"
printf 'Then open http://localhost:8088\n'
REMOTE_SCRIPT
)"

ssh_env="$(remote_env)"
archive_name="flyte-work-$(date +%s)-$$.tar"
local_archive="${TMPDIR:-/tmp}/$archive_name"
local_runner="${TMPDIR:-/tmp}/flyte-deploy-$(date +%s)-$$.sh"
remote_archive="/tmp/$archive_name"
remote_runner="/tmp/flyte-deploy-$(date +%s)-$$.sh"

if [[ "$DRY_RUN" == "1" ]]; then
  printf 'git archive --format=tar HEAD -o %s\n' "$local_archive"
  printf '%s %s %s:%s\n' "$SCP_BIN" "$(local_path_for_transport "$local_archive")" "$REMOTE_HOST" "$remote_archive"
  printf '%s %s %s:%s\n' "$SCP_BIN" "$(local_path_for_transport "$local_runner")" "$REMOTE_HOST" "$remote_runner"
  printf '%s %s %s REMOTE_ARCHIVE=%s bash %s\n' "$SSH_BIN" "$REMOTE_HOST" "$ssh_env" "$(shell_quote "$remote_archive")" "$(shell_quote "$remote_runner")"
  printf '%s\n' "$remote_script"
  exit 0
fi

trap 'rm -f "$local_archive" "$local_runner"' EXIT
git archive --format=tar HEAD -o "$local_archive"
printf '%s\n' "$remote_script" > "$local_runner"
"$SCP_BIN" "$(local_path_for_transport "$local_archive")" "$REMOTE_HOST:$remote_archive"
"$SCP_BIN" "$(local_path_for_transport "$local_runner")" "$REMOTE_HOST:$remote_runner"
"$SSH_BIN" "$REMOTE_HOST" "$ssh_env REMOTE_ARCHIVE=$(shell_quote "$remote_archive") bash $(shell_quote "$remote_runner")"
