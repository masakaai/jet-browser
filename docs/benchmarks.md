# Benchmarks

This repository keeps performance evidence separate from feature claims. Raw results are machine-readable, dated, and tied to an exact method.

## Latest verified MASAKA sample

Production sample captured on 2026-10-06 from a macOS client in China to the overseas WPE pool. Each mode used a fresh bounded session and two persistent WebSockets: one for preview and one for input.

| Mode | Browser ready | First preview after connection | Input ACK |
| --- | ---: | ---: | ---: |
| Visual | 3,570 ms | 167 ms, 25,799-byte PNG | 300 ms |
| Live DOM | 5,790 ms | 85 ms | 302 ms |

These are single end-to-end production samples, not an SLA or a percentile distribution. The approximately 300 ms input ACK includes the physical client-to-overseas network path. A separate 2026-10-02 resource sample on the same host measured 308.9–315.3 MiB per active worker container, 5.03–12.89% sampled CPU per container with two distributed sessions, and zero duplicate Visual frames during a five-second static window.

The current publication artifact is [`results/masaka-production-2026-10-06.json`](../benchmarks/results/masaka-production-2026-10-06.json). Re-run before quoting it after engine, region, tunnel, capture, viewport, or host changes.

The new provider-neutral harness was also run three times against the same production target on 2026-10-06:

| Metric | Median | p95 | Success |
| --- | ---: | ---: | ---: |
| Target verified | 5,831 ms | 6,458 ms | 3/3 |
| Script round trip | 1,674 ms | 1,677 ms | 3/3 |
| Stop and release | 360 ms | 364 ms | 3/3 |

Raw samples: [`results/masaka-runtime-2026-10-06.json`](../benchmarks/results/masaka-runtime-2026-10-06.json). This script round-trip uses the trusted server action API and its durable command completion path. It is intentionally not labeled as direct input latency; pointer and keyboard input in the signed-in UI use the persistent data plane measured separately above.

## Provider-neutral harness

`benchmarks/run.mjs` measures browser infrastructure, not agent intelligence. It uses the same target page, 1280×800 viewport, sequential run count, expected DOM title/marker, script evaluation, and cleanup rule for every provider. The shared target-ready metric includes allocation, browser connection, target navigation, and fixture verification for all providers; it does not compare MASAKA's post-navigation `running` state with a CDP provider's pre-navigation connection.

```bash
npm run benchmark -- \
  --providers=masaka,browser-use,kernel \
  --runs=5 \
  --url=https://masaka-ai.vercel.app/browser-check.html \
  --expect-title='MASAKA browser verification' \
  --expect-selector='#save' \
  --out=benchmarks/results/comparison.json
```

Metrics:

- `targetReadyMs`: API create through verified target title/marker. This intentionally includes target navigation for every provider.
- `scriptRoundTripMs`: one remote `document.title` evaluation after the page is ready.
- `stopMs`: provider stop request through confirmation returned by the API.
- `successRate`: successful runs divided by requested runs.

The default fixture expects both the exact title and `#save` marker. A custom URL requires `--expect-title` or `--expect-selector`, so a CAPTCHA or generic access-denied page cannot silently pass. The report includes every raw sample plus min, median, p95, max, and mean. Missing provider credentials produce an explicit `skipped` record. Failed runs and cleanup failures remain in the result with the stage and a sanitized error; they are never silently discarded.

## Fair-comparison rules

1. Use the same client machine, time window, target URL, viewport, run count, concurrency, and proxy policy.
2. Run providers sequentially or rotate their order; do not compare one warm pool with another cold region without labeling it.
3. Keep session startup separate from page navigation and agent/model time.
4. Publish raw samples and failures, not only the fastest number.
5. Do not compare MASAKA input ACK with another provider's agent task completion.
6. Record the provider region and client-to-region network RTT where available.
7. Re-run at least five times for development and 30 times before a public percentile claim.

## Agent benchmarks

Browser Use's BU Bench evaluates agents and models over web tasks. It is useful for an agent layer, but it does not isolate browser-runtime startup, interaction latency, or memory. To evaluate MASAKA with BU Bench, add MASAKA as a browser provider and keep the executor, model, task revision, judge, fetch setting, concurrency, and timeout identical across arms. Do not compare a MASAKA runtime result with a published Browser Use agent score as if they measured the same thing.
