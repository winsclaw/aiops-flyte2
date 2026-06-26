#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-aione-flyte2}"
REMOTE_DIR="${REMOTE_DIR:-flyte-work}"
NAMESPACE="${NAMESPACE:-flyte}"
RELEASE="${RELEASE:-flyte-devbox}"
IMAGE_REPOSITORY="${IMAGE_REPOSITORY:-flyte-binary-v2}"
IMAGE_TAG_PREFIX="${IMAGE_TAG_PREFIX:-main-}"
IMAGE_TAG_KEEP="${IMAGE_TAG_KEEP:-3}"
IMAGE_TAG="${IMAGE_TAG:-${IMAGE_TAG_PREFIX}$(git rev-parse --short HEAD)}"
NERDCTL_VERSION="${NERDCTL_VERSION:-2.3.3}"
PROXY_URL="${PROXY_URL:-}"
DRY_RUN="${DRY_RUN:-0}"

shell_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

remote_env() {
  printf "REMOTE_HOST=%s REMOTE_DIR=%s NAMESPACE=%s RELEASE=%s IMAGE_REPOSITORY=%s IMAGE_TAG=%s IMAGE_TAG_PREFIX=%s IMAGE_TAG_KEEP=%s NERDCTL_VERSION=%s PROXY_URL=%s" \
    "$(shell_quote "$REMOTE_HOST")" \
    "$(shell_quote "$REMOTE_DIR")" \
    "$(shell_quote "$NAMESPACE")" \
    "$(shell_quote "$RELEASE")" \
    "$(shell_quote "$IMAGE_REPOSITORY")" \
    "$(shell_quote "$IMAGE_TAG")" \
    "$(shell_quote "$IMAGE_TAG_PREFIX")" \
    "$(shell_quote "$IMAGE_TAG_KEEP")" \
    "$(shell_quote "$NERDCTL_VERSION")" \
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

install_nerdctl_full() {
  local version="${NERDCTL_VERSION:-2.3.3}"
  local arch
  case "$(uname -m)" in
    x86_64|amd64) arch="amd64" ;;
    aarch64|arm64) arch="arm64" ;;
    *)
      printf 'unsupported architecture for nerdctl-full install: %s\n' "$(uname -m)" >&2
      return 1
      ;;
  esac

  local archive="/tmp/nerdctl-full-${version}-linux-${arch}.tar.gz"
  local url="https://github.com/containerd/nerdctl/releases/download/v${version}/nerdctl-full-${version}-linux-${arch}.tar.gz"
  curl -fL --retry 3 --retry-delay 2 -o "$archive" "$url"
  sudo tar -xzf "$archive" -C /usr/local \
    bin/nerdctl \
    bin/buildctl \
    bin/buildkitd \
    bin/buildkit-cni-bridge \
    bin/buildkit-cni-firewall \
    bin/buildkit-cni-host-local \
    bin/buildkit-cni-loopback \
    bin/buildkit-cni-portmap \
    libexec/cni/bridge \
    libexec/cni/firewall \
    libexec/cni/host-local \
    libexec/cni/loopback \
    libexec/cni/portmap
  sudo chmod +x /usr/local/bin/nerdctl /usr/local/bin/buildctl /usr/local/bin/buildkitd
  sudo chmod +x /usr/local/libexec/cni/bridge /usr/local/libexec/cni/firewall /usr/local/libexec/cni/host-local /usr/local/libexec/cni/loopback /usr/local/libexec/cni/portmap
  rm -f "$archive"
}

ensure_buildkit_k3s() {
  if [[ ! -x /usr/local/bin/nerdctl || ! -x /usr/local/bin/buildctl || ! -x /usr/local/bin/buildkitd ]]; then
    sudo apt-get update
    sudo apt-get install -y ca-certificates curl
    install_nerdctl_full
  fi

  sudo tee /etc/systemd/system/buildkit-k3s.service >/dev/null <<'EOF'
[Unit]
Description=BuildKit daemon for k3s containerd
After=k3s.service
Requires=k3s.service

[Service]
Type=simple
ExecStartPre=/bin/mkdir -p /run/buildkit
ExecStart=/usr/local/bin/buildkitd --addr unix:///run/buildkit/buildkitd.sock --oci-worker=false --containerd-worker=true --containerd-worker-addr=/run/k3s/containerd/containerd.sock --containerd-worker-snapshotter=overlayfs --containerd-worker-net=host
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

  if [[ -n "${PROXY_URL:-}" ]]; then
    sudo mkdir -p /etc/systemd/system/buildkit-k3s.service.d
    sudo tee /etc/systemd/system/buildkit-k3s.service.d/proxy.conf >/dev/null <<EOF
[Service]
Environment="HTTP_PROXY=$PROXY_URL"
Environment="HTTPS_PROXY=$PROXY_URL"
Environment="NO_PROXY=$NO_PROXY"
EOF
  else
    sudo rm -rf /etc/systemd/system/buildkit-k3s.service.d
  fi

  sudo systemctl daemon-reload
  sudo systemctl enable --now buildkit-k3s.service
  sudo systemctl restart buildkit-k3s.service
  sudo /usr/local/bin/buildctl --addr unix:///run/buildkit/buildkitd.sock debug workers >/dev/null
}

