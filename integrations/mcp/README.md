# Jet Browser MCP verifier

This local stdio server gives an MCP client one narrow way to verify Jet Browser. It starts the immutable public `linux/amd64` image, disables browser networking, opens the image's local fixture, types through native input, checks the DOM, captures a fresh PNG, and cleans up.

It is a runtime verifier, not a general browsing server. It does not expose public-web navigation, CDP, personal browser profiles, credentials, a hosted service, or telemetry.

## Requirements

- Node.js 24+
- Docker
- An x86_64 host, or Docker amd64 emulation

The first verification may pull the public image from GHCR. Browser execution itself uses Docker's `--network=none` boundary. The image is pinned by digest in [`server.mjs`](./server.mjs).

## Install

~~~bash
git clone https://github.com/masakaai/jet-browser.git
cd jet-browser
npm ci
~~~

Add the server to an MCP client with an absolute checkout path:

~~~json
{
  "mcpServers": {
    "jet-browser": {
      "command": "node",
      "args": ["/absolute/path/to/jet-browser/integrations/mcp/server.mjs"]
    }
  }
}
~~~

The process speaks MCP on stdout and writes operational errors only to stderr. It exits when the client closes stdin.

## Tools

| Tool | Behavior |
| --- | --- |
| `jet_browser_capabilities` | Returns the pinned image, platform, evidence contract, and explicit non-capabilities without starting Docker. |
| `jet_browser_verify` | Runs one bounded verification and returns startup, native-input, DOM, screenshot, network, and image evidence. |

Only one verification can run at a time. A client-side cancellation aborts the child process. The server caps child output and total runtime; failures are returned as MCP tool errors rather than protocol failures.

A successful call returns structured content like:

~~~json
{
  "status": "passed",
  "network": "disabled",
  "title": "Jet Browser Ready",
  "input": "open-source runtime",
  "screenshotBytes": 2048,
  "image": "ghcr.io/masakaai/jet-browser@sha256:540a1fec531bf71b62c2c2d030c033249955ffc192ab7e0e7a1ac8d8412a661b"
}
~~~

The screenshot byte count varies. A pass requires at least 1,000 decoded PNG bytes and exact agreement among the expected page title, native text input, and DOM state.

## Verify the integration

The protocol test starts the real stdio server, performs an MCP handshake, lists its tools, and calls the capability tool without requiring Docker:

~~~bash
node --test test/mcp-server.test.mjs
~~~

The repository's standalone CI remains the end-to-end runtime proof. To execute that same Docker acceptance locally:

~~~bash
DOCKER_DEFAULT_PLATFORM=linux/amd64 \
JET_BROWSER_IMAGE=ghcr.io/masakaai/jet-browser@sha256:540a1fec531bf71b62c2c2d030c033249955ffc192ab7e0e7a1ac8d8412a661b \
npm run standalone:smoke
~~~

## Security boundary

- The MCP call accepts no command, URL, image, profile, or path argument.
- The child process receives only the Docker connection variables it needs; application secrets are not forwarded.
- The container has browser networking disabled, bounded CPU, memory, PIDs, shared memory, and capabilities, and is removed after the check.
- The verifier never attaches to a running personal browser.
- Treat Docker access as privileged host access. Only configure this server for trusted local MCP clients.

For a broader embedding boundary, use Jet Browser's versioned tool declarations in [`sdk/tools.mjs`](../../sdk/tools.mjs) and supervise each isolated container from your own harness.
