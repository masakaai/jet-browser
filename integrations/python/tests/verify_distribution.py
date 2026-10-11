#!/usr/bin/env python3
"""Verify Jet Browser Python artifacts and an isolated wheel installation."""

from __future__ import annotations

import argparse
import json
import stat
import subprocess
import sys
import tarfile
import tempfile
import venv
import zipfile
from email.parser import BytesParser
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parents[3]
PACKAGE_ROOT = ROOT / "integrations" / "python"
EXPECTED_VERSION = json.loads((ROOT / "package.json").read_text())["version"]


def safe_member(name: str) -> bool:
    path = PurePosixPath(name)
    return bool(name) and not path.is_absolute() and ".." not in path.parts and "\\" not in name


def inspect_wheel(wheel: Path) -> dict[str, object]:
    with zipfile.ZipFile(wheel) as archive:
        entries = archive.infolist()
        names = [entry.filename for entry in entries]
        if not all(safe_member(name) for name in names):
            raise RuntimeError("wheel contains an unsafe archive path")
        if len(names) != len(set(names)):
            raise RuntimeError("wheel contains duplicate archive paths")
        if any(stat.S_ISLNK(entry.external_attr >> 16) for entry in entries):
            raise RuntimeError("wheel must not contain symbolic links")

        required = {
            "jet_browser/__init__.py",
            "jet_browser/jet_browser.py",
            "jet_browser/py.typed",
            "jet_browser/seccomp_profile.json",
        }
        missing = sorted(required.difference(names))
        if missing:
            raise RuntimeError(f"wheel is missing package files: {missing}")

        metadata_names = [name for name in names if name.endswith(".dist-info/METADATA")]
        if len(metadata_names) != 1:
            raise RuntimeError("wheel must contain exactly one METADATA file")
        metadata = BytesParser().parsebytes(archive.read(metadata_names[0]))
        if metadata["Name"] != "jet-browser" or metadata["Version"] != EXPECTED_VERSION:
            raise RuntimeError("wheel metadata does not match the repository release")
        if metadata.get_all("Requires-Dist", []):
            raise RuntimeError("wheel unexpectedly declares a runtime dependency")

        licenses = [name for name in names if name.endswith(".dist-info/licenses/LICENSE")]
        if len(licenses) != 1 or archive.read(licenses[0]) != (ROOT / "LICENSE").read_bytes():
            raise RuntimeError("wheel license is missing or differs from the repository")
        if archive.read("jet_browser/seccomp_profile.json") != (ROOT / "seccomp_profile.json").read_bytes():
            raise RuntimeError("wheel seccomp policy differs from the repository")

    return {"wheelFiles": len(names), "runtimeDependencies": 0}


def inspect_sdist(sdist: Path) -> dict[str, object]:
    with tarfile.open(sdist, "r:gz") as archive:
        members = archive.getmembers()
        if not all(safe_member(member.name) for member in members):
            raise RuntimeError("sdist contains an unsafe archive path")
        if any(not (member.isfile() or member.isdir()) for member in members):
            raise RuntimeError("sdist must contain only regular files and directories")

        names = [member.name for member in members]
        required_suffixes = (
            "/LICENSE",
            "/README.md",
            "/__init__.py",
            "/jet_browser.py",
            "/py.typed",
            "/seccomp_profile.json",
        )
        for suffix in required_suffixes:
            matches = [name for name in names if name.endswith(suffix)]
            if len(matches) != 1:
                raise RuntimeError(f"sdist must contain one file ending in {suffix}")
        policy_name = next(name for name in names if name.endswith("/seccomp_profile.json"))
        extracted = archive.extractfile(policy_name)
        if extracted is None or extracted.read() != (ROOT / "seccomp_profile.json").read_bytes():
            raise RuntimeError("sdist seccomp policy differs from the repository")

    return {"sdistFiles": len(names), "links": 0}


def install_and_import(wheel: Path) -> dict[str, object]:
    with tempfile.TemporaryDirectory(prefix="jet-browser-wheel-") as directory:
        environment = Path(directory) / "venv"
        venv.EnvBuilder(with_pip=True, clear=True).create(environment)
        python = environment / "bin" / "python"
        subprocess.run(
            [str(python), "-m", "pip", "install", "--no-index", "--no-deps", str(wheel)],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        probe = (
            "import json; "
            "from jet_browser import JetBrowserProcess, build_docker_command; "
            "import jet_browser.jet_browser as implementation; "
            "policy=implementation._DEFAULT_SECCOMP; "
            "assert policy.is_file(); "
            "process=JetBrowserProcess(container_name='jet-browser-wheel-check'); "
            "command=build_docker_command(docker='docker', image=process.image, "
            "platform=process.platform, container_name=process.container_name, "
            "seccomp_path=policy); "
            "assert '--network=none' in command; "
            "print(json.dumps({'package':JetBrowserProcess.__module__.split('.')[0],"
            "'policy':policy.name,'network':'none'},separators=(',',':')))"
        )
        completed = subprocess.run(
            [str(python), "-I", "-c", probe],
            cwd=directory,
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        return json.loads(completed.stdout)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    arguments = parser.parse_args()
    wheels = sorted(arguments.directory.glob("*.whl"))
    sdists = sorted(arguments.directory.glob("*.tar.gz"))
    if len(wheels) != 1 or len(sdists) != 1:
        raise RuntimeError("expected exactly one wheel and one source distribution")

    result = {
        "status": "passed",
        "version": EXPECTED_VERSION,
        **inspect_wheel(wheels[0]),
        **inspect_sdist(sdists[0]),
        "installed": install_and_import(wheels[0]),
    }
    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()
