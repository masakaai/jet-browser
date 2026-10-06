# Standalone verification

Jet Browser’s default verification measures the open-source runtime itself. It does not require a hosted provider credential and does not compare unlike agent or browser products.

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

## Measurements to report

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
