#!/bin/sh
set -eu
# Host ACL inheritance also affects generated resolver files in rootless Docker.
chmod 755 /
chmod 644 /etc/resolv.conf /etc/hosts /etc/hostname
exec runuser -u browser -- /usr/local/bin/masaka-wpe-spike
