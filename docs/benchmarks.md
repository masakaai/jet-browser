# Verification and runtime benchmark

Jet Browser’s default verification measures the open-source runtime itself. It does not require a hosted provider credential and does not compare unlike agent or browser products.

## Reproducible runtime comparison

![Jet Browser runtime benchmark: median verified browser-ready time and active memory, lower is better](./assets/runtime-benchmark.svg)

The October 7, 2026 comparison starts a fresh container for each sample and drives a container-local fixture. A sample passes only after it verifies the expected page title, DOM marker, JavaScript result, and a non-empty PNG screenshot. Implementations run serially with one uncounted warmup followed by seven measured runs. The chart uses the median of passed samples; no missing or failed value is replaced with zero.

| Implementation | Pinned source | Image digest | Passed | Browser ready p50 | Active memory p50 |
| --- | --- | --- | ---: | ---: | ---: |
| Jet Browser | `afcb22bf2a1ad75d76da88475d0db1f7ebc9e5c7` | `ae9b473c26e3…` | 7/7 | **1,445.25 ms** | **189.6 MiB** |
| Browser Use 0.13.11 | `914c59bdd4acd50e9628a97a96a3919313aebc85` | `24ec14760d25…` | 7/7 | 6,374.59 ms | 283.8 MiB |
| Steel Browser 0.5.3 | `1131a0222a27f391bf8f27cca6f278ddf7ace8dd` | `26be1193d1f2…` | 7/7 | 8,490.13 ms | 424.9 MiB |
| Browserless 2.57.0 | `f7edf0f526e5fefa2db8abca22f47b32ac165c89` | `6bac628b3d82…` | 7/7 | 5,292.05 ms | 402.2 MiB |

The full digests and every measured value live in [`runtime-2026-10-07.json`](../benchmarks/results/runtime-2026-10-07.json). The source repositories, versions, licenses, inclusion decisions, and immutable commits live in [`competitors.lock.json`](../benchmarks/competitors.lock.json). The chart is generated from that JSON; its [standalone HTML](./assets/runtime-benchmark.html) is checked for external dependencies before publication. The relative figures are computed from the checked-in p50 values against the next-lowest passing result rather than written into the artwork by hand.

### Fixed environment

| Setting | Value |
| --- | --- |
| Host | deeptensor, Linux 7.0.0-28-generic x86_64 |
| CPU | Intel Xeon Gold 6538Y+, limited to 2 CPU per container |
| Memory | 1 GiB per container; 256 MiB shared memory; 512 PID limit |
| Runtime | Docker 29.5.3; Node.js 24.18.0 |
| Viewport | 1280 × 800 |
| Order | Jet, Browser Use, Steel Browser, Browserless |
| Cache state | Local source images already built or pulled; one warmup per implementation |
| Concurrency | 1; implementations and samples run serially |
| Target | A local deterministic HTML fixture; no public website contributes to the timing |
| Ready boundary | Immediately before `docker start` until verified title and DOM marker after browser launch |
| Memory boundary | One Docker working-set snapshot after title, DOM, script, and screenshot verification while the browser remains active |

### Run it

Build Jet from the checked-out revision and build or pull the pinned upstream images named in the report. Browser Use needs the documented permission-only overlay on deeptensor because BuildKit preserves the checkout’s inherited POSIX ACL modes:

~~~bash
docker buildx build --load -f Dockerfile.standalone \
  -t jet-browser:bench-20261007 .

docker buildx build --load \
  --build-arg BASE_IMAGE=browser-use:bench-20261007 \
  -f benchmarks/containers/browser-use-host-normalized.Dockerfile \
  -t browser-use:bench-20261007-normalized .

node benchmarks/runtime-suite.mjs \
  --providers=jet,browser-use,steel-browser,browserless \
  --runs=7 --warmups=1 \
  --jet-commit=afcb22bf2a1ad75d76da88475d0db1f7ebc9e5c7 \
  --out=benchmarks/results/runtime-2026-10-07.json

node benchmarks/render-chart.mjs \
  benchmarks/results/runtime-2026-10-07.json \
  docs/assets/runtime-benchmark.svg
~~~

The runner records the actual image digest, so changing a local tag cannot silently preserve an old result.

### Environment normalizations

