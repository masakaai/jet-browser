#!/bin/sh
set -eu
# This host's rootless Docker inherits a 0750 ACL on the container root at creation.
# Fix only the container root, then drop privileges before running any app/browser.
chmod 755 /
chmod 644 /etc/resolv.conf /etc/hosts /etc/hostname
exec runuser -u pwuser -- /usr/bin/node /app/src/worker.mjs
