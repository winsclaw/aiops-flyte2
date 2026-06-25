import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import env_config
import gpu_usage_smoke


class FakeResponse:
    def __init__(self, payload: dict):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


class GpuSmokeCliTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.env_path = Path(self.temp_dir.name) / ".env"
        self.env_path.write_text(
            "\n".join(
                [
                    "ENDPOINT=http://example.test",
                    "AIONE_API_KEY=test-key",
                    "GPU_KEYS=nvidia.com/t4",
                    "GPU_USAGE_API_PATH=/v2/api/aione/gpus",
                ]
            ),
            encoding="utf-8",
        )
        self.env_patch = mock.patch.object(env_config, "ENV_PATH", self.env_path)
        self.env_patch.start()
        self.addCleanup(self.env_patch.stop)

    def test_gpu_usage_prints_gpu_usage_url(self):
        output = io.StringIO()
        payload = {
            "status": 200,
            "data": {
                "nvidia.com/t4": {"total": 1, "allocated": 1},
            },
        }
        with mock.patch.object(
            gpu_usage_smoke.urllib.request,
            "urlopen",
            return_value=FakeResponse(payload),
        ):
            with contextlib.redirect_stdout(output):
                result = gpu_usage_smoke.get_gpu_usage(
                    "nvidia.com/t4",
                )

        self.assertEqual(payload, result)
        self.assertEqual(
            "URL: http://example.test/v2/api/aione/gpus?keys=nvidia.com%2Ft4",
            output.getvalue().splitlines()[0],
        )

    def test_gpu_usage_requires_gpu_keys(self):
        with self.assertRaisesRegex(RuntimeError, "GPU_KEYS is required"):
            gpu_usage_smoke.get_gpu_usage("")

    def test_missing_env_file_stops_script_with_error(self):
        missing_env = Path(self.temp_dir.name) / "missing.env"
        with mock.patch.object(env_config, "ENV_PATH", missing_env):
            stderr = io.StringIO()
            with contextlib.redirect_stderr(stderr):
                exit_code = gpu_usage_smoke.main()

        self.assertEqual(1, exit_code)
        self.assertIn("ERROR:", stderr.getvalue())
        self.assertIn(".env not found", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
