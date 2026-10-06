#!/bin/sh
set -eu

# A few legacy OCI snapshotters commit the image root directory as 0750 even
# when the Dockerfile set it to 0755. Normalize it before dropping privileges;
# every browser process below this point runs as the unprivileged browser user.
if [ "$(id -u)" -eq 0 ]; then
  chmod 0755 /
  HOME=/home/browser
  USER=browser
  LOGNAME=browser
  export HOME USER LOGNAME
  exec /usr/bin/setpriv \
    --reuid=browser --regid=browser --init-groups \
    "$0" "$@"
fi

supervisor_pid=
fixture_pid=
cleanup() {
  if [ -n "$supervisor_pid" ]; then
    kill -TERM "$supervisor_pid" 2>/dev/null || true
    wait "$supervisor_pid" 2>/dev/null || true
  fi
  if [ -n "$fixture_pid" ]; then
    kill -TERM "$fixture_pid" 2>/dev/null || true
    wait "$fixture_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if [ "${JET_BROWSER_SMOKE:-0}" = "1" ]; then
  /usr/local/bin/jet-browser-fixture &
  fixture_pid=$!
fi

/usr/local/bin/jet-browser-supervisor &
supervisor_pid=$!

ready=0
for attempt in $(seq 1 150); do
  if curl -fsS --max-time 1 http://127.0.0.1:9515/status >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! kill -0 "$supervisor_pid" 2>/dev/null; then
    break
  fi
  sleep 0.1
done

if [ "$ready" -ne 1 ]; then
  echo "Jet Browser WebDriver did not become ready" >&2
  exit 1
fi

set +e
/usr/local/bin/jet-wpe
runtime_status=$?
set -e
exit "$runtime_status"
