# Session stability and page-isolation benchmark

This opt-in scenario checks two runtime boundaries: whether one Jet Browser session remains responsive for a bounded soak period, and whether multiple pages can be exercised and closed without cross-page state contamination. It does not measure model quality, public-site success, CAPTCHA handling, stealth, or anti-detection behavior.

## Run it

Docker and Node.js 24+ are required. To build the checked-out source and run the CI-safe default:

```bash
npm run stability
```

To reuse an image built from the same checkout:

```bash
docker build -f Dockerfile.standalone -t jet-browser:stability .
npm run stability -- \
  --no-build \
  --image=jet-browser:stability \
  --duration-seconds=10 \
  --pages=3 \
  --churn-cycles=2 \
  --sample-interval-ms=1000 \
  --output=benchmarks/results/stability-local.json
```

The bounds are deliberate: duration must be 5–3,600 seconds, pages 2–8, churn cycles 1–100, and the sampling interval 250–60,000 ms. The browser container retains `--network=none`, the standalone seccomp policy, dropped capabilities, a 1 GiB memory limit, two CPUs, a 256-process limit, and a 256 MiB shared-memory limit.

## What every passing cycle proves

Each page receives a unique marker on a deterministic loopback fixture. The runner:

1. creates or switches to the page and navigates to its marker URL;
2. types the marker through the native input path;
3. records the marker in page-local JavaScript and `sessionStorage`;
4. verifies the input, rendered output, fixture marker, script state, and session storage agree;
5. captures a semantic snapshot containing the same marker;
6. captures and hashes a non-empty PNG;
7. revisits every page and fails if any marker belongs to another page; and
8. keeps a fresh active page between churn cycles, closes every page from the completed cycle, and verifies that exactly one page remains.

Memory and process health are sampled at a fixed interval and after page cleanup. Browser, WebDriver, and supervisor liveness are reported separately. A missing role fails the run instead of being collapsed into a generic container error.

## Report contract

The JSON artifact uses `schemaVersion: 1` and includes:

- exact configuration and network mode;
- Node, operating-system, architecture, Docker, and image identity, plus the exact source commit in CI;
- ordered cycle and per-page evidence;
- timestamped memory and process-role samples;
- structured failures with the active stage, cycle, and page when available; and
- page, session, and container cleanup outcomes.

The command exits non-zero when any invariant fails. It still attempts to close the browser session, remove the container, validate the failure report, and preserve that report at the requested output path. Invalid CLI arguments fail before starting Docker.

GitHub CI runs the default scenario against the image built from each pull request and retains the JSON artifact for 14 days. A checked-in raw sample should only be added after the method and its environment identity have been reviewed; CI artifacts are not silently promoted into published benchmark claims.

## Reviewed raw sample

The first reviewed [AMD64 raw report](../benchmarks/results/stability-2026-10-11-amd64.json) is the byte-identical artifact from [GitHub Actions run 38181869835](https://github.com/masakaai/jet-browser/actions/runs/38181869835), captured at `2026-10-11T22:50:13.142Z`. It identifies source commit `fa58cdec51642b3a03d0500308d4974f83b5bfd8`, Docker 28.0.4, Node.js 24.21.0, and image ID `sha256:e57fa88a1a04340f4a0601bf2ed5405c2d7db98cdb39d7195d049ce581a0ce46`.

That one run completed two churn cycles and verified six of six pages with six distinct screenshot hashes. All 19 resource samples observed the browser, WebDriver, and supervisor; memory ranged from 216.6 to 634.4 MiB and the two post-cleanup samples were 317.1 and 317.3 MiB. Page, session, and container cleanup all completed. Its artifact SHA-256 is `5398dfbbcfeca8648a309a55dc9e8fc381c3ab513de3cee3c65d07a85a6664dc`.

This is one deterministic acceptance sample, not a claim about unlimited uptime, public-site success, or memory behavior on other hardware. Use a longer duration and more churn cycles to characterize a deployment-specific operating envelope.
