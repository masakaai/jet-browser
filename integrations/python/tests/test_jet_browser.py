import io
import json
import subprocess
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "integrations" / "python"))

from jet_browser import (  # noqa: E402
    JetBrowserProcess,
    build_docker_command,
    resolve_platform,
)


class PlatformTests(unittest.TestCase):
    def test_resolves_only_published_native_platforms(self):
        self.assertEqual(resolve_platform("x86_64"), "linux/amd64")
        self.assertEqual(resolve_platform("AMD64"), "linux/amd64")
        self.assertEqual(resolve_platform("aarch64"), "linux/arm64")
        self.assertEqual(resolve_platform("arm64"), "linux/arm64")
        with self.assertRaisesRegex(ValueError, "unsupported architecture"):
            resolve_platform("riscv64")


class DockerCommandTests(unittest.TestCase):
    def test_default_command_is_resource_bounded_and_offline(self):
        command = build_docker_command(
            docker="docker",
            image="ghcr.io/masakaai/jet-browser:0.9.0",
            platform="linux/amd64",
            container_name="jet-browser-python-test",
            seccomp_path=Path("/tmp/seccomp_profile.json"),
            network="none",
            fixture=True,
        )

        self.assertEqual(command[:6], [
            "docker", "run", "--rm", "-i", "--name", "jet-browser-python-test",
        ])
        self.assertIn("--platform=linux/amd64", command)
        self.assertIn("--network=none", command)
        self.assertIn("--cap-drop=ALL", command)
        self.assertIn("--cap-add=SETUID", command)
        self.assertIn("--cap-add=SETGID", command)
        self.assertIn("--security-opt=no-new-privileges", command)
        self.assertIn(
            f"--security-opt=seccomp={Path('/tmp/seccomp_profile.json').resolve()}",
            command,
        )
        self.assertIn("--memory=1g", command)
        self.assertIn("--cpus=2", command)
        self.assertIn("--pids-limit=256", command)
        self.assertIn("--shm-size=256m", command)
        self.assertIn("--env=JET_BROWSER_SMOKE=1", command)
        self.assertNotIn("/var/run/docker.sock", " ".join(command))
        self.assertEqual(command[-1], "ghcr.io/masakaai/jet-browser:0.9.0")

    def test_public_network_requires_explicit_opt_in(self):
        common = dict(
            docker="docker",
            image="ghcr.io/masakaai/jet-browser:0.9.0",
            platform="linux/arm64",
            container_name="jet-browser-python-test",
            seccomp_path=Path("/tmp/seccomp_profile.json"),
            fixture=False,
        )
        with self.assertRaisesRegex(ValueError, "allow_network"):
            build_docker_command(**common, network="bridge")

        command = build_docker_command(
            **common,
            network="bridge",
            allow_network=True,
        )
        self.assertIn("--network=bridge", command)
        self.assertNotIn("--env=JET_BROWSER_SMOKE=1", command)

    def test_rejects_unpublished_platform_and_unbounded_network_modes(self):
        common = dict(
            docker="docker",
            image="jet-browser:test",
            container_name="jet-browser-python-test",
            seccomp_path=Path("/tmp/seccomp_profile.json"),
            fixture=False,
        )
        with self.assertRaisesRegex(ValueError, "platform"):
            build_docker_command(**common, platform="linux/riscv64", network="none")
        with self.assertRaisesRegex(ValueError, "network"):
            build_docker_command(**common, platform="linux/amd64", network="host")

    def test_rejects_an_image_that_docker_could_parse_as_an_option(self):
        common = dict(
            docker="docker",
            platform="linux/amd64",
            container_name="jet-browser-python-test",
            seccomp_path=Path("/tmp/seccomp_profile.json"),
            network="none",
            fixture=False,
        )
        for image in ("--privileged", "jet-browser:test\n--privileged", "jet browser:test"):
            with self.subTest(image=image), self.assertRaisesRegex(ValueError, "image"):
                build_docker_command(**common, image=image)


