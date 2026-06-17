#!/usr/bin/env python3
import json
import os
import sys
import time
import urllib.error
import urllib.request


ENDPOINT = os.environ.get("ENDPOINT", "http://172.19.65.230:30081")
API_PATH = os.environ.get("API_PATH", "/v2/api/aione/instances")
API_KEY = os.environ.get("AIONE_API_KEY", "aione-external-test-key-20260617160842-86fa2460143e495ab74791432293e04d")



def read_authorized_key() -> str | None:
    value = os.environ.get("AUTHORIZED_KEY")
    if value:
        return value.strip()

    path = os.environ.get("AUTHORIZED_KEY_FILE")
    if path:
        with open(path, "r", encoding="utf-8") as f:
            return f.read().strip()

    return None


def build_payload() -> dict:
    image_type = os.environ.get("IMAGE_TYPE", "BASE")
    instance_id = os.environ.get("INSTANCE_ID") or "ins-og2bgwm130xq3o6uk3h49563333"
    resource_definition = {
        "cpu": os.environ.get("CPU", "2"),
        "memory": os.environ.get("MEMORY", "4Gi"),
    }
    gpu = os.environ.get("GPU")
    if gpu:
        resource_definition["gpu"] = int(gpu)
        resource_definition["gpu_key"] = os.environ.get("GPU_NODE_LABEL_KEY", "nvidia.com/gpu")

    payload = {
        "org": os.environ.get("SOURCE_ORG", "external-system"),
        "project": os.environ.get("PROJECT", "aione"),
        "domain": os.environ.get("DOMAIN", "development"),
        "name": os.environ.get("INSTANCE_NAME", "开发实例一"),
        "id": instance_id,
        "timeout": int(os.environ.get("TIMEOUT_HOURS", "1")),
        "imageType": image_type,
        "image": os.environ.get(
            "IMAGE",
            "docker.fzyun.io/pytorch/pytorch:1.13.1-cuda11.6-cudnn8-runtime",
        ),
        "imageKey": os.environ.get("IMAGE_KEY", "gonglijie"),
        "imageSecret": os.environ.get("IMAGE_SECRET", "Founder123"),
        "baseImage": {
            "image": os.environ.get("BASE_IMAGE", "docker.fzyun.io/founder/aione.ide:1.0.0.60"),
            "imageKey": os.environ.get("IMAGE_KEY", "gonglijie"),
            "imageSecret": os.environ.get("IMAGE_SECRET", "Founder123"),
            "mountPath": os.environ.get("BASE_IMAGE_MOUNT_PATH", "/data/lib1"),
        },
        "codes": [
            {
                "id": "https://git.fzyun.io/founder/e5/v4.customize/js-sample.git",
                "branch": "master",
                "path": "/data/js-sample",
                "token": os.environ.get("CODE_TOKEN", "9MDDngep1c5BfqJyN3Za"),
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
    authorized_key = read_authorized_key()
    if authorized_key:
        payload["authorizedKeys"] = [authorized_key]
    return payload


def post_instance(payload: dict) -> dict:
    if not API_KEY:
        raise RuntimeError("AIONE_API_KEY or EXTERNAL_API_KEY is required")

    url = ENDPOINT.rstrip("/") + API_PATH
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
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
        payload = build_payload()
        result = post_instance(payload)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(result, ensure_ascii=False, indent=2))
    run_id = result.get("runId") or {}
    if run_id:
        print(
            "RUN:",
            f"{run_id.get('org')}/{run_id.get('project')}/{run_id.get('domain')}/{run_id.get('name')}",
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
