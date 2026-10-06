# Standalone demo

The standalone smoke test is a real end-to-end browser check with no account, API key, database, or network dependency.

## Run it

Requirements: Docker and Node.js 24+.

~~~bash
npm run standalone
~~~

The command:

1. builds Dockerfile.standalone;
2. starts the container with networking disabled and bounded CPU, memory, process count, and shared memory;
3. creates a real WPE WebKit session;
4. opens a data URL served entirely inside the browser;
5. focuses an input and types through the native input operation;
6. verifies that the DOM received the text;
7. captures a PNG screenshot;
8. closes the WebDriver session.

On success it prints a JSON result containing the title, verified input value, and screenshot byte count.

To reuse an already-built image:

~~~bash
docker build -f Dockerfile.standalone -t jet-browser:local .
npm run standalone:smoke
~~~

Set JET_BROWSER_IMAGE to use a different local image tag.

## Drive the protocol directly

The container reads one command per line from standard input and writes one response per line to standard output.

~~~bash
printf '%s\n' \
  '{"op":"create","proxy":null,"profile_dir":null,"page_load_strategy":"eager"}' \
  '{"op":"navigate","url":"http://127.0.0.1:8080/"}' \
  '{"op":"title"}' \
  '{"op":"screenshot"}' \
  '{"op":"close"}' |
docker run --rm -i --network=none --cap-drop=ALL \
  --env=JET_BROWSER_SMOKE=1 \
  --cap-add=SETUID --cap-add=SETGID \
  --security-opt=systempaths=unconfined \
  --security-opt=seccomp=./seccomp_profile.json \
  --security-opt=no-new-privileges --memory=1g --cpus=2 \
  --pids-limit=256 --shm-size=256m jet-browser:local
~~~

Responses use this shape:

~~~json
{"ok":true,"value":null}
{"ok":true,"value":"Jet Browser"}
~~~

A failed command returns ok=false and an error message. Treat a failure as belonging to that command; do not silently reorder or retry state-changing input.

## Embed it

Use the same transport from any language:

1. start one container or process per mutually untrusted session;
2. retain stdin and stdout for the lifetime of the session;
3. send only one complete JSON object per input line;
4. pair output lines with pending commands in order;
5. set per-command and whole-session timeouts;
6. issue close in finally/defer and then terminate the process tree.

The reference implementation is [scripts/standalone-smoke.mjs](../scripts/standalone-smoke.mjs). It uses only Node.js built-ins and Docker; it does not install the repository’s JavaScript dependencies. Its loopback fixture server starts only for this smoke mode and remains unreachable outside the network-disabled container.

WPE WebKit uses bubblewrap for its browser sandbox. The checked-in seccomp profile allows the namespace syscalls it needs, while the container remains non-privileged and receives no SYS_ADMIN capability.
