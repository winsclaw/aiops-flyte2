#!/usr/bin/env python3
import json
import sys
import urllib.error
import urllib.request
import urllib.parse

from env_config import require_config


REQUIRED_KEYS = [
    "ENDPOINT",
    "AIONE_API_KEY",
    "INSTANCE_ID",
    "STOP_API_PATH_TEMPLATE",
]


def load_config() -> dict[str, str]:
    return require_config(REQUIRED_KEYS)


def post_stop(instance_id: str) -> dict:
    config = load_config()
    if not instance_id:
        raise RuntimeError("INSTANCE_ID is required")

    path = config["STOP_API_PATH_TEMPLATE"].format(
        type="instance",
        id=urllib.parse.quote(instance_id, safe=""),
    )
    url = config["ENDPOINT"].rstrip("/") + path
    print("URL:", url)
    request = urllib.request.Request(
        url,
        data=b"",
        method="POST",
        headers={
            "Authorization": f"Bearer {config['AIONE_API_KEY']}",
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
        config = load_config()
        result = post_stop(config["INSTANCE_ID"].strip())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
