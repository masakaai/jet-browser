# Jet Browser for Hermes

This Hermes plugin registers one model-callable tool, `jet_browser_verify`.
It runs Jet Browser's real standalone acceptance check in a short-lived Docker
container and returns structured evidence for browser startup, native input,
DOM agreement, PNG capture, and cleanup.

This first integration is intentionally narrow. It verifies the runtime; it
does not replace Hermes' CDP browser backend, browse public sites, attach to a
personal Chrome profile, or keep a browser daemon running. Jet Browser uses WPE
WebKit and ordered JSONL rather than Chromium CDP, so presenting it as a native
Hermes browser provider would be misleading.

## Install

Requirements: Linux, Docker, and Hermes Agent 0.21.6 or newer.

```bash
hermes plugins install masakaai/jet-browser/integrations/hermes
hermes plugins enable jet-browser
```

Start Hermes and ask:

```text
Verify the Jet Browser runtime and report the evidence.
```

The tool returns JSON shaped like:

```json
{
  "success": true,
  "network": "disabled",
  "title": "Jet Browser Ready",
  "input": "open-source runtime",
  "screenshot_bytes": 12345,
  "screenshot_sha256": "...",
  "duration_ms": 1450
}
```

## Security and operational boundaries

- The OCI image is pinned to an immutable digest and currently targets
  `linux/amd64`.
- Docker may contact GitHub Container Registry the first time it needs the
  pinned image. The browser container itself runs with networking disabled.
- The container drops all capabilities before selectively restoring only
  `SETUID` and `SETGID`, sets `no-new-privileges`, uses the checked-in seccomp
  profile, and has CPU, memory, PID, and shared-memory limits.
- The plugin invokes Docker with a fixed argument vector and never opens a
  shell. On timeout or failure it terminates the client and force-removes only
  the uniquely named container it created.
- No credentials, browser profiles, telemetry, accounts, API keys, or hosted
  Jet Browser service are used.

## Validate the plugin

From a Hermes Agent checkout:

```bash
hermes plugins validate /path/to/jet-browser/integrations/hermes --install-deps
```

The plugin's stdlib-only contract tests can also run directly:

```bash
python -m unittest discover -s integrations/hermes/tests -v
```

Jet Browser source, benchmark method, raw samples, and the broader standalone
quick start live at <https://github.com/masakaai/jet-browser>.
