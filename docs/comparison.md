# Deployment modes

Jet Browser exposes one open runtime that can be embedded at different operational layers.

| Area | Standalone container | Distributed worker |
| --- | --- | --- |
| Required services | None | Operator-selected coordinator and router |
| Browser engine | WPE WebKit | WPE WebKit |
| Command path | JSONL over stdin/stdout | Session-bound persistent stream |
| Session isolation | One container per untrusted session | One isolated runtime slot per session |
| Preview | Screenshot and semantic operations | Visual frames or Live DOM |
| Human control | Host implements input ownership | Optional epoch-fenced takeover |
| Persistence | Explicit local profile path | Optional encrypted external persistence |
| Scheduling | Host process | Optional regional scheduler |
| Usage records | Host process | Optional asynchronous batches |

Use standalone mode for local agents, CI, tests, and integrations that already supervise containers. Use the distributed worker only when the embedding application needs remote preview, multi-user control, regional placement, or fleet scheduling.

Neither mode requires a particular identity provider, database, object store, payment system, agent framework, or cloud vendor. Those choices belong to the embedding application.

## What the adjacent products teach

These products solve different layers, so the useful comparison is their operating story rather than a single feature checklist.

| Product | Official story | Useful design lesson | Jet Browser boundary |
| --- | --- | --- | --- |
| Browser Use | [Composio uses one managed browser task to bridge websites without APIs](https://browser-use.com/posts/composio): persistent per-customer profiles, live view, takeover, CAPTCHA handling, and returned files. | A browser task must carry identity, artifacts, observable progress, and a recoverable human handoff—not only click APIs. | Jet supplies the small runtime and explicit state primitives. The embedding harness owns the agent loop, profile policy, live view, artifacts, and takeover. |
| Stagehand v4 | [State and CDP dispatch moved into an extension beside the page](https://www.browserbase.com/blog/stagehand-v4), leaving TypeScript, Python, and Go clients thin. | Put the source of truth near the browser and cross one explicit RPC boundary; avoid duplicated remote page state. | Jet uses one ordered JSONL boundary and does not claim Stagehand’s extension, natural-language actions, or hosted/model-backed layer. |
| Steel | [The CLI and agent skill define a repeatable session contract](https://steel.dev/blog/steel-cli-and-agent-skill): start, inspect, act, capture evidence, and stop with recoverable failures. | Agent-facing browser tools need lifecycle discipline, stable output shapes, evidence, and failure guidance that can become reusable skills. | Jet’s versioned tool schemas and one-session-per-container model serve the same operational goal without bundling a cloud CLI. |
| Browserless | [The browser is treated as a separate production execution layer](https://www.browserless.io/blog/web-agents) connected over CDP, with session persistence and fleet concerns kept outside model reasoning. | Keep model decisions replaceable and make execution independently observable, scalable, and stateful. | Jet follows the layer split but exposes its own narrow WPE/JSONL contract rather than pretending to be a complete Chromium CDP service. |

The resulting integration keeps three explicit layers: the model/harness decides, Jet executes bounded browser commands, and the application owns identity, credits, scheduling, artifacts, live viewing, and human control. That separation is what lets the open runtime remain usable from another harness without importing a SaaS stack.

## Runtime results

The pinned runtime-only comparison is published in [Verification and runtime benchmark](./benchmarks.md). Browser Use, Steel Browser, and Browserless are included because each can expose a self-hosted browser runtime boundary under the same local fixture. Stagehand is excluded from the chart for the boundary reason above, not because it failed a run.
