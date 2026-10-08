---
name: jet-browser
description: Install, verify, integrate, or troubleshoot the Jet Browser WPE WebKit runtime when a project needs an isolated browser process, ordered JSONL automation, native input, screenshots, or framework-neutral browser tools. Do not use for controlling an already-running personal Chrome profile; use the environment's CDP workflow for that.
---

# Jet Browser

Use Jet Browser as a replaceable browser-runtime boundary. Keep model choice, agent reasoning, credentials, and orchestration in the calling project.

## Setup and verification

1. Reuse an existing Jet Browser checkout when the project already contains one. Otherwise use `https://github.com/masakaai/jet-browser` and keep the checkout location explicit.
2. Check for Docker and Node.js 24+ before running the standalone flow. If either is unavailable, report the missing requirement instead of claiming verification succeeded.
3. Run `npm ci`, then `npm run standalone`. Treat its JSON result as the acceptance check: the local page, JavaScript marker, native text input, screenshot, network isolation, and clean shutdown must all pass.
4. For source changes, run `npm test` and `cargo test --all-targets` as well.

## Integration

- Read `docs/demo.md` for the container lifecycle and `docs/agent-tools.md` for model-facing tool declarations.
- Prefer the versioned declarations exported by `sdk/tools.mjs`; do not invent tool names or response fields.
- Send one JSON command per line and consume one JSON response per line. Preserve ordering and always close the session in guaranteed cleanup.
- Keep one isolated browser session per container. Mount profile or download paths explicitly and never pass unrelated host credentials into the container.
- Use semantic evidence for target selection and screenshots for visual verification when both are available.
- The runtime is WPE WebKit, not Chromium. Do not promise CDP, Chrome-extension, or Chromium-only compatibility.

## Product boundaries

Jet Browser is local/self-hosted browser infrastructure, not an agent framework, anti-bot service, or hosted proxy network. For MASAKA's managed browser control plane, use the API documentation at `https://masaka-ai.vercel.app/docs/` instead.

Benchmark claims must retain their scope. The published 1,445.25 ms ready time and 189.6 MiB active memory are medians from the pinned offline fixture; they do not measure public-site success, stealth, CAPTCHA handling, model accuracy, or long-running stability. See `https://masaka-ai.vercel.app/jet-browser/tech-report/` for method and raw samples.
