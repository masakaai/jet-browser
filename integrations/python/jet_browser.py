"""Dependency-free supervisor for one isolated Jet Browser container.

The default boundary is deliberately offline. Public-web navigation requires
both ``network="bridge"`` and ``allow_network=True`` so a copied example cannot
silently gain browser egress.
"""

from __future__ import annotations

import base64
import json
import platform as host_platform
import re
import selectors
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping
from urllib.parse import urlsplit


JET_BROWSER_IMAGE = (
    "ghcr.io/masakaai/jet-browser@"
    "sha256:5884204e128a3e5bb17634078affdf28d1933d2745752cee3bc74235ed316cec"
)
SUPPORTED_PLATFORMS = frozenset({"linux/amd64", "linux/arm64"})
_CONTAINER_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
_IMAGE_REFERENCE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/:@+-]{0,254}$")
_OPERATION = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
_MAX_COMMAND_BYTES = 1024 * 1024
_MAX_RESPONSE_BYTES = 24 * 1024 * 1024
_DEFAULT_SECCOMP = Path(__file__).resolve().with_name("seccomp_profile.json")


def resolve_platform(machine: str | None = None) -> str:
    """Map the native machine architecture to a published Linux OCI platform."""
    value = (machine or host_platform.machine()).lower()
    if value in {"x86_64", "amd64"}:
        return "linux/amd64"
    if value in {"aarch64", "arm64"}:
        return "linux/arm64"
    raise ValueError(f"unsupported architecture: {value}")


def _clean_text(value: object, label: str, maximum: int = 512) -> str:
    text = str(value)
    if not text or len(text) > maximum or any(ord(character) < 32 for character in text):
        raise ValueError(f"invalid {label}")
    return text


def build_docker_command(
    *,
    docker: str,
    image: str,
    platform: str,
    container_name: str,
    seccomp_path: Path,
    network: str = "none",
    allow_network: bool = False,
    fixture: bool = False,
) -> list[str]:
    """Build the exact argv used for the isolated runtime; never invokes a shell."""
    docker = _clean_text(docker, "docker executable")
    image = _clean_text(image, "image", maximum=255)
    if not _IMAGE_REFERENCE.fullmatch(image):
        raise ValueError("invalid image")
    if platform not in SUPPORTED_PLATFORMS:
        raise ValueError("platform must be linux/amd64 or linux/arm64")
    if not _CONTAINER_NAME.fullmatch(container_name):
        raise ValueError("invalid container name")
    if network not in {"none", "bridge"}:
        raise ValueError("network must be none or bridge")
    if network != "none" and not allow_network:
        raise ValueError("allow_network=True is required for browser egress")

    command = [
        docker,
        "run",
        "--rm",
        "-i",
        "--name",
        container_name,
        f"--platform={platform}",
        f"--network={network}",
        "--cap-drop=ALL",
        "--cap-add=SETUID",
        "--cap-add=SETGID",
        "--security-opt=no-new-privileges",
        "--security-opt=systempaths=unconfined",
        "--security-opt=apparmor=unconfined",
        f"--security-opt=seccomp={Path(seccomp_path).resolve()}",
        "--memory=1g",
        "--cpus=2",
        "--pids-limit=256",
        "--shm-size=256m",
    ]
    if fixture:
        command.append("--env=JET_BROWSER_SMOKE=1")
    command.append(image)
    return command


