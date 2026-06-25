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
    "GPU_KEYS",
    "GPU_USAGE_API_PATH",
]


def load_config() -> dict[str, str]:
    return require_config(REQUIRED_KEYS)


def get_gpu_usage(keys: str) -> dict:
    config = load_config()
    if not keys:
        raise RuntimeError("GPU_KEYS is required")

    query = urllib.parse.urlencode({"keys": keys})
    url = (
        config["ENDPOINT"].rstrip("/")
        + config["GPU_USAGE_API_PATH"]
        + "?"
        + query
    )
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
        result = get_gpu_usage(config["GPU_KEYS"].strip())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