- Browser Use’s upstream Dockerfile runs as UID 911 but does not change ownership of `/app`. The deeptensor checkout inherits `0750 root:root` ACL-derived modes, so a permission-only overlay restores the normal read/traverse access of a public source checkout. No Browser Use source, dependency, or launch option changes. The base image digest (`f9bef84d…`) and overlay digest (`24ec1476…`) are both in the raw report.
- The host Docker volume driver cannot set Browser Use’s POSIX ACL xattrs for its declared `/data` volume. The runner supplies an empty 64 MiB tmpfs at `/data` instead.
- Both the Browser Use and Browserless OCI images export `/` as `0750` on this snapshotter. The runner restores root traversal, then immediately drops to each image’s declared non-root user before the runtime starts. This tiny wrapper remains inside measured startup time.
- Browser Use default extensions are disabled so an offline fixture run does not wait for three unrelated extension downloads. Steel’s session is created through its official `/v1/sessions` API and driven through the returned port-3000 WebSocket proxy. Browserless is driven through its documented CDP WebSocket.

### What this result does and does not show

The comparison supports one bounded conclusion: on this host and task, Jet Browser had the lowest median time to a verified local page and the lowest active container-memory snapshot among the measured images. Relative to the next result in each column, that is 72.7% lower ready time and 33.2% lower active memory.

It does not measure public-site success, anti-bot behavior, model reasoning, token use, action accuracy, long-lived stability, peak memory, concurrent throughput, hosted network latency, or the feature breadth of Chromium/CDP. Jet uses WPE WebKit while the other measured products use Chromium, so compatibility and extension support must be evaluated separately. Run order was fixed rather than randomized, and memory is a single active snapshot rather than peak RSS. Do not reuse these numbers outside that scope.

Stagehand v4 is intentionally excluded from runtime timing. Its official architecture places state management and CDP dispatch in a browser extension and exposes model-backed agent actions; measuring that stack beside raw runtime startup would compare different boundaries. It remains part of the [competitor story review](./comparison.md).

## Native v0.9.0 release verification

The October 11, 2026 release run measured the same public v0.9.0 multi-platform manifest on native GitHub-hosted AMD64 and ARM64 runners. Each platform used one uncounted warmup and seven serial measured samples with networking disabled, a 2 CPU limit, 1 GiB of memory, and the same title, DOM, JavaScript, PNG, and active-memory checks. All 14 measured samples passed.

| Native runner | Passed | Browser ready p50 / p95 | Ready range | Active memory p50 / p95 |
| --- | ---: | ---: | ---: | ---: |
| `ubuntu-24.04`, `linux/amd64`, AMD EPYC 9V45 | 7/7 | 513.42 / 560.72 ms | 485.44–560.72 ms | 240.8 / 242.4 MiB |
| `ubuntu-24.04-arm`, `linux/arm64` | 7/7 | 559.92 / 570.78 ms | 541.99–570.78 ms | 305.6 / 310.7 MiB |

Both reports resolve release source `b0867303260212eaeb427970b9a7fc6f8eed2fe1` and public manifest `sha256:5884204e128a3e5bb17634078affdf28d1933d2745752cee3bc74235ed316cec`. The complete samples and runner metadata are checked in as [`release-v0.9.0-amd64.json`](../benchmarks/results/release-v0.9.0-amd64.json) and [`release-v0.9.0-arm64.json`](../benchmarks/results/release-v0.9.0-arm64.json); the passing workflow is [run 38180195306](https://github.com/masakaai/jet-browser/actions/runs/38180195306).

This is native release verification, not a controlled AMD64-versus-ARM64 performance comparison. The runner hardware differs, and the hosted ARM64 runner did not expose a CPU model in `/proc/cpuinfo`; compare each result only with a rerun on a matching environment.

## End-to-end smoke test

~~~bash
npm run standalone
~~~

The runner builds Dockerfile.standalone and starts it with networking disabled. A passing run proves that this image can:

- start Weston, WPEWebDriver, and the Rust bridge;
- create a WPE WebKit session;
- navigate to a local data URL;
- apply native text input;
- read the resulting DOM state;
- capture a non-empty PNG;
- close the session cleanly.

The result includes the screenshot byte count and verified title/input values. CI should retain the complete command output and exact image digest.

## Repeat a prebuilt image

~~~bash
docker build -f Dockerfile.standalone -t jet-browser:local .
for run in 1 2 3 4 5; do
  npm run standalone:smoke
done
~~~

Set JET_BROWSER_IMAGE to test another local tag.

## Measurements to report for another environment

A reproducible performance report should state:

- exact Git revision and container image digest;
- host CPU architecture, core allocation, memory, and operating system;
- WPE WebKit package version;
- warmup count and measured run count;
- whether the image and package caches were warm;
- p50, p95, minimum, and maximum wall time;
- peak container memory and CPU;
- target page source and whether networking was enabled;
- every failed or timed-out run.

Do not mix browser startup, page readiness, model reasoning, and task completion into one unlabeled number. Do not publish a zero for skipped or missing data.
