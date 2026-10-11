# Python supervisor

Jet Browser includes a dependency-free Python adapter for supervising one isolated WPE WebKit container through its ordered JSONL protocol. It owns the container lifecycle, validates protocol responses and PNG evidence, applies the same CPU, memory, PID, capability, and seccomp limits as the repository smoke test, and removes the container on success or failure.

Python 3.11+ and Docker are required. Browser network is disabled by default, no host directory or Docker socket is mounted into the browser, and the released multi-platform image is pinned by digest.

Install the reviewed package directly from this repository while the PyPI release workflow is being prepared:

~~~bash
python3 -m pip install "jet-browser @ git+https://github.com/masakaai/jet-browser.git@main#subdirectory=integrations/python"
~~~

The package has no runtime Python dependencies. CI builds both wheel and source distributions, checks their metadata and bundled policy, installs the exact wheel into a clean environment, then exercises that wheel against native AMD64 and ARM64 browser images.

## Verify the offline path

From a source checkout:

~~~bash
python3 examples/python_quickstart.py
~~~

The example starts the image's deterministic local fixture, creates a session, navigates, types through the native input path, checks the DOM, validates a fresh PNG, closes the session, and verifies cleanup. Override `--image` to exercise a local build:

~~~bash
docker build -f Dockerfile.standalone -t jet-browser:local .
python3 examples/python_quickstart.py --image jet-browser:local
~~~

Successful output is one machine-readable line:

~~~json
{"status":"passed","network":"disabled","title":"Jet Browser Ready","input":"python supervisor","screenshotBytes":4096,"image":"jet-browser:local","platform":"linux/amd64","cleanup":"passed"}
~~~

The screenshot byte count and native platform vary.

## Embed one session

The default constructor remains offline:

~~~python
from jet_browser import JetBrowserProcess

with JetBrowserProcess(fixture=True) as browser:
    browser.navigate("http://127.0.0.1:8080/")
    browser.wait_for_document("http://127.0.0.1:8080/")
    snapshot = browser.snapshot()
    png = browser.screenshot()
~~~

Public-web navigation is deliberately not an implicit configuration change. A trusted application must opt in twice:

~~~python
with JetBrowserProcess(network="bridge", allow_network=True) as browser:
    browser.navigate("https://example.com/")
    browser.wait_for_document("https://example.com/")
    snapshot = browser.snapshot()
~~~

`network="bridge"` gives the browser every destination reachable through Docker's bridge, which can include private or host-adjacent networks depending on the Docker installation. The adapter validates URL syntax but is not an egress firewall or DNS-rebinding defense. Use a separately governed proxy or Docker network when untrusted model output can choose URLs.

## Boundary

- One `JetBrowserProcess` owns one container and one ordered command stream.
- Only native `linux/amd64` and `linux/arm64` release images are accepted.
- Commands and responses are size- and time-bounded.
- The default browser network is `none`; `host` and arbitrary Docker networks are rejected.
- No shell is used to launch Docker and no application environment is forwarded to the browser.
- No personal browser profile, credential, or persistent Chrome daemon is attached.
- Cleanup is idempotent and force-removes the named container after normal or exceptional exit.

The installable package bundles the reviewed seccomp policy and Apache-2.0 license. PyPI publication is intentionally not claimed until the protected Trusted Publishing release workflow is live.
