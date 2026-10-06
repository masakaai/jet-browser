# Kernel open-source design review

This is an engineering review, not a product endorsement or a claim that MASAKA implements Chromium-only contracts. Sources were inspected on 2026-10-06 at the revisions below.

| Repository | Revision | Relevant design |
|---|---:|---|
| [kernel/kernel-images](https://github.com/kernel/kernel-images) | `2cbca84` | Browser image, process supervision, readiness, internal metrics, CDP proxy, Neko WebRTC live view |
| [kernel/browser-loop](https://github.com/kernel/browser-loop) | `22b741d` | Framework-neutral, identity-keyed tool catalog and shared execution resources |
| [kernel/kernel-node-sdk](https://github.com/kernel/kernel-node-sdk) | `f98bcb5` | Typed errors, bounded retries/timeouts, pagination, package entry points |
| [kernel/cli](https://github.com/kernel/cli) | `4aff0a9` | Resource-oriented commands, pagination validation, machine-readable output |
| [kernel/browserbench](https://github.com/kernel/browserbench) | `5675256` | Repeated lifecycle measurements, warmups, stage timing, JSONL evidence |
| [kernel/kernel-mcp-server](https://github.com/kernel/kernel-mcp-server) | `004860d` | Remote authenticated tool surface and protocol-version compatibility |

## Adopted in Jet Browser

### Control plane and data plane remain separate

Preview and interactive input continue over persistent session connections. Database, billing, project CRUD, and session allocation remain outside the hot path. Preview mode is fixed before launch, so a session does not pay for Visual and Live DOM simultaneously.

### Runtime observability is internal and bounded

The worker direct server exposes Prometheus text at `GET /metrics` only when a dedicated metrics token is configured, and requires that token as a bearer credential. This keeps the route protected even behind a standalone public data-plane tunnel. It publishes aggregate session, connection, buffer, authorization, input-processing, preview, backpressure, and slow-client counters without session IDs, user IDs, URLs, or other high-cardinality labels.

### SDK failures are explicit

Both server and signed-in clients use the shared `MasakaTransport`:

- 60-second default timeout with per-client overrides;
- structured HTTP, connection, timeout, and caller-abort errors;
- bounded exponential backoff with `Retry-After` support;
- automatic retries only for safe reads unless a caller explicitly marks an idempotent mutation;
- server-validated page objects and async iteration beyond the first 100 sessions.

Unlike a generic retry policy, session creation is not retried after an ambiguous network failure. Retrying an allocation POST without a backend idempotency contract could create and bill two sessions.

### Agent tools have stable identities

`sdk/tools.mjs` separates declaration compilation from execution binding. Catalog compilation is pure, rejects collisions, and never provisions a browser. A bound catalog shares one existing client/session resource. Arbitrary JavaScript evaluation is outside the default toolset.

## Not copied

### Public CDP

Kernel Images runs Chromium and can expose CDP. Jet Browser currently runs WPE WebKit and must not advertise a fake CDP surface. A future Chromium tier would be a separate engine capability.

### Neko WebRTC as-is

Kernel's live view is built around an Xorg input driver, Neko, GStreamer, and Chromium. Jet Browser uses isolated Weston/Wayland displays and WPE. Reusing the browser client UX is reasonable; copying the container configuration or claiming WebRTC support without a WPE/Wayland capture and input bridge is not.

The production `0.6.4` worker pool was inspected read-only on 2026-10-06. Its two browser slots run Weston 16 with `headless-backend.so`, kiosk shell, pixman rendering, and independent Wayland sockets. The image has a VPX GStreamer plugin but no `gst-inspect-1.0`, `webrtcbin`, or `pipewiresrc`. Therefore WebRTC is not a configuration toggle in the current image: it needs a capture source, encoder/WebRTC runtime, authenticated signalling, TURN, and a Wayland-compatible input path.

The production decision gate for a WebRTC tier is:

1. a WPE/Wayland-native capture path with no per-frame subprocess;
2. session-scoped authentication before SDP/ICE exchange;
3. input fenced by the existing control epoch;
4. TURN behavior measured from China and overseas clients;
5. CPU, memory, first-frame, steady bitrate, packet-loss recovery, and reconnect measurements against current Visual WSS;
6. no database, Vercel, or object storage in the media/input path.

### Unikernel snapshots

Kernel Images documents suspend/resume around its own Unikraft deployment. Jet Browser keeps portable encrypted profile state for 24 hours. VM memory snapshots would have different credential, isolation, billing, and invalidation semantics and are not claimed.

## Areas where Jet Browser deliberately differs

- Visual WSS drops replaceable stale whole frames under backpressure; reliable Live DOM snapshots require acknowledgement.
- Control tickets are session-, worker-, user-, project-, preview-mode-, and epoch-bound.
- WPE-compatible state is restored at the storage layer rather than by promising Chrome-profile or extension compatibility.
- Benchmark cleanup failures count as failed samples; target pages must match a title or DOM marker before a run passes.
