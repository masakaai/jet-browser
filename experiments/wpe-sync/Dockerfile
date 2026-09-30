FROM debian:trixie-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends wpewebkit-driver weston dbus-x11 libgl1-mesa-dri curl rustc ca-certificates gcc libc6-dev && rm -rf /var/lib/apt/lists/*
COPY supervisor.rs /opt/supervisor.rs
RUN rustc -O /opt/supervisor.rs -o /usr/local/bin/masaka-wpe-spike && useradd --create-home --uid 1000 browser
RUN apt-get update && apt-get install -y --no-install-recommends libwpebackend-fdo-1.0-1 libatk-bridge2.0-0t64 gstreamer1.0-plugins-base && chmod -R a+rX /usr/share/glib-2.0 && rm -rf /var/lib/apt/lists/*
COPY entrypoint.sh /opt/entrypoint.sh
RUN chmod 755 /opt /opt/entrypoint.sh /usr/local/bin/masaka-wpe-spike
ENV XDG_RUNTIME_DIR=/tmp/wpe-runtime WAYLAND_DISPLAY=wayland-0 LIBGL_ALWAYS_SOFTWARE=1
ENTRYPOINT ["/opt/entrypoint.sh"]
