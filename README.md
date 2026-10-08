<p align="center">
  <img width="100%" src="./docs/assets/jet-browser-banner.svg" alt="Jet Browser — a small browser runtime for web agents">
</p>

<p align="center">
  English · <a href="./README.zh-CN.md">简体中文</a> · <a href="./README.ja.md">日本語</a> · <a href="./README.ko.md">한국어</a> · <a href="./README.de.md">Deutsch</a> · <a href="./README.fr.md">Français</a> · <a href="./README.es.md">Español</a> · <a href="./README.pt-BR.md">Português</a>
</p>

<p align="center">
  <img alt="Node.js 24+" src="https://img.shields.io/badge/Node.js-24%2B-292622?style=flat-square">
  <img alt="Rust stable" src="https://img.shields.io/badge/Rust-stable-292622?style=flat-square">
  <img alt="WPE WebKit 2.54" src="https://img.shields.io/badge/WPE%20WebKit-2.54-e87532?style=flat-square">
  <img alt="Apache-2.0 license" src="https://img.shields.io/badge/license-Apache--2.0-e87532?style=flat-square">
  <a href="https://github.com/masakaai/jet-browser/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/masakaai/jet-browser/actions/workflows/ci.yml/badge.svg"></a>
</p>

Jet Browser packages WPE WebKit and a Rust WebDriver bridge as a standalone runtime. One container runs one isolated browser session; your harness sends ordered JSONL commands and receives machine-readable results.

Bring any harness or deterministic test runner. No account, API key, model, database, or hosted control plane is required.

<p align="center">
  <a href="https://masaka-ai.vercel.app/jet-browser/">Product overview</a> ·
  <a href="https://masaka-ai.vercel.app/jet-browser/tech-report/">Technical report</a> ·
  <a href="./docs/benchmarks.md">Method</a> ·
  <a href="./benchmarks/results/runtime-2026-10-07.json">Raw samples</a>
</p>

## Reproducible runtime benchmark

Jet Browser reached a verified page in **1,445.25 ms** with **189.6 MiB** of active memory—**72.7% lower ready time** and **33.2% lower memory** than the next result. [Method](./docs/benchmarks.md) · [Raw data](./benchmarks/results/runtime-2026-10-07.json)

<p align="center">
  <img width="100%" src="./docs/assets/runtime-benchmark.svg" alt="Horizontal bar charts comparing median verified browser-ready time and active container memory for Jet Browser, Browser Use, Steel Browser, and Browserless. Lower is better in both panels.">
</p>

## Let your coding agent verify it

Paste this single line into Codex, Claude Code, or another repository-aware coding agent. GitHub code blocks include a one-click copy action.

~~~text
Install or upgrade Jet Browser to the latest main for this repository from https://github.com/masakaai/jet-browser. Read README.md and use its Codex marketplace instructions when plugin commands are available; otherwise register .agents/skills/jet-browser/SKILL.md as a repository skill. Confirm Docker and Node.js 24+, run npm run standalone, and report whether browser startup, native input, DOM verification, and PNG capture passed. Do not attach to my daily Chrome profile or start a persistent Chrome daemon. Follow docs/demo.md if setup or verification fails.
~~~

## Quick start

Requirements: Docker and Node.js 24+.

### 1. Install the Codex plugin

Add MASAKA's repository marketplace, then install the Jet Browser plugin:

~~~bash
codex plugin marketplace add masakaai/jet-browser --ref main && codex plugin add jet-browser@masaka
~~~

The plugin installs the Jet Browser skill, which teaches Codex how to check requirements, run the verified standalone flow, integrate the versioned tool schemas, and preserve the runtime's safety boundaries. The same repository-local skill is available at [`.agents/skills/jet-browser/SKILL.md`](./.agents/skills/jet-browser/SKILL.md) for agents that discover project skills directly.

### 2. Run the verified standalone flow

The smoke test builds the image, disables outbound networking, starts a real browser, opens a local page, types through the native input path, verifies the DOM, captures a PNG, and closes the session.

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

### 3. Embed the runtime boundary

Each input line is one JSON command; each output line is one JSON response. A supervisor in any language can own the container lifecycle and keep the model or harness replaceable.

~~~bash
docker build -f Dockerfile.standalone -t jet-browser:local .

printf '%s\n' \
  '{"op":"create","proxy":null,"profile_dir":null,"page_load_strategy":"none"}' \
  '{"op":"navigate","url":"http://127.0.0.1:8080/"}' \
  '{"op":"document_state"}' \
  '{"op":"snapshot"}' \
  '{"op":"screenshot"}' \
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

For model-facing tools, use the versioned declarations in [`sdk/tools.mjs`](./sdk/tools.mjs) and the framework-neutral binding pattern in [Agent tool catalog](./docs/agent-tools.md).

## Why Jet Browser

| Design choice | What it gives an agent system |
| --- | --- |
| **A browser runtime, not a bundled agent** | Bring any model, tool loop, orchestration framework, or deterministic test runner. |
| **One isolated session per container** | Clear lifecycle, resource limits, profile ownership, and failure cleanup. |
| **Ordered JSONL over stdin/stdout** | A small integration boundary with no required daemon, database, account, or cloud API. |
| **Native input plus semantic and visual evidence** | Pointer, keyboard, touch, tabs, DOM capture, JavaScript results, and screenshots share one runtime. |
| **Versioned tool schemas** | Bind Jet to an agent harness without letting model/tool naming changes mutate the execution contract. |
| **Standalone core, optional distributed layer** | Start locally; add preview, takeover, persistence, regional scheduling, and fleet control only when needed. |

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

## Pick the right layer

These projects solve different parts of browser automation. The table labels the boundary instead of turning unlike products into a feature-score contest.

| Project | Primary layer | Browser/control boundary | Included in this runtime benchmark |
| --- | --- | --- | :---: |
| **Jet Browser** | Standalone browser runtime | WPE WebKit + ordered JSONL | ✓ |
| Browser Use | Agent framework with browser automation | Chromium through its runtime/SDK | ✓ |
| Steel Browser | Self-hosted browser API | Chromium through HTTP and WebSocket APIs | ✓ |
| Browserless | Browser execution service | Chromium through CDP/WebSocket | ✓ |
| Stagehand v4 | Model-backed automation SDK | Extension/CDP action layer | — different boundary |

Read the [deployment and competitor comparison](./docs/comparison.md) for the source links, inclusion rules, and the capabilities Jet deliberately leaves to the embedding harness.

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
{"op":"create","proxy":null,"profile_dir":null,"page_load_strategy":"none"}
{"op":"navigate","url":"https://example.com"}
{"op":"document_state"}
{"op":"snapshot"}
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
