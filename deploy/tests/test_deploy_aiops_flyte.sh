#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/deploy-aiops-flyte.sh"

if [[ ! -f "$SCRIPT" ]]; then
  printf 'deploy script is missing: %s\n' "$SCRIPT" >&2
  exit 1
fi

output="$(DRY_RUN=1 REMOTE_HOST=aione-flyte2 PROXY_URL=http://172.19.210.24:7890 bash "$SCRIPT")"

assert_contains() {
  local needle="$1"
  if [[ "$output" != *"$needle"* ]]; then
    printf 'expected dry-run output to contain: %s\n' "$needle" >&2
    printf '%s\n' "$output" >&2
    exit 1
  fi
}

assert_contains 'git archive --format=tar HEAD -o'
assert_contains 'scp'
assert_contains 'aione-flyte2'
assert_contains 'REMOTE_ARCHIVE='
assert_contains 'tar -xf "$REMOTE_ARCHIVE"'
assert_contains "PROXY_URL='http://172.19.210.24:7890'"
assert_contains 'export HTTP_PROXY="$PROXY_URL"'
assert_contains 'docker.service.d'
assert_contains '--build-arg HTTP_PROXY="$PROXY_URL"'
assert_contains 'curl -sfL https://get.k3s.io'
assert_contains 'get_helm.sh'
assert_contains 'docker-buildx'
assert_contains 'sudo env DOCKER_BUILDKIT=1 docker build'
assert_contains "IMAGE_REPOSITORY='flyte-binary-v2'"
assert_contains "IMAGE_TAG='ssh-workspace'"
assert_contains 'k3s ctr images import'
assert_contains 'import_docker_image rancher/mirrored-coredns-coredns:1.14.3'
assert_contains 'import_docker_image rancher/mirrored-library-busybox:1.37.0'
assert_contains 'import_docker_image rancher/mirrored-library-traefik:3.6.13'
assert_contains 'kubectl -n kube-system rollout status deploy/traefik'
assert_contains 'chown -R 10001:10001 /var/lib/flyte/storage/rustfs'
assert_contains 'import_docker_image postgres:17'
assert_contains 'CREATE DATABASE runs'
assert_contains 'kubectl -n "$NAMESPACE" rollout status deploy/postgresql'
assert_contains 'helm upgrade --install "$RELEASE" charts/flyte-devbox'
assert_contains '--set docker-registry.enabled=false'
assert_contains '--set flyte-binary.console.image.repository=ghcr.io/unionai-oss/flyteconsole-v2'
assert_contains '--set knative-serving.enabled=false'
assert_contains 'kubectl -n "$NAMESPACE" rollout status deploy/flyte-binary-console'
assert_contains 'kubectl -n "$NAMESPACE" rollout status deploy/rustfs'
assert_contains 'kubectl -n "$NAMESPACE" rollout status deploy/flyte-binary'
assert_contains 'Ingress access:'
assert_contains 'Web UI: http://%s:%s/v2'
assert_contains 'API endpoint: http://%s:%s'

printf 'PASS tests/test_deploy_aiops_flyte.sh\n'
