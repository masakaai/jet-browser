#!/usr/bin/env python3
"""Exercise Jet Browser from Python without third-party packages."""

import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "integrations" / "python"))

from jet_browser import JET_BROWSER_IMAGE, JetBrowserProcess  # noqa: E402


def evaluation_value(value):
    evaluation = value.get("evaluation") if isinstance(value, dict) else None
    if isinstance(evaluation, dict):
        if evaluation.get("exceptionDetails"):
            raise RuntimeError("browser evaluation failed")
        result = evaluation.get("result")
        if isinstance(result, dict) and "value" in result:
            return result["value"]
    if isinstance(value, dict) and isinstance(value.get("result"), dict):
        return value["result"].get("value", value)
    return value


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", default=JET_BROWSER_IMAGE)
    parser.add_argument("--platform", choices=("linux/amd64", "linux/arm64"))
    arguments = parser.parse_args()

    target = "http://127.0.0.1:8080/"
    with JetBrowserProcess(
        image=arguments.image,
        platform=arguments.platform,
        fixture=True,
    ) as browser:
        browser.navigate(target)
        browser.wait_for_document(target)
        snapshot = browser.snapshot()
        browser.native_input([
            {"type": "pointer", "phase": "down", "x": 180, "y": 42, "button": 0},
            {"type": "pointer", "phase": "up", "x": 180, "y": 42, "button": 0},
            {"type": "text", "text": "python supervisor"},
        ])
        observed = evaluation_value(browser.evaluate(
            "(()=>({input:document.querySelector('#message')?.value,"
            "result:document.querySelector('#result')?.value}))()"
        ))
        if observed != {"input": "python supervisor", "result": "python supervisor"}:
            raise RuntimeError("native input and DOM state did not agree")
        screenshot = browser.screenshot()

    print(json.dumps({
        "status": "passed",
        "network": "disabled",
        "title": snapshot.get("title"),
        "input": observed["input"],
        "screenshotBytes": len(screenshot),
        "image": arguments.image,
        "platform": browser.platform,
        "cleanup": "passed",
    }, separators=(",", ":")))


if __name__ == "__main__":
    main()