ensure_buildkit_k3s

cd "$REMOTE_DIR"
export BUILDKIT_HOST="${BUILDKIT_HOST:-unix:///run/buildkit/buildkitd.sock}"
NERDCTL=(sudo env HTTP_PROXY="${HTTP_PROXY:-}" HTTPS_PROXY="${HTTPS_PROXY:-}" http_proxy="${http_proxy:-}" https_proxy="${https_proxy:-}" NO_PROXY="${NO_PROXY:-}" no_proxy="${no_proxy:-}" /usr/local/bin/nerdctl --address /run/k3s/containerd/containerd.sock --namespace k8s.io)
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
"${NERDCTL[@]}" build "${build_proxy_args[@]}" -t "${IMAGE_REPOSITORY}:${IMAGE_TAG}" -f Dockerfile .

prune_old_release_images() {
  if [[ "$IMAGE_TAG" != "$IMAGE_TAG_PREFIX"* ]]; then
    printf 'Skipping release image pruning for non-release tag: %s\n' "$IMAGE_TAG"
    return 0
  fi
  if ! [[ "$IMAGE_TAG_KEEP" =~ ^[0-9]+$ ]] || (( IMAGE_TAG_KEEP < 1 )); then
    printf 'IMAGE_TAG_KEEP must be a positive integer, got: %s\n' "$IMAGE_TAG_KEEP" >&2
    return 1
  fi

  local keep_file
  keep_file="$(mktemp)"
  {
    "${NERDCTL[@]}" images --format '{{.Repository}}:{{.Tag}}|{{.CreatedAt}}' \
      | awk -F '|' -v repository="${IMAGE_REPOSITORY}" -v tag_prefix="${IMAGE_TAG_PREFIX}" '
        {
          repo_tag = $1
          tag = substr(repo_tag, length(repository) + 2)
          if (repo_tag == repository ":" tag && index(tag, tag_prefix) == 1 && $2 != "") {
            printf "%s\t%s\n", $2, tag
          }
        }'
    printf '9999-12-31T23:59:59Z|%s\n' "$IMAGE_TAG"
  } | sort -t '|' -k1,1 \
    | awk -F '|' '{rows[$2] = $0} END {for (tag in rows) print rows[tag]}' \
    | sort -t '|' -k1,1 \
    | tail -n "$IMAGE_TAG_KEEP" \
    | awk -F '|' '{print $2}' > "$keep_file"

  sudo k3s ctr images ls -q \
    | while IFS= read -r image; do
        case "$image" in
          "${IMAGE_REPOSITORY}:${IMAGE_TAG_PREFIX}"*|*/"${IMAGE_REPOSITORY}:${IMAGE_TAG_PREFIX}"*)
            tag="${image##*:}"
            if ! grep -Fxq "$tag" "$keep_file"; then
              sudo k3s ctr images rm "$image" || true
            fi
            ;;
        esac
      done

  rm -f "$keep_file"
}

pull_containerd_image() {
  local image="$1"
  "${NERDCTL[@]}" pull "$image"
}

pull_containerd_image rancher/mirrored-pause:3.6
pull_containerd_image rancher/mirrored-coredns-coredns:1.14.3
pull_containerd_image rancher/local-path-provisioner:v0.0.36
pull_containerd_image rancher/mirrored-library-busybox:1.37.0
pull_containerd_image rancher/mirrored-library-traefik:3.6.13
pull_containerd_image postgres:17
pull_containerd_image ghcr.io/unionai-oss/flyteconsole-v2:latest
pull_containerd_image rustfs/rustfs:1.0.0-alpha.94
pull_containerd_image busybox:stable

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
  --set flyte-binary.configuration.co-pilot.image.repository="$IMAGE_REPOSITORY" \
  --set flyte-binary.configuration.co-pilot.image.tag="$IMAGE_TAG" \
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
prune_old_release_images
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
