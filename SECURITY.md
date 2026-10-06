# Security

Please report security issues privately to `masaka-ai-sup@outlook.com`. Do not open a public issue for credential exposure, authentication bypass, cross-tenant access, unsafe egress, profile-state disclosure, or remote-code execution.

Include the affected component and version, reproduction steps, impact, and any temporary mitigation. Remove API keys, access tokens, direct tickets, cookies, and profile data from screenshots and logs.

## Deployment baseline

- Keep service-role keys and ticket-signing secrets on trusted servers only.
- Use short-lived, session-bound direct tickets and owner/project authorization.
- Encrypt persisted browser state and apply retention limits.
- Block loopback, link-local, private, reserved, and metadata destinations after DNS resolution.
- Run browser processes with explicit CPU, memory, PID, shared-memory, and syscall boundaries.
- Rotate a secret immediately if it appears in source, logs, CI artifacts, or a browser bundle.
