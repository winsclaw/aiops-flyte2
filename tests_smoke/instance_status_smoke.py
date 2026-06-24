#!/usr/bin/env python3
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

from env_config import require_config


REQUIRED_KEYS = [
    "ENDPOINT",
    "AIONE_API_KEY",
    "INSTANCE_ID",
    "STATUS_API_PATH_TEMPLATE",
]


def load_config() -> dict[str, str]:
    return require_config(REQUIRED_KEYS)


def post_status(workflow_id: str) -> dict:
    config = load_config()
    if not workflow_id:
        raise RuntimeError("INSTANCE_ID is required")

    path = config["STATUS_API_PATH_TEMPLATE"].format(
        type="instance",
        id=urllib.parse.quote(workflow_id, safe=""),
    )
    url = config["ENDPOINT"].rstrip("/") + path
    print("URL:", url)
    request = urllib.request.Request(
        url,
        method="GET",
        headers={
            "Authorization": f"Bearer {config['AIONE_API_KEY']}",
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
        config = load_config()
        result = post_status(config["INSTANCE_ID"].strip())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
