ARG BASE_IMAGE=browser-use:bench-20261007
FROM ${BASE_IMAGE}

# The deeptensor benchmark checkout uses inherited POSIX ACLs. BuildKit keeps
# those source modes, so /app becomes 0750 root:root even though the upstream
# image runs as UID 911. Restore only the read/traverse access that a normal
# 0755 checkout supplies; no Browser Use source or runtime setting is changed.
USER root
RUN chmod 0755 / && chmod -R a+rX /app
USER browseruse
