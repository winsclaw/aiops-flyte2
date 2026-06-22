#!/usr/bin/env python3
import json
import os
import sys
import urllib.error
import urllib.request
import urllib.parse


ENDPOINT = os.environ.get("ENDPOINT", "http://172.19.65.230:30081")
API_PATH_TEMPLATE = os.environ.get("API_PATH_TEMPLATE", "/v2/api/aione/{id}/stop")
API_KEY = os.environ.get("AIONE_API_KEY", "aione-external-test-key-20260617160842-86fa2460143e495ab74791432293e04d")


def post_stop(instance_id: str) -> dict:
    if not API_KEY:
        raise RuntimeError("AIONE_API_KEY is required")
    if not instance_id:
        raise RuntimeError("INSTANCE_ID is required")

    path = API_PATH_TEMPLATE.format(id=urllib.parse.quote(instance_id, safe=""))
    url = ENDPOINT.rstrip("/") + path
    request = urllib.request.Request(
        url,
        data=b"",
        method="POST",
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
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
        result = post_stop(os.environ.get("INSTANCE_ID", "codex-rs-1937").strip())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
