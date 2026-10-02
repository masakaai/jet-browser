# The default production image is the WPE realtime worker. Keep this file in
# sync with Dockerfile.wpe-worker so a plain `docker build .` cannot fall back
# to the retired Chromium/Storage preview path.
FROM node:24-bookworm AS node
WORKDIR /build
COPY package.json package-lock.json ./
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci --omit=dev

FROM rust:bookworm AS rust-build
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY rust ./rust
COPY experiments/wpe-sync/supervisor.rs ./supervisor.rs
RUN cargo build --release --locked && cargo test --release --locked && rustc -O supervisor.rs -o masaka-wpe-supervisor

FROM cloudflare/cloudflared:2026.9.3 AS cloudflared

FROM debian:sid
ENV DEBIAN_FRONTEND=noninteractive NODE_ENV=production \
    XDG_RUNTIME_DIR=/tmp/wpe-runtime WAYLAND_DISPLAY=wayland-0 LIBGL_ALWAYS_SOFTWARE=1
RUN apt-get update && apt-get install -y --no-install-recommends \
    wpewebkit-webdriver libwpebackend-fdo-1.0-1 weston dbus-x11 libgl1-mesa-dri \
    ca-certificates curl gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-libav tar util-linux fonts-noto-cjk fonts-noto-color-emoji && \
    groupadd --gid 1000 masaka && \
    useradd --create-home --uid 1000 --gid masaka worker && \
    useradd --create-home --uid 1001 --gid masaka browser && \
    chmod -R a+rX /usr/share/glib-2.0 /usr/share/fonts /var/cache/fontconfig /etc/fonts && \
    rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local /usr/local
COPY --from=node /build/node_modules /app/node_modules
COPY --from=rust-build /build/target/release/jet-wpe /usr/local/bin/jet-wpe
COPY --from=rust-build /build/masaka-wpe-supervisor /usr/local/bin/masaka-wpe-supervisor
COPY --from=cloudflared /usr/local/bin/cloudflared /usr/local/bin/cloudflared
COPY package.json /app/package.json
COPY src /app/src
COPY wpe-worker-entrypoint.sh /app/wpe-worker-entrypoint.sh
RUN mkdir -p /var/lib/masaka/profiles /home/browser/.cache/fontconfig && chmod 755 /app/wpe-worker-entrypoint.sh /usr/local/bin/jet-wpe /usr/local/bin/masaka-wpe-supervisor && \
    chown -R worker:masaka /app /var/lib/masaka && chown -R browser:masaka /home/browser/.cache && chmod 2770 /var/lib/masaka/profiles
WORKDIR /app
ENTRYPOINT ["/app/wpe-worker-entrypoint.sh"]
