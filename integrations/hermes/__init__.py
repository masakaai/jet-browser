"""Hermes integration for Jet Browser's reproducible standalone acceptance check.

The plugin deliberately exposes one bounded operation. It starts the pinned
public Jet Browser image with browser networking disabled, exercises native
input and semantic/visual evidence, then removes the container. It does not
patch Hermes, attach to a personal browser, or keep a daemon running.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import os
import re
import selectors
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable


_IMAGE = (
    "ghcr.io/masakaai/jet-browser@"
    "sha256:540a1fec531bf71b62c2c2d030c033249955ffc192ab7e0e7a1ac8d8412a661b"
)
_TARGET = "http://127.0.0.1:8080/"
_INPUT_TEXT = "open-source runtime"
_MAX_LINE_BYTES = 12 * 1024 * 1024
_URL_RE = re.compile(r"https?://\S+")


JET_BROWSER_VERIFY_SCHEMA = {
    "description": (
        "Run Jet Browser's bounded offline acceptance check. Use it to verify "
        "that the pinned WPE WebKit container can start, receive native input, "
        "report matching DOM state, capture a PNG, and clean up."
    ),
    "parameters": {
        "type": "object",
        "properties": {},
        "additionalProperties": False,
    },
}


def _result(data: dict[str, Any]) -> str:
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"))


def _error(message: object) -> str:
    parts = [str(message)]
    notes = getattr(message, "__notes__", ())
    if isinstance(notes, (list, tuple)):
        parts.extend(str(note) for note in notes)
    text = _URL_RE.sub("[url]", "; ".join(part for part in parts if part)).strip()
    return _result({"error": text[:2000] or "Jet Browser verification failed"})


def _docker_available() -> bool:
    return shutil.which("docker") is not None


def _docker_command(container_name: str) -> list[str]:
    seccomp = Path(__file__).with_name("seccomp_profile.json").resolve()
    return [
        "docker",
        "run",
        "--rm",
        "-i",
        "--name",
        container_name,
        "--platform=linux/amd64",
        "--network=none",
        "--cap-drop=ALL",
        "--cap-add=SETUID",
        "--cap-add=SETGID",
        "--security-opt=no-new-privileges",
        "--security-opt=systempaths=unconfined",
        "--security-opt=apparmor=unconfined",
        f"--security-opt=seccomp={seccomp}",
        "--memory=1g",
        "--cpus=2",
        "--pids-limit=256",
        "--shm-size=256m",
        "--env=JET_BROWSER_SMOKE=1",
        _IMAGE,
    ]


class _DockerJsonl:
    """One short-lived JSONL runtime with bounded reads and deterministic cleanup."""

    def __init__(self) -> None:
        self.container_name = f"hermes-jet-browser-{uuid.uuid4().hex[:12]}"
        self._stderr = tempfile.TemporaryFile(mode="w+b")
        try:
            self._process = subprocess.Popen(
                _docker_command(self.container_name),
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=self._stderr,
                bufsize=0,
            )
        except Exception:
            self._stderr.close()
            raise
        if self._process.stdin is None or self._process.stdout is None:
            self._process.kill()
            self._stderr.close()
            raise RuntimeError("Docker did not expose the Jet Browser JSONL pipes")
        self._selector = selectors.DefaultSelector()
        self._selector.register(self._process.stdout, selectors.EVENT_READ)
        self._read_buffer = bytearray()
        self._lock = threading.Lock()
        self._closed = False
        self._resources_closed = False

    def _stderr_tail(self) -> str:
        try:
            self._stderr.flush()
            self._stderr.seek(0, 2)
            size = self._stderr.tell()
            self._stderr.seek(max(0, size - 4000))
            return self._stderr.read().decode("utf-8", errors="replace").strip()
        except Exception:
            return ""

    def call(self, command: dict[str, Any], timeout: float = 20.0) -> Any:
        if self._closed:
            raise RuntimeError("Jet Browser runtime is closed")
        encoded = json.dumps(command, ensure_ascii=False, separators=(",", ":"))
        with self._lock:
            try:
                self._process.stdin.write((encoded + "\n").encode("utf-8"))
                self._process.stdin.flush()
            except (BrokenPipeError, OSError) as exc:
                detail = self._stderr_tail()
                raise RuntimeError(
                    "Jet Browser exited before accepting a command"
                    + (f": {detail}" if detail else "")
                ) from exc
            line = self._readline(command.get("op", "command"), timeout)
        if not line:
            detail = self._stderr_tail()
            status = self._process.poll()
            raise RuntimeError(
                f"Jet Browser exited before responding (status {status})"
                + (f": {detail}" if detail else "")
            )
        try:
            response = json.loads(line.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise RuntimeError("Jet Browser returned invalid JSON") from exc
        if not isinstance(response, dict) or not isinstance(response.get("ok"), bool):
            raise RuntimeError("Jet Browser returned an invalid response envelope")
        if not response["ok"]:
            raise RuntimeError(str(response.get("error") or "Jet Browser command failed"))
        return response.get("value")

    def _readline(self, operation: object, timeout: float) -> bytes:
        deadline = time.monotonic() + timeout
        while True:
            newline = self._read_buffer.find(b"\n")
            if newline >= 0:
                if newline > _MAX_LINE_BYTES:
                    raise RuntimeError("Jet Browser returned an oversized response")
                line = bytes(self._read_buffer[:newline])
                del self._read_buffer[: newline + 1]
                return line
            if len(self._read_buffer) > _MAX_LINE_BYTES:
                raise RuntimeError("Jet Browser returned an oversized response")

            remaining = deadline - time.monotonic()
            if remaining <= 0 or not self._selector.select(remaining):
                raise TimeoutError(f"Jet Browser {operation} timed out")
            try:
                chunk = os.read(self._process.stdout.fileno(), 64 * 1024)
            except OSError as exc:
                raise RuntimeError("Jet Browser response pipe failed") from exc
            if not chunk:
                return b""
            self._read_buffer.extend(chunk)

    def mark_protocol_closed(self) -> None:
        self._closed = True

    def close(self) -> None:
        if self._resources_closed:
            return
        cleanup_errors: list[str] = []
        if not self._closed and self._process.poll() is None:
            try:
                self.call({"op": "close"}, timeout=10)
            except Exception:
                pass
        self._closed = True
        try:
            if self._process.stdin is not None:
                self._process.stdin.close()
        except OSError:
            pass
        try:
            try:
                self._process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._process.terminate()
                try:
                    self._process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    self._process.kill()
                    try:
                        self._process.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        cleanup_errors.append("Docker client did not exit after being killed")
            status = self._process.poll()
            if status not in (0, None):
                cleanup_errors.append(f"Docker client exited with status {status}")
            if status != 0:
                try:
                    removal = subprocess.run(
                        ["docker", "rm", "-f", self.container_name],
                        stdin=subprocess.DEVNULL,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                        timeout=10,
                        check=False,
                    )
                    if removal.returncode != 0:
                        cleanup_errors.append(
                            f"container removal failed with status {removal.returncode}"
                        )
                except (OSError, subprocess.TimeoutExpired) as exc:
                    cleanup_errors.append(f"container removal failed: {type(exc).__name__}")
        finally:
            try:
                self._selector.close()
            finally:
                try:
                    if self._process.stdout is not None:
                        self._process.stdout.close()
                finally:
                    self._stderr.close()
                    self._resources_closed = True
        if cleanup_errors:
            raise RuntimeError("Jet Browser cleanup failed: " + "; ".join(cleanup_errors))

    def __enter__(self) -> "_DockerJsonl":
        return self

    def __exit__(self, _type: object, error: object, _traceback: object) -> None:
        try:
            self.close()
        except Exception as cleanup_error:
            if error is None:
                raise
            add_note = getattr(error, "add_note", None)
            if callable(add_note):
                add_note(str(cleanup_error))


def _evaluated_value(value: Any) -> Any:
    if isinstance(value, dict):
        result = value.get("result")
        if isinstance(result, dict) and "value" in result:
            return result["value"]
        if "value" in value:
            return value["value"]
    return value


def _run_verification(runtime_factory: Callable[[], Any] = _DockerJsonl) -> dict[str, Any]:
    started = time.monotonic()
    with runtime_factory() as runtime:
        runtime.call(
            {
                "op": "create",
                "proxy": None,
                "profile_dir": None,
                "page_load_strategy": "none",
            },
            timeout=30,
        )
        runtime.call({"op": "navigate", "url": _TARGET}, timeout=30)

        state: Any = None
        for attempt in range(30):
            state = runtime.call({"op": "document_state"}, timeout=5)
            if (
                isinstance(state, dict)
                and state.get("url") == _TARGET
                and state.get("readyState") in {"interactive", "complete"}
            ):
                break
            if attempt < 29:
                time.sleep(0.1)
        else:
            raise RuntimeError("Jet Browser fixture did not become ready")

        snapshot = runtime.call({"op": "snapshot"}, timeout=20)
        if not isinstance(snapshot, dict) or snapshot.get("title") != "Jet Browser Ready":
            raise RuntimeError("Jet Browser snapshot did not match the fixture")

        runtime.call(
            {
                "op": "input",
                "events": [
                    {"type": "pointer", "phase": "down", "x": 180, "y": 42, "button": 0},
                    {"type": "pointer", "phase": "up", "x": 180, "y": 42, "button": 0},
                    {"type": "text", "text": _INPUT_TEXT},
                ],
            },
            timeout=20,
        )
        evaluation = runtime.call(
            {
                "op": "evaluate",
                "expression": (
                    "(()=>({value:document.querySelector('#message').value,"
                    "result:document.querySelector('#result').value}))()"
                ),
            },
            timeout=20,
        )
        observed = _evaluated_value(evaluation)
        if not isinstance(observed, dict) or observed.get("value") != _INPUT_TEXT:
            raise RuntimeError("Jet Browser native input did not update the fixture DOM")
        if observed.get("result") != _INPUT_TEXT:
            raise RuntimeError("Jet Browser fixture did not confirm the native input")

        screenshot = runtime.call({"op": "screenshot"}, timeout=20)
        if not isinstance(screenshot, str) or len(screenshot) > 8_000_000:
            raise RuntimeError("Jet Browser returned an invalid screenshot payload")
        try:
            png = base64.b64decode(screenshot, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise RuntimeError("Jet Browser screenshot was not valid base64") from exc
        if len(png) < 1000 or not png.startswith(b"\x89PNG\r\n\x1a\n"):
            raise RuntimeError("Jet Browser screenshot was not a non-empty PNG")

        runtime.call({"op": "close"}, timeout=15)
        marker = getattr(runtime, "mark_protocol_closed", None)
        if callable(marker):
            marker()

    return {
        "success": True,
        "network": "disabled",
        "image": _IMAGE,
        "title": snapshot["title"],
        "url": state["url"],
        "input": observed["value"],
        "screenshot_bytes": len(png),
        "screenshot_sha256": hashlib.sha256(png).hexdigest(),
        "duration_ms": round((time.monotonic() - started) * 1000),
    }


def _handle_verify(args: dict[str, Any], **_: Any) -> str:
    if args:
        return _error("jet_browser_verify does not accept arguments")
    if not _docker_available():
        return _error("Docker is required to run Jet Browser verification")
    try:
        return _result(_run_verification())
    except Exception as exc:
        return _error(exc)


def register(ctx: Any) -> None:
    """Register the bounded verification tool through Hermes' public plugin API."""
    ctx.register_tool(
        name="jet_browser_verify",
        toolset="jet_browser",
        schema=JET_BROWSER_VERIFY_SCHEMA,
        handler=_handle_verify,
        check_fn=_docker_available,
        description=(
            "Verify Jet Browser startup, native input, DOM state, and PNG capture "
            "inside a network-isolated container."
        ),
    )
