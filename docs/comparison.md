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
