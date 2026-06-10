#!/usr/bin/env bash
set -euo pipefail

require_command() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    printf 'required command not found: %s\n' "$name" >&2
    return 1
  fi
}

require_command kubectl
if command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN=python3
elif command -v python >/dev/null 2>&1; then
  PYTHON_BIN=python
else
  printf 'required command not found: python3\n' >&2
  exit 1
fi

RUN_ID="${1:-${RUN_ID:-}}"
NAMESPACE="${NAMESPACE:-flyte}"
SSH_USER="${SSH_USER:-dev}"

if [[ -z "$RUN_ID" ]]; then
  printf 'usage: %s org/project/domain/name\n' "$0" >&2
  exit 1
fi

IFS=/ read -r org project domain name <<<"$RUN_ID"
selector="flyte.org/run-name=${name},flyte.org/project=${project},flyte.org/domain=${domain},flyte.org/org=${org}"
service_json="$(kubectl -n "$NAMESPACE" get svc -l "$selector" -o json)"
service_count="$(SERVICE_JSON="$service_json" "$PYTHON_BIN" -c 'import json, os; print(len(json.loads(os.environ["SERVICE_JSON"]).get("items", [])))')"
if [[ "$service_count" == "0" ]]; then
  printf 'no SSH workspace service found for run id %s\n' "$RUN_ID" >&2
  exit 1
fi

service_name="$(SERVICE_JSON="$service_json" "$PYTHON_BIN" -c 'import json, os; print(json.loads(os.environ["SERVICE_JSON"])["items"][0]["metadata"]["name"])')"
service_type="$(SERVICE_JSON="$service_json" "$PYTHON_BIN" -c 'import json, os; print(json.loads(os.environ["SERVICE_JSON"])["items"][0]["spec"]["type"])')"
port="$(SERVICE_JSON="$service_json" "$PYTHON_BIN" -c 'import json, os; svc=json.loads(os.environ["SERVICE_JSON"])["items"][0]; port=svc["spec"]["ports"][0]; print(port.get("nodePort") or port["port"])')"
if [[ "$service_type" == "NodePort" || "$service_type" == "LoadBalancer" ]]; then
  nodes_json="$(kubectl get nodes -o json)"
  host="$(NODES_JSON="$nodes_json" "$PYTHON_BIN" -c 'import json, os; data=json.loads(os.environ["NODES_JSON"]); addresses=data["items"][0]["status"]["addresses"]; print(next((a["address"] for a in addresses if a.get("type") == "InternalIP"), addresses[0]["address"]))')"
else
  host="$(SERVICE_JSON="$service_json" "$PYTHON_BIN" -c 'import json, os; print(json.loads(os.environ["SERVICE_JSON"])["items"][0]["spec"]["clusterIP"])')"
fi

pod_json="$(kubectl -n "$NAMESPACE" get pod -l "$selector" -o json)"
pod_name="$(POD_JSON="$pod_json" "$PYTHON_BIN" -c 'import json, os; items=json.loads(os.environ["POD_JSON"]).get("items", []); print(items[0]["metadata"]["name"] if items else "")')"

"$PYTHON_BIN" -c '
import json, sys
host, port, user, namespace, service_name, pod_name = sys.argv[1:7]
print(json.dumps({
    "host": host,
    "port": int(port),
    "user": user,
    "namespace": namespace,
    "serviceName": service_name,
    "podName": pod_name,
}, separators=(",", ":")))
' "$host" "$port" "$SSH_USER" "$NAMESPACE" "$service_name" "$pod_name"
