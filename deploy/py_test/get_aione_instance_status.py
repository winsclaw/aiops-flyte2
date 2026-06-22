#!/usr/bin/env python3
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


ENDPOINT = os.environ.get("ENDPOINT", "http://172.19.65.230:30081")
API_PATH_TEMPLATE = os.environ.get("API_PATH_TEMPLATE", "/v2/api/aione/{id}/status")
API_KEY = os.environ.get(
    "AIONE_API_KEY",
    "aione-external-test-key-20260617160842-86fa2460143e495ab74791432293e04d",
)


def post_status(workflow_id: str) -> dict:
    if not API_KEY:
        raise RuntimeError("AIONE_API_KEY is required")
    if not workflow_id:
        raise RuntimeError("INSTANCE_ID or FLYTE_WORKFLOW_ID is required")

    path = API_PATH_TEMPLATE.format(id=urllib.parse.quote(workflow_id, safe=""))
    url = ENDPOINT.rstrip("/") + path
    request = urllib.request.Request(
        url,
        method="GET",
        headers={
            "Authorization": f"Bearer {API_KEY}",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {body}") from exc


def main() -> int:
    try:
        workflow_id = (
            os.environ.get("FLYTE_WORKFLOW_ID")
            or os.environ.get("INSTANCE_ID")
            or ""
        ).strip()
        result = post_status(workflow_id)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
