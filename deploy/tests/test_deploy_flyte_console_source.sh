#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/deploy-flyte-console-source.sh"

if [[ ! -f "$SCRIPT" ]]; then
  printf 'frontend deploy script is missing: %s\n' "$SCRIPT" >&2
  exit 1
fi

output="$(
  DRY_RUN=1 REMOTE_HOST=aione-flyte2 REMOTE_DIR=/opt/aiops-flyte2 PROXY_URL=http://172.19.210.24:7890 \
    bash "$SCRIPT"
)"

assert_contains() {
  local needle="$1"
  if [[ "$output" != *"$needle"* ]]; then
    printf 'expected dry-run output to contain: %s\n' "$needle" >&2
    printf '%s\n' "$output" >&2
    exit 1
  fi
}

assert_not_contains() {
  local needle="$1"
  if [[ "$output" == *"$needle"* ]]; then
    printf 'expected dry-run output not to contain: %s\n' "$needle" >&2
    printf '%s\n' "$output" >&2
    exit 1
  fi
}

assert_contains 'aione-flyte2'
assert_contains "REMOTE_DIR='/opt/aiops-flyte2'"
assert_contains "CONSOLE_URL='http://172.19.65.230:30081/v2/projects'"
assert_contains 'git pull --ff-only origin main'
assert_contains 'ensure_buildkit_k3s'
assert_contains 'NERDCTL=(sudo env HTTP_PROXY="${HTTP_PROXY:-}"'
assert_contains '/usr/local/bin/nerdctl --address /run/k3s/containerd/containerd.sock --namespace k8s.io)'
assert_contains '"${NERDCTL[@]}" build "${build_proxy_args[@]}" -f flyte_console/Dockerfile -t "flyte-console-source:${COMMIT}" -t flyte-console-extracted:latest flyte_console'
assert_contains 'k3s ctr -n k8s.io images ls | grep -E'
assert_contains 'kubectl apply -f deploy/ui/flyte-console-extracted.yaml'
assert_contains 'kubectl -n "$NAMESPACE" rollout restart deploy/flyte-console-extracted'
assert_contains 'kubectl -n "$NAMESPACE" rollout status deploy/flyte-console-extracted --timeout=180s'
assert_contains 'curl -I "$CONSOLE_URL"'
assert_not_contains 'docker build'
assert_not_contains 'docker save'
assert_not_contains 'k3s ctr images import'

printf 'PASS tests/test_deploy_flyte_console_source.sh\n'
