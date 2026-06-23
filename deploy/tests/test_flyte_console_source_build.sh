#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
console_dir="${repo_root}/flyte_console"
dockerfile="${console_dir}/Dockerfile"

assert_file() {
  local path="$1"
  if [[ ! -f "${path}" ]]; then
    echo "missing required file: ${path}" >&2
    exit 1
  fi
}

assert_contains() {
  local path="$1"
  local needle="$2"
  if ! grep -Fq "${needle}" "${path}"; then
    echo "expected ${path} to contain: ${needle}" >&2
    exit 1
  fi
}

assert_not_contains() {
  local path="$1"
  local needle="$2"
  if grep -Fq "${needle}" "${path}"; then
    echo "expected ${path} not to contain: ${needle}" >&2
    exit 1
  fi
}

assert_file "${dockerfile}"
assert_file "${console_dir}/next.config.mjs"
assert_file "${console_dir}/tsconfig.json"
assert_file "${console_dir}/next-env.d.ts"
assert_file "${console_dir}/postcss.config.mjs"
assert_file "${console_dir}/.dockerignore"
assert_file "${console_dir}/proxy-server.js"

assert_contains "${dockerfile}" "FROM docker.fzyun.io/node:23.11.1-alpine3.22 AS builder"
assert_contains "${dockerfile}" "pnpm run build:prod"
assert_contains "${dockerfile}" "COPY --from=builder /app/.next/standalone ./"
assert_not_contains "${dockerfile}" "ghcr.io/unionai-oss/flyteconsole-v2"

assert_contains "${console_dir}/.dockerignore" "node_modules"
assert_contains "${console_dir}/.dockerignore" ".next"

echo "flyte_console source-build config looks valid"
