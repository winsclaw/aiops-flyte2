#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/deploy-aiops-flyte.sh"

if [[ ! -f "$SCRIPT" ]]; then
  printf 'deploy script is missing: %s\n' "$SCRIPT" >&2
  exit 1
fi

output="$(DRY_RUN=1 REMOTE_HOST=aiops-deploy PROXY_URL=http://172.19.210.24:7890 bash "$SCRIPT")"

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
assert_contains 'ssh aiops-deploy'
assert_contains 'tar -xf "$REMOTE_ARCHIVE"'
assert_contains "PROXY_URL='http://172.19.210.24:7890'"
assert_contains 'export HTTP_PROXY="$PROXY_URL"'
assert_contains 'curl -sfL https://get.k3s.io'
assert_contains 'get_helm.sh'
assert_contains 'docker build'
assert_contains "IMAGE_REPOSITORY='flyte-binary-v2'"
assert_contains "IMAGE_TAG='ssh-workspace'"
assert_contains 'k3s ctr images import'
assert_contains 'helm upgrade --install "$RELEASE" charts/flyte-devbox'
assert_contains 'kubectl -n "$NAMESPACE" rollout status deploy/flyte-binary'
assert_contains 'port-forward svc/flyte-binary-http 8088:80'

printf 'PASS tests/test_deploy_aiops_flyte.sh\n'
