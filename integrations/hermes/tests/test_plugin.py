from __future__ import annotations

import base64
import importlib.util
import json
import selectors
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock


PLUGIN = Path(__file__).resolve().parents[1] / "__init__.py"
SPEC = importlib.util.spec_from_file_location("jet_browser_hermes_plugin", PLUGIN)
assert SPEC is not None and SPEC.loader is not None
plugin = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = plugin
SPEC.loader.exec_module(plugin)


def subprocess_runtime(script: str):
    runtime = plugin._DockerJsonl.__new__(plugin._DockerJsonl)
    runtime.container_name = "hermes-jet-browser-test"
    runtime._stderr = tempfile.SpooledTemporaryFile(max_size=1024 * 1024, mode="w+b")
    runtime._process = subprocess.Popen(
        [sys.executable, "-c", script],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=runtime._stderr,
        bufsize=0,
    )
    assert runtime._process.stdout is not None
    runtime._selector = selectors.DefaultSelector()
    runtime._selector.register(runtime._process.stdout, selectors.EVENT_READ)
    runtime._read_buffer = bytearray()
    runtime._lock = threading.Lock()
    runtime._closed = False
    runtime._resources_closed = False
    return runtime


def dispose_subprocess_runtime(runtime) -> None:
    if runtime._process.poll() is None:
        runtime._process.kill()
        runtime._process.wait(timeout=2)
    runtime._selector.close()
    for stream in (runtime._process.stdin, runtime._process.stdout, runtime._stderr):
        if stream is not None:
            stream.close()


class FakeRuntime:
    def __init__(self, *, title: str = "Jet Browser Ready") -> None:
        self.title = title
        self.commands: list[dict] = []
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.closed = True

    def mark_protocol_closed(self) -> None:
        self.closed = True

    def call(self, command, timeout=20):
        del timeout
        self.commands.append(command)
        op = command["op"]
        if op == "create":
            return {"sessionId": "test-session"}
        if op == "navigate":
            return None
        if op == "document_state":
            return {"url": plugin._TARGET, "readyState": "complete"}
        if op == "snapshot":
            return {"title": self.title, "url": plugin._TARGET}
        if op == "input":
            return {"applied": len(command["events"])}
        if op == "evaluate":
            return {
                "result": {
                    "value": {
                        "value": plugin._INPUT_TEXT,
                        "result": plugin._INPUT_TEXT,
                    }
                }
            }
        if op == "screenshot":
            png = b"\x89PNG\r\n\x1a\n" + b"x" * 1200
            return base64.b64encode(png).decode("ascii")
        if op == "close":
            return None
        raise AssertionError(op)


