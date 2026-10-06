# Jet Browser

<p align="center">
  <strong>A small, open browser runtime for web agents.</strong><br>
  WPE WebKit, native input, deterministic automation, and an embeddable JSONL protocol.
</p>

![Jet Browser open-source browser runtime](./docs/assets/jet-browser-banner.png)

<p align="center">
  English · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="./README.ko.md">한국어</a> · <a href="./README.de.md">Deutsch</a> · <a href="./README.fr.md">Français</a> · <a href="./README.es.md">Español</a> · <a href="./README.pt-BR.md">Português</a>
</p>

![Node.js 24+](https://img.shields.io/badge/Node.js-24%2B-292622?style=flat-square)
![Rust stable](https://img.shields.io/badge/Rust-stable-292622?style=flat-square)
![WPE WebKit 2.54](https://img.shields.io/badge/WPE%20WebKit-2.54-eeb28a?style=flat-square)
![License](https://img.shields.io/badge/license-Apache--2.0-eeb28a?style=flat-square)
[![CI](https://github.com/masakaai/jet-browser/actions/workflows/ci.yml/badge.svg)](https://github.com/masakaai/jet-browser/actions/workflows/ci.yml)

Jet Browser packages a real WPE WebKit browser and a Rust WebDriver bridge into a self-contained runtime for agents. Run one isolated session per container, send ordered JSON commands over standard input, and receive machine-readable results over standard output.

No account, API key, database, or hosted control plane is required.

## Run the verified standalone flow

Requirements: Docker and Node.js 24+. The smoke test builds the image and runs the container with networking disabled. It creates a browser, opens a local page, types through the native input path, verifies the DOM, captures a screenshot, and closes the session.

~~~bash
git clone https://github.com/masakaai/jet-browser.git
cd jet-browser
npm run standalone
~~~

Successful output includes:

~~~json
{
  "status": "passed",
  "network": "disabled",
  "title": "Jet Browser Ready",
  "input": "open-source runtime"
}
~~~

To run the container directly without installing JavaScript dependencies:

~~~bash
docker build -f Dockerfile.standalone -t jet-browser:local .

printf '%s\n' \
  '{"op":"create","proxy":null,"profile_dir":null,"page_load_strategy":"eager"}' \
  '{"op":"navigate","url":"http://127.0.0.1:8080/"}' \
  '{"op":"title"}' \
  '{"op":"close"}' |
docker run --rm -i --network=none --cap-drop=ALL \
  --env=JET_BROWSER_SMOKE=1 \
  --cap-add=SETUID --cap-add=SETGID \
  --security-opt=apparmor=unconfined \
  --security-opt=systempaths=unconfined \
  --security-opt=seccomp=./seccomp_profile.json \
  --security-opt=no-new-privileges --memory=1g --cpus=2 \
  --pids-limit=256 --shm-size=256m jet-browser:local
~~~

## What ships

| Capability | Open-source implementation |
| --- | --- |
| Real browser | WPE WebKit 2.54 on a headless Wayland compositor |
| Automation bridge | Rust binary with an ordered line-delimited JSON protocol |
| Native interaction | Pointer, keyboard, text, touch, wheel, drag, navigation, and tabs |
| Page inspection | Title, URL, JavaScript evaluation, screenshots, and semantic DOM capture |
| Session state | Cookie and web-storage import/export helpers with explicit profile paths |
| Downloads | Bounded download lifecycle and metadata |
| Live viewing | Visual-frame and Live DOM components for an optional direct data plane |
| Agent integration | Versioned JSON Schema tool declarations with collision checks |

The standalone image contains only the browser runtime and operating-system libraries it needs. It does not install an application server, JavaScript package tree, database client, tunnel, payment SDK, or vendor agent framework.

## Architecture

~~~text
agent or test process
        │  JSONL over stdin/stdout
        ▼
    jet-wpe (Rust)
        │  WebDriver
        ▼
  WPE WebKit + Weston
~~~

This boundary is intentionally small. A local process, container scheduler, CI job, or agent framework can supervise it without adopting a particular control plane. Distributed preview, human takeover, persistence, and scheduling are optional components built around the same runtime; they are not required for standalone use.

See [Architecture](./docs/architecture.md) and the [standalone demo](./docs/demo.md).

## Protocol example

Each input line is one JSON command. Each output line is one JSON response.

~~~json
{"op":"create","proxy":null,"profile_dir":null,"page_load_strategy":"eager"}
{"op":"navigate","url":"https://example.com"}
{"op":"title"}
{"op":"screenshot"}
{"op":"close"}
~~~

Use a dedicated container per mutually untrusted session. Treat evaluate, imported profiles, downloads, and outbound network access as privileged capabilities in your own integration.

The smoke-only loopback page starts only when JET_BROWSER_SMOKE=1. The included seccomp profile permits the user and mount namespace operations required by WPE WebKit's own bubblewrap sandbox. On AppArmor hosts, the outer container profile is disabled because it blocks that inner sandbox; the process still receives no SYS_ADMIN capability, no effective capabilities after startup, and no privileged mode.

## Develop and verify

~~~bash
npm ci
npm test
cargo test --all-targets
~~~

Build only the standalone runtime:

~~~bash
docker build -f Dockerfile.standalone -t jet-browser:local .
~~~

Build the optional distributed worker:

~~~bash
docker build -f Dockerfile.wpe-worker -t jet-browser-worker:local .
~~~

## Project map

- [rust/](./rust) — native WebDriver bridge and browser helpers
- [src/](./src) — optional distributed worker, preview, input, state, and safety boundaries
- [sdk/](./sdk) — client transports and agent tool declarations
- [scripts/standalone-smoke.mjs](./scripts/standalone-smoke.mjs) — offline end-to-end verification
- [test/](./test) — Node regression tests; Rust tests live beside their modules
- [docs/](./docs) — protocol, architecture, and integration notes

## Scope

Jet Browser is browser infrastructure, not an LLM or agent framework. The core exposes its JSONL action protocol rather than pretending WPE implements Chromium-only extension, policy, or CDP contracts.

Jet Browser is licensed under [Apache License 2.0](./LICENSE). Read [Contributing](./CONTRIBUTING.md) and [Security](./SECURITY.md) before deploying or changing the protocol.
