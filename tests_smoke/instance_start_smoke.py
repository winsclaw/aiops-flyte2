#!/usr/bin/env python3
import json
import math
import sys
import urllib.error
import urllib.request

from env_config import require_config, resolve_env_path


REQUIRED_KEYS = [
    "ENDPOINT",
    "AIONE_API_KEY",
    "INSTANCE_ID",
    "API_PATH",
    "AUTHORIZED_KEY",
    "AUTHORIZED_KEY_FILE",
    "IMAGE_TYPE",
    "CPU",
    "MEMORY",
    "GPU",
    "GPU_NODE_LABEL_KEY",
    "SOURCE_ORG",
    "PROJECT",
    "DOMAIN",
    "INSTANCE_NAME",
    "TIMEOUT_HOURS",
    "IMAGE",
    "IMAGE_KEY",
    "IMAGE_SECRET",
    "BASE_IMAGE",
    "BASE_IMAGE_MOUNT_PATH",
    "CODE_TOKEN",
]
OPTIONAL_EMPTY_KEYS = {"AUTHORIZED_KEY", "AUTHORIZED_KEY_FILE", "GPU"}


def load_config() -> dict[str, str]:
    return require_config(REQUIRED_KEYS, optional_empty_keys=OPTIONAL_EMPTY_KEYS)


def read_authorized_key(config: dict[str, str]) -> str | None:
    value = config["AUTHORIZED_KEY"]
    if value:
        return value.strip()

    path = config["AUTHORIZED_KEY_FILE"]
    if path:
        with open(resolve_env_path(path), "r", encoding="utf-8") as f:
            return f.read().strip()

    return None


def parse_positive_number(value: str, field: str) -> int | float:
    try:
        number = float(value)
    except ValueError as exc:
        raise ValueError(f"{field} must be a positive number") from exc

    if not math.isfinite(number) or number <= 0:
        raise ValueError(f"{field} must be a positive number")
    return int(number) if number.is_integer() else number


def build_payload() -> dict:
    config = load_config()
    resource_definition = {
        "cpu": config["CPU"],
        "memory": config["MEMORY"],
    }
    gpu = config["GPU"]
    if gpu:
        resource_definition["gpu"] = int(gpu)
        resource_definition["gpu_key"] = config["GPU_NODE_LABEL_KEY"]

    payload = {
        "org": config["SOURCE_ORG"],
        "project": config["PROJECT"],
        "domain": config["DOMAIN"],
        "name": config["INSTANCE_NAME"],
        "id": config["INSTANCE_ID"],
        "timeout": parse_positive_number(config["TIMEOUT_HOURS"], "TIMEOUT_HOURS"),
        "imageType": config["IMAGE_TYPE"],
        "image": config["IMAGE"],
        "imageKey": config["IMAGE_KEY"],
        "imageSecret": config["IMAGE_SECRET"],
        "baseImage": {
            "image": config["BASE_IMAGE"],
            "imageKey": config["IMAGE_KEY"],
            "imageSecret": config["IMAGE_SECRET"],
            "mountPath": config["BASE_IMAGE_MOUNT_PATH"],
        },
        "codes": [
            {
                "id": "https://git.fzyun.io/founder/e5/v4.customize/js-sample.git",
                "branch": "master",
                "path": "/data/js-sample",
                "token": config["CODE_TOKEN"],
            }
        ],
        "datastores": [
            {
                "id": "stg-2i63j4q0z319cb63mw90qnt2mt",
                "path": "/data/mystore2",
                "size": 2,
            },
            {
                "id": "stg-420l82y3w0726yc505r6rwjfg2",
                "path": "/data/mystore1",
                "size": 1,
            },
        ],
        "resourceDefinition": resource_definition,
    }
    authorized_key = read_authorized_key(config)
    if authorized_key:
        payload["authorizedKeys"] = [authorized_key]
    return payload


def post_instance(payload: dict) -> dict:
    config = load_config()

    url = config["ENDPOINT"].rstrip("/") + config["API_PATH"]
    print("URL:", url)
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
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
        payload = build_payload()
        result = post_instance(payload)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(result, ensure_ascii=False, indent=2))
    data = result.get("data")
    if isinstance(data, dict):
        print("INSTANCE:", data.get("id") or data.get("source", {}).get("id"))
        code_server = data.get("info", {}).get("codeServer", {})
        if code_server.get("workspaceUrl"):
            print("CODE_SERVER:", code_server["workspaceUrl"])
    elif data:
        print("INSTANCE:", data)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