class VerificationTests(unittest.TestCase):
    def test_verification_checks_real_protocol_evidence(self) -> None:
        runtime = FakeRuntime()
        result = plugin._run_verification(lambda: runtime)

        self.assertTrue(result["success"])
        self.assertEqual(result["network"], "disabled")
        self.assertEqual(result["title"], "Jet Browser Ready")
        self.assertEqual(result["input"], plugin._INPUT_TEXT)
        self.assertGreater(result["screenshot_bytes"], 1000)
        self.assertEqual(
            [command["op"] for command in runtime.commands],
            [
                "create",
                "navigate",
                "document_state",
                "snapshot",
                "input",
                "evaluate",
                "screenshot",
                "close",
            ],
        )
        self.assertTrue(runtime.closed)

    def test_verification_rejects_wrong_snapshot(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "snapshot did not match"):
            plugin._run_verification(lambda: FakeRuntime(title="Wrong page"))

    def test_handler_reports_missing_docker_without_starting(self) -> None:
        with mock.patch.object(plugin, "_docker_available", return_value=False):
            payload = json.loads(plugin._handle_verify({}))
        self.assertEqual(payload, {"error": "Docker is required to run Jet Browser verification"})

    def test_error_includes_cleanup_note(self) -> None:
        error = TimeoutError("Jet Browser snapshot timed out")
        error.add_note("Jet Browser cleanup failed: container removal failed")

        payload = json.loads(plugin._error(error))

        self.assertIn("snapshot timed out", payload["error"])
        self.assertIn("container removal failed", payload["error"])

    def test_docker_command_is_pinned_and_network_isolated(self) -> None:
        command = plugin._docker_command("hermes-jet-browser-test")
        self.assertIn(plugin._IMAGE, command)
        self.assertIn("--network=none", command)
        self.assertIn("--cap-drop=ALL", command)
        self.assertIn("--security-opt=no-new-privileges", command)
        self.assertNotIn("--privileged", command)

    def test_register_declares_one_bounded_tool(self) -> None:
        ctx = mock.Mock()
        plugin.register(ctx)
        ctx.register_tool.assert_called_once()
        kwargs = ctx.register_tool.call_args.kwargs
        self.assertEqual(kwargs["name"], "jet_browser_verify")
        self.assertEqual(kwargs["toolset"], "jet_browser")
        self.assertIs(kwargs["handler"], plugin._handle_verify)
        self.assertIs(kwargs["check_fn"], plugin._docker_available)

    def test_partial_response_obeys_absolute_timeout(self) -> None:
        runtime = subprocess_runtime(
            "import sys,time;"
            "sys.stdin.buffer.readline();"
            "sys.stdout.buffer.write(b'{\\\"ok\\\":');"
            "sys.stdout.buffer.flush();"
            "time.sleep(0.5)"
        )
        started = time.monotonic()
        try:
            with self.assertRaisesRegex(TimeoutError, "snapshot timed out"):
                runtime.call({"op": "snapshot"}, timeout=0.05)
            self.assertLess(time.monotonic() - started, 0.3)
        finally:
            dispose_subprocess_runtime(runtime)

    def test_oversized_response_is_rejected_before_newline(self) -> None:
        runtime = subprocess_runtime(
            "import sys,time;"
            "sys.stdin.buffer.readline();"
            "sys.stdout.buffer.write(b'x'*80);"
            "sys.stdout.buffer.flush();"
            "time.sleep(0.5)"
        )
        try:
            runtime._process.stdin.write(b"{}\n")
            runtime._process.stdin.flush()
            self.assertTrue(runtime._selector.select(1.0), "fixture did not publish its oversized response")
            with mock.patch.object(plugin, "_MAX_LINE_BYTES", 64):
                with self.assertRaisesRegex(RuntimeError, "oversized response"):
                    runtime.call({"op": "snapshot"}, timeout=0.2)
        finally:
            dispose_subprocess_runtime(runtime)

    def test_close_terminates_a_stalled_docker_client(self) -> None:
        runtime = plugin._DockerJsonl.__new__(plugin._DockerJsonl)
        runtime.container_name = "hermes-jet-browser-test"
        runtime._closed = True
        runtime._resources_closed = False
        runtime._selector = mock.Mock()
        runtime._stderr = mock.Mock()
        runtime._process = mock.Mock()
        runtime._process.stdin = mock.Mock()
        runtime._process.wait.side_effect = [
            subprocess.TimeoutExpired("docker run", 5),
            0,
        ]
        runtime._process.poll.return_value = 0

        runtime.close()

        runtime._process.terminate.assert_called_once()
        runtime._selector.close.assert_called_once()
        runtime._process.stdout.close.assert_called_once()
        runtime._stderr.close.assert_called_once()

    def test_failed_container_removal_fails_and_closes_resources(self) -> None:
        runtime = plugin._DockerJsonl.__new__(plugin._DockerJsonl)
        runtime.container_name = "hermes-jet-browser-test"
        runtime._closed = True
        runtime._resources_closed = False
        runtime._selector = mock.Mock()
        runtime._stderr = mock.Mock()
        runtime._process = mock.Mock()
        runtime._process.stdin = None
        runtime._process.wait.return_value = 137
        runtime._process.poll.return_value = 137

        removal = subprocess.CompletedProcess([], 1)
        with mock.patch.object(plugin.subprocess, "run", return_value=removal):
            with self.assertRaisesRegex(
                RuntimeError, "status 137; container removal failed with status 1"
            ):
                runtime.close()

        runtime._selector.close.assert_called_once()
        runtime._process.stdout.close.assert_called_once()
        runtime._stderr.close.assert_called_once()


if __name__ == "__main__":
    unittest.main()
