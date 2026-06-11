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

if ! command -v docker >/dev/null 2>&1 || ! docker buildx version >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl gnupg docker.io docker-buildx
  sudo usermod -aG docker "$USER" || true
fi

if [[ -n "${PROXY_URL:-}" ]]; then
  sudo mkdir -p /etc/systemd/system/docker.service.d
  sudo tee /etc/systemd/system/docker.service.d/http-proxy.conf >/dev/null <<EOF
[Service]
Environment="HTTP_PROXY=$PROXY_URL"
Environment="HTTPS_PROXY=$PROXY_URL"
Environment="NO_PROXY=$NO_PROXY"
EOF
  sudo systemctl daemon-reload
  sudo systemctl restart docker
fi

sudo systemctl enable --now docker || true

cd "$REMOTE_DIR"
build_proxy_args=()
if [[ -n "${PROXY_URL:-}" ]]; then
  build_proxy_args+=(
    --build-arg HTTP_PROXY="$PROXY_URL"
    --build-arg HTTPS_PROXY="$PROXY_URL"
    --build-arg http_proxy="$PROXY_URL"
    --build-arg https_proxy="$PROXY_URL"
    --build-arg NO_PROXY="$NO_PROXY"
    --build-arg no_proxy="$NO_PROXY"
  )
fi
sudo env DOCKER_BUILDKIT=1 docker build "${build_proxy_args[@]}" -t "${IMAGE_REPOSITORY}:${IMAGE_TAG}" -f Dockerfile .
tmp_image="/tmp/${IMAGE_REPOSITORY}-${IMAGE_TAG}.tar"
sudo docker save "${IMAGE_REPOSITORY}:${IMAGE_TAG}" -o "$tmp_image"
sudo k3s ctr images import "$tmp_image"

import_docker_image() {
  local image="$1"
  local safe_name
  safe_name="$(printf '%s' "$image" | tr '/:' '__')"
  local image_tar="/tmp/${safe_name}.tar"
  sudo docker pull "$image"
  sudo docker save "$image" -o "$image_tar"
  sudo k3s ctr images import "$image_tar"
  sudo rm -f "$image_tar"
}

import_docker_image rancher/mirrored-pause:3.6
import_docker_image rancher/mirrored-coredns-coredns:1.14.3
import_docker_image rancher/local-path-provisioner:v0.0.36
import_docker_image rancher/mirrored-library-busybox:1.37.0
import_docker_image rancher/mirrored-library-traefik:3.6.13
import_docker_image postgres:17
import_docker_image ghcr.io/unionai-oss/flyteconsole-v2:latest
import_docker_image rustfs/rustfs:1.0.0-alpha.94
import_docker_image busybox:stable

sudo k3s kubectl -n kube-system delete pod -l k8s-app=kube-dns --ignore-not-found || true
sudo k3s kubectl -n kube-system delete pod -l app=local-path-provisioner --ignore-not-found || true
if sudo k3s kubectl -n kube-system get deploy/traefik >/dev/null 2>&1; then
  sudo k3s kubectl -n kube-system rollout restart deploy/traefik
fi
kubectl -n kube-system rollout status deploy/coredns --timeout=5m
kubectl -n kube-system rollout status deploy/local-path-provisioner --timeout=5m
if sudo k3s kubectl -n kube-system get deploy/traefik >/dev/null 2>&1; then
  kubectl -n kube-system rollout status deploy/traefik --timeout=5m
fi

sudo mkdir -p /var/lib/flyte/storage/rustfs
sudo chown -R 10001:10001 /var/lib/flyte/storage/rustfs

sudo k3s kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | sudo k3s kubectl apply -f -
sudo k3s kubectl -n "$NAMESPACE" apply -f - <<POSTGRES_MANIFEST
apiVersion: v1
kind: ConfigMap
metadata:
  name: postgresql-init
data:
  init.sql: |
    CREATE DATABASE runs;
---
apiVersion: v1
kind: Service
metadata:
  name: postgresql
spec:
  selector:
    app: postgresql
  ports:
    - name: postgresql
      port: 5432
      targetPort: 5432
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: postgresql
spec:
  replicas: 1
  selector:
    matchLabels:
      app: postgresql
  template:
    metadata:
      labels:
        app: postgresql
    spec:
      containers:
        - name: postgresql
          image: postgres:17
          imagePullPolicy: Never
          env:
            - name: POSTGRES_USER
              value: postgres
            - name: POSTGRES_PASSWORD
              value: postgres
            - name: POSTGRES_DB
              value: flyte
          ports:
            - containerPort: 5432
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
            - name: init
              mountPath: /docker-entrypoint-initdb.d
      volumes:
        - name: data
          emptyDir: {}
        - name: init
          configMap:
            name: postgresql-init
POSTGRES_MANIFEST
kubectl -n "$NAMESPACE" rollout status deploy/postgresql --timeout=5m
helm dependency update charts/flyte-devbox
helm upgrade --install "$RELEASE" charts/flyte-devbox \
  --namespace "$NAMESPACE" \
  --set docker-registry.enabled=false \
  --set flyte-binary.deployment.image.repository="$IMAGE_REPOSITORY" \
  --set flyte-binary.deployment.image.tag="$IMAGE_TAG" \
  --set flyte-binary.deployment.image.pullPolicy=Never \
  --set flyte-binary.deployment.waitForDB.image.repository=postgres \
  --set-string flyte-binary.deployment.waitForDB.image.tag=17 \
  --set flyte-binary.deployment.waitForDB.image.pullPolicy=Never \
  --set flyte-binary.console.image.repository=ghcr.io/unionai-oss/flyteconsole-v2 \
  --set flyte-binary.console.image.tag=latest \
  --set flyte-binary.console.image.pullPolicy=Never \
  --set rustfs.image.repository=rustfs/rustfs \
  --set rustfs.image.tag=1.0.0-alpha.94 \
  --set knative-serving.enabled=false

kubectl -n "$NAMESPACE" rollout status deploy/flyte-binary-console --timeout=5m
kubectl -n "$NAMESPACE" rollout status deploy/rustfs --timeout=5m
kubectl -n "$NAMESPACE" rollout status deploy/flyte-binary --timeout=10m
kubectl -n "$NAMESPACE" get svc,pod
node_ip="$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')"
ingress_port="$(kubectl -n kube-system get svc traefik -o jsonpath='{.spec.ports[?(@.port==80)].nodePort}')"
printf '\nIngress access:\n'
printf 'Web UI: http://%s:%s/v2\n' "$node_ip" "$ingress_port"
printf 'API endpoint: http://%s:%s\n' "$node_ip" "$ingress_port"
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
