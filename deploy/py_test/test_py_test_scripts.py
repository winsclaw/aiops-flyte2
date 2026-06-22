import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import get_aione_instance_status
import py_test_config
import start_aione_instance
import stop_aione_instance


class FakeResponse:
    def __init__(self, payload: dict):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


class PrintUrlTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.env_path = Path(self.temp_dir.name) / ".env"
        self.env_path.write_text(
            "\n".join(
                [
                    "ENDPOINT=http://example.test",
                    "AIONE_API_KEY=test-key",
                    "INSTANCE_ID=env-instance",
                    "API_PATH=/v2/api/aione/run",
                    "STOP_API_PATH_TEMPLATE=/v2/api/aione/{id}/stop",
                    "STATUS_API_PATH_TEMPLATE=/v2/api/aione/{id}/status",
                    "AUTHORIZED_KEY=",
                    "AUTHORIZED_KEY_FILE=",
                    "IMAGE_TYPE=BASE",
                    "CPU=4",
                    "MEMORY=8Gi",
                    "GPU=",
                    "GPU_NODE_LABEL_KEY=nvidia.com/gpu",
                    "SOURCE_ORG=external-system",
                    "PROJECT=aione",
                    "DOMAIN=development",
                    "INSTANCE_NAME=env-name",
                    "TIMEOUT_HOURS=2",
                    "IMAGE=docker.fzyun.io/custom/image:latest",
                    "IMAGE_KEY=image-user",
                    "IMAGE_SECRET=image-secret",
                    "BASE_IMAGE=docker.fzyun.io/founder/aione.ide:1.0.0.60",
                    "BASE_IMAGE_MOUNT_PATH=/data/lib1",
                    "CODE_TOKEN=code-token",
                ]
            ),
            encoding="utf-8",
        )
        self.env_patch = mock.patch.object(py_test_config, "ENV_PATH", self.env_path)
        self.env_patch.start()
        self.addCleanup(self.env_patch.stop)

    def test_start_prints_url_before_response_is_returned(self):
        output = io.StringIO()
        with mock.patch.object(
            start_aione_instance.urllib.request,
            "urlopen",
            return_value=FakeResponse({"status": 200, "data": {"id": "x"}}),
        ):
            with contextlib.redirect_stdout(output):
                result = start_aione_instance.post_instance({"id": "x"})

        self.assertEqual({"status": 200, "data": {"id": "x"}}, result)
        self.assertEqual(
            "URL: http://example.test/v2/api/aione/run",
            output.getvalue().splitlines()[0],
        )

    def test_start_payload_reads_values_from_same_directory_env(self):
        payload = start_aione_instance.build_payload()

        self.assertEqual("env-instance", payload["id"])
        self.assertEqual("env-name", payload["name"])
        self.assertEqual(2, payload["timeout"])
        self.assertEqual("docker.fzyun.io/custom/image:latest", payload["image"])
        self.assertEqual({"cpu": "4", "memory": "8Gi"}, payload["resourceDefinition"])
        self.assertEqual("code-token", payload["codes"][0]["token"])

    def test_status_prints_url_before_response_is_returned(self):
        output = io.StringIO()
        with mock.patch.object(
            get_aione_instance_status.urllib.request,
            "urlopen",
            return_value=FakeResponse({"status": 200, "data": {}}),
        ):
            with contextlib.redirect_stdout(output):
                result = get_aione_instance_status.post_status("abc/def")

        self.assertEqual({"status": 200, "data": {}}, result)
        self.assertEqual(
            "URL: http://example.test/v2/api/aione/abc%2Fdef/status",
            output.getvalue().splitlines()[0],
        )

    def test_stop_prints_url_before_response_is_returned(self):
        output = io.StringIO()
        with mock.patch.object(
            stop_aione_instance.urllib.request,
            "urlopen",
            return_value=FakeResponse({"status": 200, "data": {}}),
        ):
            with contextlib.redirect_stdout(output):
                result = stop_aione_instance.post_stop("abc/def")

        self.assertEqual({"status": 200, "data": {}}, result)
        self.assertEqual(
            "URL: http://example.test/v2/api/aione/abc%2Fdef/stop",
            output.getvalue().splitlines()[0],
        )

    def test_missing_env_file_stops_script_with_error(self):
        missing_env = Path(self.temp_dir.name) / "missing.env"
        with mock.patch.object(py_test_config, "ENV_PATH", missing_env):
            stderr = io.StringIO()
            with contextlib.redirect_stderr(stderr):
                exit_code = stop_aione_instance.main()

        self.assertEqual(1, exit_code)
        self.assertIn("ERROR:", stderr.getvalue())
        self.assertIn(".env not found", stderr.getvalue())

    def test_missing_required_key_stops_script_with_error(self):
        self.env_path.write_text(
            "\n".join(
                [
                    "ENDPOINT=http://example.test",
                    "AIONE_API_KEY=test-key",
                    "INSTANCE_ID=env-instance",
                ]
            ),
            encoding="utf-8",
        )

        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            exit_code = start_aione_instance.main()

        self.assertEqual(1, exit_code)
        self.assertIn("ERROR:", stderr.getvalue())
        self.assertIn("API_PATH", stderr.getvalue())
        self.assertIn("IMAGE_TYPE", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