class JetBrowserProcess:
    """Own one Jet Browser container and one ordered JSONL command stream."""

    def __init__(
        self,
        *,
        image: str = JET_BROWSER_IMAGE,
        platform: str | None = None,
        docker: str = "docker",
        network: str = "none",
        allow_network: bool = False,
        fixture: bool = False,
        seccomp_path: Path | str = _DEFAULT_SECCOMP,
        command_timeout: float = 20.0,
        container_name: str | None = None,
        process_factory: Callable[..., subprocess.Popen[str]] = subprocess.Popen,
        cleanup_runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
    ) -> None:
        if not isinstance(command_timeout, (int, float)) or not 0 < command_timeout <= 120:
            raise ValueError("command_timeout must be greater than 0 and at most 120 seconds")
        self.image = image
        self.platform = platform or resolve_platform()
        self.docker = docker
        self.network = network
        self.allow_network = allow_network
        self.fixture = fixture
        self.seccomp_path = Path(seccomp_path).resolve()
        self.command_timeout = float(command_timeout)
        self.container_name = container_name or f"jet-browser-python-{uuid.uuid4()}"
        self._process_factory = process_factory
        self._cleanup_runner = cleanup_runner
        self._process: subprocess.Popen[str] | None = None
        self._stderr = ""
        self._stderr_lock = threading.Lock()
        self._stderr_thread: threading.Thread | None = None
        self._command_lock = threading.Lock()
        self._close_lock = threading.Lock()
        self._closed = False
        self._closing = False
        self._launched = False
        self._cleanup_complete = False

        # Validate every caller-controlled Docker argument before a process exists.
        build_docker_command(
            docker=self.docker,
            image=self.image,
            platform=self.platform,
            container_name=self.container_name,
            seccomp_path=self.seccomp_path,
            network=self.network,
            allow_network=self.allow_network,
            fixture=self.fixture,
        )

    def __enter__(self) -> "JetBrowserProcess":
        return self.start()

    def __exit__(self, exception_type, exception, traceback) -> bool:
        try:
            self.close()
        except Exception:
            if exception is None:
                raise
        return False

    def _drain_stderr(self) -> None:
        process = self._process
        if process is None or process.stderr is None:
            return
        for chunk in iter(lambda: process.stderr.read(1024), ""):
            with self._stderr_lock:
                self._stderr = (self._stderr + chunk)[-8000:]

    def _stderr_text(self) -> str:
        with self._stderr_lock:
            return self._stderr

    def _safe_error(self, value: object) -> str:
        text = str(value)
        text = "".join(character for character in text if ord(character) >= 32 or character == "\t")
        return " ".join(text.split())[:1000] or "Jet Browser command failed"

    def start(self) -> "JetBrowserProcess":
        if self._closed or self._closing:
            raise RuntimeError("Jet Browser process is already closed")
        if self._process is not None:
            if self._process.poll() is None:
                return self
            raise RuntimeError("Jet Browser process exited; create a new supervisor")
        if not self.seccomp_path.is_file():
            raise FileNotFoundError(f"seccomp policy not found: {self.seccomp_path}")

        command = build_docker_command(
            docker=self.docker,
            image=self.image,
            platform=self.platform,
            container_name=self.container_name,
            seccomp_path=self.seccomp_path,
            network=self.network,
            allow_network=self.allow_network,
            fixture=self.fixture,
        )
        try:
            self._process = self._process_factory(
                command,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
            )
            self._launched = True
            self._stderr_thread = threading.Thread(target=self._drain_stderr, daemon=True)
            self._stderr_thread.start()
            self.command(
                "create",
                proxy=None,
                profile_dir=None,
                page_load_strategy="none",
                timeout=max(45.0, self.command_timeout),
            )
            return self
        except Exception:
            self._stop_process()
            self._close_pipes()
            self._cleanup_container()
            raise

    def _read_line(self, timeout: float) -> str:
        process = self._process
        if process is None or process.stdout is None:
            raise RuntimeError("Jet Browser process is not running")
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            if not selector.select(timeout):
                raise TimeoutError("Jet Browser response timed out")
        line = process.stdout.readline(_MAX_RESPONSE_BYTES + 1)
        if len(line.encode("utf-8")) > _MAX_RESPONSE_BYTES:
            raise RuntimeError("Jet Browser response exceeded 24 MiB")
        if not line:
            detail = self._stderr_text()
            suffix = f": {detail}" if detail else ""
            raise RuntimeError(f"Jet Browser exited before responding{suffix}")
        return line

    def command(self, operation: str, timeout: float | None = None, **payload: Any) -> Any:
        if not _OPERATION.fullmatch(operation):
            raise ValueError("invalid Jet Browser operation")
        if self._process is None or self._process.stdin is None:
            raise RuntimeError("Jet Browser process is not running")
        if self._closed or (self._closing and operation != "close"):
            raise RuntimeError("Jet Browser process is already closed")
        response_timeout = self.command_timeout if timeout is None else float(timeout)
        if not 0 < response_timeout <= 120:
            raise ValueError("timeout must be greater than 0 and at most 120 seconds")

        encoded = json.dumps({"op": operation, **payload}, separators=(",", ":")) + "\n"
        if len(encoded.encode("utf-8")) > _MAX_COMMAND_BYTES:
            raise ValueError("Jet Browser command exceeded 1 MiB")

        with self._command_lock:
            if self._closed or (self._closing and operation != "close"):
                raise RuntimeError("Jet Browser process is already closed")
            try:
                self._process.stdin.write(encoded)
                self._process.stdin.flush()
                response = json.loads(self._read_line(response_timeout))
            except Exception as error:
                self._stop_process()
                raise RuntimeError(self._safe_error(error)) from error
        if not isinstance(response, Mapping) or not isinstance(response.get("ok"), bool):
            raise RuntimeError("Jet Browser returned an invalid protocol response")
        if not response["ok"]:
            raise RuntimeError(self._safe_error(response.get("error", "Browser command failed")))
        return response.get("value")

    def navigate(self, url: str) -> Any:
        parsed = urlsplit(url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("url must be HTTP(S) without embedded credentials")
        return self.command("navigate", url=url)

    def snapshot(self) -> Mapping[str, Any]:
        value = self.command("snapshot")
        if not isinstance(value, Mapping):
            raise RuntimeError("Jet Browser returned an invalid snapshot")
        return value

    def document_state(self) -> Mapping[str, Any]:
        value = self.command("document_state")
        if not isinstance(value, Mapping):
            raise RuntimeError("Jet Browser returned invalid document state")
        return value

    def wait_for_document(self, expected_url: str | None = None, timeout: float = 10.0) -> Mapping[str, Any]:
        deadline = time.monotonic() + timeout
        last: Mapping[str, Any] = {}
        while time.monotonic() < deadline:
            last = self.document_state()
            if last.get("readyState") == "complete" and (
                expected_url is None or last.get("url") == expected_url
            ):
                return last
            time.sleep(0.1)
        raise TimeoutError(f"document did not become ready: {last}")

    def native_input(self, events: Iterable[Mapping[str, Any]]) -> Any:
        event_list = list(events)
        if not event_list or len(event_list) > 1000:
            raise ValueError("events must contain between 1 and 1000 input events")
        return self.command("input", events=event_list)

    def evaluate(self, expression: str) -> Any:
        if not isinstance(expression, str) or not expression or len(expression) > 50_000:
            raise ValueError("expression must contain between 1 and 50000 characters")
        return self.command("evaluate", expression=expression)

    def screenshot(self) -> bytes:
        encoded = self.command("screenshot")
        if not isinstance(encoded, str):
            raise RuntimeError("Jet Browser screenshot was not base64 text")
        try:
            png = base64.b64decode(encoded, validate=True)
        except Exception as error:
            raise RuntimeError("Jet Browser screenshot was not valid base64") from error
        if len(png) < 1000 or not png.startswith(b"\x89PNG\r\n\x1a\n"):
            raise RuntimeError("Jet Browser screenshot was not a non-empty PNG")
        return png

    def _stop_process(self) -> None:
        process = self._process
        if process is None:
            return
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=2)

    def _close_pipes(self) -> None:
        process = self._process
        if process is None:
            return
        for stream in (process.stdin, process.stdout):
            if stream is not None and not stream.closed:
                stream.close()
        if self._stderr_thread is not None and self._stderr_thread is not threading.current_thread():
            self._stderr_thread.join(timeout=1)
        if process.stderr is not None and not process.stderr.closed:
            process.stderr.close()

    def _cleanup_container(self) -> None:
        if self._cleanup_complete:
            return
        self._cleanup_complete = True
        if not self._launched:
            return
        result = self._cleanup_runner(
            [self.docker, "rm", "-f", self.container_name],
            capture_output=True,
            text=True,
            timeout=10,
        )
        detail = f"{getattr(result, 'stdout', '')} {getattr(result, 'stderr', '')}"
        if result.returncode and "No such container" not in detail:
            raise RuntimeError("Jet Browser container cleanup failed")

    def close(self) -> None:
        with self._close_lock:
            if self._closed:
                return
            self._closing = True
            primary_error: Exception | None = None
            try:
                if self._process is not None and self._process.poll() is None:
                    self.command("close", timeout=min(10.0, self.command_timeout))
                    if self._process.stdin is not None:
                        self._process.stdin.close()
                    try:
                        self._process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        self._stop_process()
            except Exception as error:
                primary_error = error
                self._stop_process()
            finally:
                self._closed = True
                self._close_pipes()
                try:
                    self._cleanup_container()
                except Exception as cleanup_error:
                    if primary_error is None:
                        primary_error = cleanup_error
            if primary_error is not None:
                raise primary_error
