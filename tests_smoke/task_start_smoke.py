#!/usr/bin/env python3
import json
import math
import sys
import urllib.error
import urllib.request

from env_config import require_config


REQUIRED_KEYS = [
    "ENDPOINT",
    "AIONE_API_KEY",
    "TASK_ID",
    "TASK_NAME",
    "TASK_COMMAND",
    "API_PATH_TEMPLATE",
    "IMAGE_TYPE",
    "CPU",
    "MEMORY",
    "GPU",
    "GPU_NODE_LABEL_KEY",
    "SOURCE_ORG",
    "PROJECT",
    "DOMAIN",
    "TIMEOUT_HOURS",
    "IMAGE",
    "BASE_IMAGE",
]
OPTIONAL_EMPTY_KEYS = {"GPU", "TASK_COMMAND"}


def load_config() -> dict[str, str]:
    return require_config(REQUIRED_KEYS, optional_empty_keys=OPTIONAL_EMPTY_KEYS)


def parse_positive_number(value: str, field: str) -> int | float:
    try:
        number = float(value)
    except ValueError as exc:
        raise ValueError(f"{field} must be a positive number") from exc

    if not math.isfinite(number) or number <= 0:
        raise ValueError(f"{field} must be a positive number")
    return int(number) if number.is_integer() else number


def build_run_path(config: dict[str, str]) -> str:
    return config["API_PATH_TEMPLATE"].format(type="task")


def build_payload() -> dict:
    config = load_config()
    command = config["TASK_COMMAND"].strip()
    if not command:
        raise ValueError("TASK_COMMAND is required")

    resource_definition = {
        "cpu": config["CPU"],
        "memory": config["MEMORY"],
    }
    gpu = config["GPU"]
    if gpu:
        resource_definition["gpu"] = int(gpu)
        resource_definition["gpu_key"] = config["GPU_NODE_LABEL_KEY"]

    return {
        "org": config["SOURCE_ORG"],
        "project": config["PROJECT"],
        "domain": config["DOMAIN"],
        "name": config["TASK_NAME"],
        "id": config["TASK_ID"],
        "timeout": parse_positive_number(config["TIMEOUT_HOURS"], "TIMEOUT_HOURS"),
        "imageType": config["IMAGE_TYPE"],
        "image": config["IMAGE"],
        "baseImage": {
            "image": config["BASE_IMAGE"],
        },
        "cmd": command,
        "resourceDefinition": resource_definition,
    }


def post_task(payload: dict) -> dict:
    config = load_config()

    url = config["ENDPOINT"].rstrip("/") + build_run_path(config)
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
        result = post_task(payload)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(result, ensure_ascii=False, indent=2))
    data = result.get("data")
    if isinstance(data, dict):
        print("TASK:", data.get("task", {}).get("id") or data.get("id"))
        if data.get("task", {}).get("latestRunName"):
            print("RUN:", data["task"]["latestRunName"])
    elif data:
        print("TASK:", data)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
