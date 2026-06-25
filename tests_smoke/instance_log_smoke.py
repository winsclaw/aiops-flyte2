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
    "LOG_API_PATH_TEMPLATE",
]


def load_config() -> dict[str, str]:
    return require_config(REQUIRED_KEYS)


def get_logs(workflow_id: str, *, page: str = "1", size: str = "200") -> dict:
    config = load_config()
    if not workflow_id:
        raise RuntimeError("INSTANCE_ID is required")

    path = config["LOG_API_PATH_TEMPLATE"].format(
        type="instance",
        id=urllib.parse.quote(workflow_id, safe=""),
    )
    query = urllib.parse.urlencode({"page": str(page), "size": str(size)})
    url = f"{config['ENDPOINT'].rstrip('/')}{path}?{query}"
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
        result = get_logs(
            config["INSTANCE_ID"].strip(),
            page=config.get("LOG_PAGE", "1").strip() or "1",
            size=config.get("LOG_SIZE", "200").strip() or "200",
        )
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
