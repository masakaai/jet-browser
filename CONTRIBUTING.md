# Contributing

Thanks for improving Jet Browser. Keep changes small enough to review and preserve the boundary between browser execution and optional orchestration.

## Local checks

Use Node.js 24+ and stable Rust.

```bash
npm ci
npm run verify
```

Add a regression test for protocol, state, input, networking, scaling, or lifecycle changes. A bug fix should reproduce the failure before changing the implementation whenever practical.

## Design rules

- Keep databases, object storage, hosted APIs, and request/response polling outside the input and preview hot path.
- Treat tickets and control tokens as scoped capabilities; never log their values.
- Preserve ordered reliable delivery for clicks and keys. Coalesce replaceable pointer movement and wheel deltas under pressure.
- Validate outbound destinations after DNS resolution and on redirects.
- Make session teardown idempotent and bounded. Examples and benchmarks must clean up their own sessions in `finally`.
- Do not publish benchmark results without the raw JSON, environment, date, run count, and exact metric definition.

## Pull requests

Explain the user-visible behavior, protocol compatibility, tests run, and operational rollback. Never include credentials, profile bundles, production tickets, private hostnames, or local absolute paths.
