import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import env_config
import task_clear_smoke
import task_log_smoke
import task_start_smoke
import task_status_smoke
import task_stop_smoke


class FakeResponse:
    def __init__(self, payload: dict):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


class TaskSmokeCliTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.env_path = Path(self.temp_dir.name) / ".env"
        self.env_path.write_text(
            "\n".join(
                [
                    "ENDPOINT=http://example.test",
                    "AIONE_API_KEY=test-key",
                    "TASK_ID=env-task",
                    "TASK_NAME=env-task-name",
                    "TASK_COMMAND=python train.py",
                    "API_PATH_TEMPLATE=/v2/api/aione/{type}/run",
                    "STOP_API_PATH_TEMPLATE=/v2/api/aione/{type}/{id}/stop",
                    "STATUS_API_PATH_TEMPLATE=/v2/api/aione/{type}/{id}/status",
                    "CLEAR_API_PATH_TEMPLATE=/v2/api/aione/{type}/{id}/clear",
                    "LOG_API_PATH_TEMPLATE=/v2/api/aione/{type}/{id}/log",
                    "IMAGE_TYPE=OWN",
                    "CPU=500m",
                    "MEMORY=128Mi",
                    "GPU=1",
                    "GPU_NODE_LABEL_KEY=nvidia.com/gpu",
                    "SOURCE_ORG=external-system",
                    "PROJECT=aione",
                    "DOMAIN=development",
                    "TIMEOUT_HOURS=1",
                    "IMAGE=docker.fzyun.io/library/busybox:stable",
                    "BASE_IMAGE=docker.fzyun.io/founder/aione.ide:1.0.0.60",
                ]
            ),
            encoding="utf-8",
        )
        self.env_patch = mock.patch.object(env_config, "ENV_PATH", self.env_path)
        self.env_patch.start()
        self.addCleanup(self.env_patch.stop)

    def test_task_start_prints_task_run_url(self):
        output = io.StringIO()
        with mock.patch.object(
            task_start_smoke.urllib.request,
            "urlopen",
            return_value=FakeResponse({"status": 200, "data": {"id": "env-task"}}),
        ):
            with contextlib.redirect_stdout(output):
                result = task_start_smoke.post_task({"id": "env-task"})

        self.assertEqual({"status": 200, "data": {"id": "env-task"}}, result)
        self.assertEqual(
            "URL: http://example.test/v2/api/aione/task/run",
            output.getvalue().splitlines()[0],
        )

    def test_task_payload_uses_task_fields_and_cmd(self):
        payload = task_start_smoke.build_payload()

        self.assertEqual("env-task", payload["id"])
        self.assertEqual("env-task-name", payload["name"])
        self.assertEqual("python train.py", payload["cmd"])
        self.assertNotIn("command", payload)
        self.assertNotIn("type", payload)
        self.assertEqual(
            {"cpu": "500m", "memory": "128Mi", "gpu": 1, "gpu_key": "nvidia.com/gpu"},
            payload["resourceDefinition"],
        )

    def test_task_payload_requires_cmd_source_value(self):
        content = self.env_path.read_text(encoding="utf-8")
        self.env_path.write_text(
            content.replace("TASK_COMMAND=python train.py", "TASK_COMMAND="),
            encoding="utf-8",
        )

        with self.assertRaisesRegex(ValueError, "TASK_COMMAND is required"):
            task_start_smoke.build_payload()

    def test_task_status_prints_task_status_url(self):
        output = io.StringIO()
        with mock.patch.object(
            task_status_smoke.urllib.request,
            "urlopen",
            return_value=FakeResponse({"status": 200, "data": {}}),
        ):
            with contextlib.redirect_stdout(output):
                result = task_status_smoke.post_status("abc/def")

        self.assertEqual({"status": 200, "data": {}}, result)
        self.assertEqual(
            "URL: http://example.test/v2/api/aione/task/abc%2Fdef/status",
            output.getvalue().splitlines()[0],
        )

    def test_task_stop_prints_task_stop_url(self):
        output = io.StringIO()
        with mock.patch.object(
            task_stop_smoke.urllib.request,
            "urlopen",
            return_value=FakeResponse({"status": 200, "data": {}}),
        ):
            with contextlib.redirect_stdout(output):
                result = task_stop_smoke.post_stop("abc/def")

        self.assertEqual({"status": 200, "data": {}}, result)
        self.assertEqual(
            "URL: http://example.test/v2/api/aione/task/abc%2Fdef/stop",
            output.getvalue().splitlines()[0],
        )

    def test_task_clear_prints_task_clear_url(self):
        output = io.StringIO()
        with mock.patch.object(
            task_clear_smoke.urllib.request,
            "urlopen",
            return_value=FakeResponse({"status": 200, "data": {}}),
        ):
            with contextlib.redirect_stdout(output):
                result = task_clear_smoke.delete_clear("abc/def")

        self.assertEqual({"status": 200, "data": {}}, result)
        self.assertEqual(
            "URL: http://example.test/v2/api/aione/task/abc%2Fdef/clear",
            output.getvalue().splitlines()[0],
        )

    def test_task_log_prints_task_log_url_with_pagination(self):
        output = io.StringIO()
        with mock.patch.object(
            task_log_smoke.urllib.request,
            "urlopen",
            return_value=FakeResponse({"status": 200, "data": {"total": 0, "logs": []}}),
        ):
            with contextlib.redirect_stdout(output):
                result = task_log_smoke.get_logs("abc/def", page="2", size="3")

        self.assertEqual({"status": 200, "data": {"total": 0, "logs": []}}, result)
        self.assertEqual(
            "URL: http://example.test/v2/api/aione/task/abc%2Fdef/log?page=2&size=3",
            output.getvalue().splitlines()[0],
        )


if __name__ == "__main__":
    unittest.main()
