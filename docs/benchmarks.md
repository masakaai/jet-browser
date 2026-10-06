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

The provider-neutral v2 harness was run with one warmup followed by three measured lifecycles against the same production target on 2026-10-06:

| Metric | Median | p95 | Stddev | Success |
| --- | ---: | ---: | ---: | ---: |
| Session create | 358 ms | 360 ms | 18 ms | 3/3 |
| Target load and verification | 4,035 ms | 4,149 ms | 203 ms | 3/3 |
| Create through target verified | 4,395 ms | 4,469 ms | 192 ms | 3/3 |
| Script round trip | 979 ms | 1,031 ms | 180 ms | 3/3 |
| Stop and release | 1,301 ms | 1,320 ms | 101 ms | 3/3 |

Raw v2 evidence: [`results/masaka-runtime-2026-10-06-v2.json`](../benchmarks/results/masaka-runtime-2026-10-06-v2.json). This is a small production smoke sample, not a public percentile claim; the p95 column is the maximum of three measurements. The script round-trip uses the trusted server action API and its durable command completion path. It is intentionally not labeled as direct input latency; pointer and keyboard input in the signed-in UI use the persistent data plane measured separately above.

## Provider-neutral harness

`benchmarks/run.mjs` measures browser infrastructure, not agent intelligence. It uses the same target page, 1280×800 viewport, sequential run count, expected DOM title/marker, script evaluation, and cleanup rule for every provider. The shared target-ready metric includes allocation, browser connection, target navigation, and fixture verification for all providers; it does not compare MASAKA's post-navigation `running` state with a CDP provider's pre-navigation connection.

```bash
npm run benchmark -- \
  --providers=masaka,browser-use,kernel \
  --warmups=3 \
  --runs=5 \
  --url=https://masaka-ai.vercel.app/browser-check.html \
  --expect-title='MASAKA browser verification' \
  --expect-selector='#save' \
  --out=benchmarks/results/comparison.json
```

Metrics:

- `sessionCreateMs`: control-plane create request. This is diagnostic: a returned queued MASAKA record and a returned ready CDP endpoint do not have identical semantics.
- `sessionConnectMs`: CDP handshake for CDP providers. It is `null` for MASAKA because Jet Browser does not expose a public CDP endpoint.
- `targetLoadAndVerifyMs`: provider-specific work after create/connect until the exact title/marker passes.
- `targetReadyMs`: API create through verified target title/marker. This intentionally includes target navigation for every provider.
- `scriptRoundTripMs`: one remote `document.title` evaluation after the page is ready.
- `stopMs`: provider stop request through confirmation returned by the API.
- `successRate`: successful runs divided by requested runs.

The default fixture expects both the exact title and `#save` marker. A custom URL requires `--expect-title` or `--expect-selector`, so a CAPTCHA or generic access-denied page cannot silently pass. Warmups use the same lifecycle and cleanup rules; their aggregate and raw `warmup_samples` remain separate from measured samples. The report includes every measured raw sample plus min, median, p95, p99, max, mean, and population standard deviation. Missing provider credentials produce an explicit `skipped` record. Failed runs and cleanup failures, including warmup failures, remain in the result with the stage and a sanitized error; they are never silently discarded.

## Fair-comparison rules

1. Use the same client machine, time window, target URL, viewport, run count, concurrency, and proxy policy.
2. Run providers sequentially or rotate their order; do not compare one warm pool with another cold region without labeling it.
3. Keep session startup separate from page navigation and agent/model time.
4. Publish raw samples and failures, not only the fastest number.
5. Do not compare MASAKA input ACK with another provider's agent task completion.
6. Record the provider region and client-to-region network RTT where available.
7. Use at least three warmups for development; use ten warmups and 30 measured runs before a public percentile claim.

## Agent benchmarks

Browser Use's BU Bench evaluates agents and models over web tasks. It is useful for an agent layer, but it does not isolate browser-runtime startup, interaction latency, or memory. To evaluate MASAKA with BU Bench, add MASAKA as a browser provider and keep the executor, model, task revision, judge, fetch setting, concurrency, and timeout identical across arms. Do not compare a MASAKA runtime result with a published Browser Use agent score as if they measured the same thing.
