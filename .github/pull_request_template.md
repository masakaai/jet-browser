## Summary

<!-- What user-visible behavior or documentation changes, and why? -->

## Verification

<!-- List the exact commands you ran and their results. -->

- [ ] `npm test`
- [ ] `cargo test --all-targets`
- [ ] `npm run standalone` when runtime or container behavior changes

## Boundary and safety

- [ ] The change keeps model reasoning, infrastructure secrets, credential management, and orchestration outside the standalone runtime; authorized browser-session state stays explicitly scoped.
- [ ] Protocol or tool-schema compatibility is described when affected.
- [ ] New privileged behavior has authorization, network, secret-handling, and cleanup considerations.
- [ ] Benchmarks include raw samples, environment, date, run count, and metric definitions.
- [ ] The diff contains no real credentials, session cookies or profiles, private tickets or hostnames, local absolute paths, or personal data; any fixture values are disposable and synthetic.

## Rollback

<!-- Describe the operational rollback, or state why this documentation-only change needs none. -->