class ProtocolTests(unittest.TestCase):
    def test_concurrent_close_is_idempotent(self):
        runtime_source = r'''
import json
import sys

for line in sys.stdin:
    operation = json.loads(line)["op"]
    print(json.dumps({"ok": True, "value": {"operation": operation}}), flush=True)
    if operation == "close":
        break
'''
        cleaned = []

        def process_factory(_command, **options):
            return subprocess.Popen(
                [sys.executable, "-u", "-c", runtime_source],
                **options,
            )

        def cleanup_runner(command, **options):
            cleaned.append((command, options))
            return subprocess.CompletedProcess(command, 0, "", "")

        with tempfile.NamedTemporaryFile() as policy:
            runtime = JetBrowserProcess(
                image="jet-browser:test",
                platform="linux/amd64",
                seccomp_path=Path(policy.name),
                process_factory=process_factory,
                cleanup_runner=cleanup_runner,
            ).start()
            with ThreadPoolExecutor(max_workers=2) as executor:
                results = [future.result() for future in [
                    executor.submit(runtime.close),
                    executor.submit(runtime.close),
                ]]

        self.assertEqual(results, [None, None])
        self.assertEqual(len(cleaned), 1)

    def test_launch_failure_preserves_the_original_error_without_fake_cleanup(self):
        cleaned = []

        def missing_docker(_command, **_options):
            raise FileNotFoundError("docker is unavailable")

        def cleanup_runner(command, **options):
            cleaned.append((command, options))
            return subprocess.CompletedProcess(command, 0, "", "")

        with tempfile.NamedTemporaryFile() as policy:
            runtime = JetBrowserProcess(
                image="jet-browser:test",
                platform="linux/amd64",
                seccomp_path=Path(policy.name),
                process_factory=missing_docker,
                cleanup_runner=cleanup_runner,
            )
            with self.assertRaisesRegex(FileNotFoundError, "docker is unavailable"):
                runtime.start()
            runtime.close()

        self.assertEqual(cleaned, [])

    def test_ordered_protocol_round_trip_png_validation_and_cleanup(self):
        runtime_source = r'''
import base64
import json
import sys

png = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"x" * 1200).decode()
for line in sys.stdin:
    command = json.loads(line)
    operation = command["op"]
    if operation == "create":
        value = {"session": "created"}
    elif operation == "snapshot":
        value = {"title": "Python quickstart", "url": "http://127.0.0.1:8080/"}
    elif operation == "screenshot":
        value = png
    elif operation == "close":
        value = {"closed": True}
    else:
        value = {"operation": operation}
    print(json.dumps({"ok": True, "value": value}), flush=True)
    if operation == "close":
        break
'''
        launched = []
        cleaned = []

        def process_factory(command, **options):
            launched.append(command)
            return subprocess.Popen(
                [sys.executable, "-u", "-c", runtime_source],
                **options,
            )

        def cleanup_runner(command, **options):
            cleaned.append((command, options))
            return subprocess.CompletedProcess(command, 0, "", "")

        with tempfile.NamedTemporaryFile() as policy:
            runtime = JetBrowserProcess(
                image="jet-browser:test",
                platform="linux/amd64",
                seccomp_path=Path(policy.name),
                fixture=True,
                process_factory=process_factory,
                cleanup_runner=cleanup_runner,
            )
            with runtime:
                self.assertEqual(runtime.snapshot()["title"], "Python quickstart")
                self.assertGreater(len(runtime.screenshot()), 1000)

            runtime.close()
            with self.assertRaisesRegex(RuntimeError, "already closed"):
                runtime.start()

        self.assertEqual(len(launched), 1)
        self.assertIn("--network=none", launched[0])
        self.assertEqual(len(cleaned), 1)
        self.assertEqual(cleaned[0][0][:3], ["docker", "rm", "-f"])

    def test_protocol_errors_are_bounded_and_do_not_leak_control_bytes(self):
        runtime = JetBrowserProcess.__new__(JetBrowserProcess)
        runtime._stderr_tail = io.StringIO("private\x00\n" + "x" * 5000)
        message = runtime._safe_error("failed\x00\n" + "y" * 5000)
        self.assertNotIn("\x00", message)
        self.assertNotIn("\n", message)
        self.assertLessEqual(len(message), 1000)


class DistributionTests(unittest.TestCase):
    def test_readme_docs_example_and_ci_expose_the_python_supervisor(self):
        readme = (ROOT / "README.md").read_text()
        documentation = (ROOT / "integrations" / "python" / "README.md").read_text()
        example = (ROOT / "examples" / "python_quickstart.py").read_text()
        workflow = (ROOT / ".github" / "workflows" / "ci.yml").read_text()

        self.assertIn("integrations/python/README.md", readme)
        self.assertIn("examples/python_quickstart.py", readme)
        self.assertIn("network=\"bridge\"", documentation)
        self.assertIn("allow_network=True", documentation)
        self.assertIn("browser network is disabled by default", documentation.lower())
        self.assertIn("JetBrowserProcess", example)
        self.assertIn("--image", example)
        self.assertIn("python3 -m unittest discover -s integrations/python/tests -v", workflow)
        self.assertIn(
            "python3 examples/python_quickstart.py --image jet-browser:ci",
            workflow,
        )


if __name__ == "__main__":
    unittest.main()
