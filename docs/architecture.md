# Architecture

Jet Browser has a self-contained core and optional distributed components. The core has no hosted-service dependency.

## Standalone core

~~~mermaid
flowchart LR
  Host[Agent, test, or supervisor] <-->|JSONL stdin/stdout| Bridge[jet-wpe Rust bridge]
  Bridge <-->|WebDriver on loopback| Driver[WPEWebDriver]
  Driver <--> Browser[WPE WebKit]
  Browser <--> Compositor[Weston headless compositor]
~~~

One container owns one isolated browser session. The container entrypoint starts the compositor and WPEWebDriver, waits for the local status endpoint, and then exposes the Rust process on standard input and output. The process does not need a user account, API key, database, object storage, tunnel, or public network.

The JSONL boundary makes the runtime usable from any language that can supervise a subprocess. Commands remain ordered because one process reads and writes one line at a time.

## Optional distributed deployment

Larger deployments can place an application-specific coordinator around the same runtime.

~~~mermaid
flowchart LR
  Client[Agent or viewer] <-->|persistent preview and input| Router[Data router]
  Router <-->|session-bound stream| Worker[Jet Browser worker]
  Coordinator[Coordinator] -->|lease and lifecycle| Worker
  Worker --> Bridge[jet-wpe]
  Bridge --> WPE[WPE WebKit]
  Worker -.->|batched usage and action records| Coordinator
~~~

The coordinator implementation is deliberately not part of the standalone contract. An operator can use any identity provider, scheduler, database, storage layer, billing system, or container platform. Those systems should stay outside the latency-sensitive preview and input path.

## Browser lifecycle

~~~mermaid
sequenceDiagram
  participant H as Host process
  participant J as jet-wpe
  participant D as WPEWebDriver
  participant B as WPE WebKit

  H->>J: create
  J->>D: WebDriver session
  D->>B: launch isolated browser
  H->>J: navigate / input / evaluate
  J->>D: ordered commands
  D->>B: native browser actions
  B-->>J: result
  J-->>H: one JSON response line
  H->>J: close
  J->>D: delete session
~~~

The host must close sessions in a finally/defer block and enforce its own wall-clock timeout. Terminating the container also terminates the compositor, driver, and browser process tree.

## Preview modes

The optional worker supports two preview strategies. Choose one before launch so a session does not pay for two capture systems.

- **Visual** sends changed PNG frames captured from the compositor. Unchanged frames are not repeated. This is the compatibility-first mode for arbitrary sites.
- **Live DOM** sends a semantic DOM/CSSOM snapshot followed by mutations. It can reduce steady-state bandwidth but cannot perfectly reproduce every canvas, media element, cross-origin frame, or browser-native surface.

Both modes use bounded queues and backpressure. Reliable input acknowledgements have priority over replaceable preview work.

## Input and control

The runtime supports pointer phases, keyboard events, text, touch mapping, wheel, drag, navigation, snapshots, tab create/switch/close, downloads, and scoped credential fill.

A distributed controller can maintain a monotonically increasing control epoch. Taking or releasing control advances the epoch so commands from a stale agent or viewer cannot mutate a session after ownership changes. Reliable actions stay ordered; replaceable pointer movements and wheel deltas may be coalesced under pressure.

## State and isolation

A standalone instance should receive a dedicated container, runtime directory, Wayland socket, browser process, and profile path. Do not share writable profile paths between simultaneously running instances.

Profile helpers can export and import cookies, local/session storage, IndexedDB records, and CacheStorage. The embedding application is responsible for encryption, ownership checks, retention, and access control before persisting that data.

Browser processes should receive a minimal environment. Keep application credentials, database keys, payment secrets, and signing keys out of the browser container. If outbound networking is enabled, apply DNS/IP validation and an egress policy at the supervisor or network boundary.

## Protocol boundary

The open core exposes ordered browser actions over JSONL. It does not claim to implement Chromium-only extensions, enterprise policies, or a general CDP endpoint. Software that requires those contracts needs a separate Chromium runtime.
