#!/bin/sh
set -eu
chmod 755 /
chmod 644 /etc/resolv.conf /etc/hosts /etc/hostname
mkdir -p /tmp/wpe-runtime-0 /tmp/wpe-runtime-1 /var/lib/masaka/profiles /home/browser/.cache/fontconfig
install -o browser -g masaka -m 0644 /app/src/compositor-capture.mjs /home/browser/compositor-capture.mjs
chown browser:masaka /tmp/wpe-runtime-0 /tmp/wpe-runtime-1
chown -R browser:masaka /home/browser/.cache
chown worker:masaka /var/lib/masaka/profiles
chmod 700 /tmp/wpe-runtime-0 /tmp/wpe-runtime-1
chmod 2770 /var/lib/masaka/profiles

setpriv --reuid=browser --regid=masaka --init-groups env -i \
  HOME=/home/browser XDG_CACHE_HOME=/home/browser/.cache PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  XDG_RUNTIME_DIR=/tmp/wpe-runtime-0 WAYLAND_DISPLAY=wayland-0 MASAKA_WPE_PORT=9515 LIBGL_ALWAYS_SOFTWARE=1 \
  /usr/local/bin/masaka-wpe-supervisor &
driver_pid_0=$!
setpriv --reuid=browser --regid=masaka --init-groups env -i \
  HOME=/home/browser XDG_CACHE_HOME=/home/browser/.cache PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  XDG_RUNTIME_DIR=/tmp/wpe-runtime-1 WAYLAND_DISPLAY=wayland-1 MASAKA_WPE_PORT=9516 LIBGL_ALWAYS_SOFTWARE=1 \
  /usr/local/bin/masaka-wpe-supervisor &
driver_pid_1=$!

setpriv --reuid=browser --regid=masaka --init-groups env -i \
  HOME=/home/browser PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  XDG_RUNTIME_DIR=/tmp/wpe-runtime-0 WAYLAND_DISPLAY=wayland-0 MASAKA_CAPTURE_PORT=9615 \
  node /home/browser/compositor-capture.mjs &
capture_pid_0=$!
setpriv --reuid=browser --regid=masaka --init-groups env -i \
  HOME=/home/browser PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  XDG_RUNTIME_DIR=/tmp/wpe-runtime-1 WAYLAND_DISPLAY=wayland-1 MASAKA_CAPTURE_PORT=9616 \
  node /home/browser/compositor-capture.mjs &
capture_pid_1=$!

cleanup(){
  if [ -n "${worker_pid:-}" ]; then
    kill -TERM "$worker_pid" 2>/dev/null || true
    for attempt in $(seq 1 300); do
      if ! kill -0 "$worker_pid" 2>/dev/null; then break; fi
      sleep 0.1
    done
    if kill -0 "$worker_pid" 2>/dev/null; then kill -KILL "$worker_pid" 2>/dev/null || true; fi
    wait "$worker_pid" 2>/dev/null || true
  fi
  kill -TERM "$capture_pid_0" "$capture_pid_1" "$driver_pid_0" "$driver_pid_1" 2>/dev/null || true
  wait "$capture_pid_0" "$capture_pid_1" "$driver_pid_0" "$driver_pid_1" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# docker sends USR1/USR2 to tini and then this shell. Forward the autoscaler
# fence to the Node worker without disturbing either WebDriver process.
drain_worker(){
  if [ -n "${worker_pid:-}" ]; then kill -USR1 "$worker_pid" 2>/dev/null || true; fi
}
resume_worker(){
  if [ -n "${worker_pid:-}" ]; then kill -USR2 "$worker_pid" 2>/dev/null || true; fi
}
trap drain_worker USR1
trap resume_worker USR2

ready=0
for attempt in $(seq 1 100); do
  if curl -fsS --max-time 1 http://127.0.0.1:9515/status >/dev/null 2>&1 && curl -fsS --max-time 1 http://127.0.0.1:9516/status >/dev/null 2>&1 && curl -fsS --max-time 1 http://127.0.0.1:9615/health >/dev/null 2>&1 && curl -fsS --max-time 1 http://127.0.0.1:9616/health >/dev/null 2>&1; then ready=1; break; fi
  if ! kill -0 "$driver_pid_0" 2>/dev/null || ! kill -0 "$driver_pid_1" 2>/dev/null || ! kill -0 "$capture_pid_0" 2>/dev/null || ! kill -0 "$capture_pid_1" 2>/dev/null; then break; fi
  sleep 0.1
done
if [ "$ready" -ne 1 ]; then echo "WPE driver failed readiness" >&2; exit 1; fi

setpriv --reuid=worker --regid=masaka --init-groups env HOME=/home/worker node /app/src/wpe-worker.mjs &
worker_pid=$!
worker_status=0
while kill -0 "$worker_pid" 2>/dev/null; do
  if ! kill -0 "$driver_pid_0" 2>/dev/null || ! kill -0 "$driver_pid_1" 2>/dev/null || ! kill -0 "$capture_pid_0" 2>/dev/null || ! kill -0 "$capture_pid_1" 2>/dev/null; then
    echo "WPE infrastructure process exited; restarting worker container" >&2
    worker_status=1
    break
  fi
  # Poll instead of blocking in wait so a failed compositor or capture plane
  # cannot leave a worker registered as healthy with a permanent 503 preview.
  sleep 0.2
done
if ! kill -0 "$worker_pid" 2>/dev/null; then
  if wait "$worker_pid"; then worker_status=0; else worker_status=$?; fi
fi
exit "$worker_status"
