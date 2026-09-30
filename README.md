# jet-browser

MASAKA browser runtime, deployed on the owner's `deeptensor` SSH host. This repository is separate from the `backend` control plane and `masaka-browser` frontend.

## Implemented

- Sandboxed Chromium, separate browser processes and temporary contexts per session, two concurrent sessions per worker.
- Outbound Supabase work queue; no public CDP port or Docker socket exposed.
- Private JPEG previews, navigation, clicks, text, key presses, scroll, exact-hostname HTTPS credential filling.
- AES-256-GCM encrypted profile persistence (cookies, local storage and IndexedDB), scoped to account identity.
- DNS-validated, IP-pinned HTTP CONNECT proxy; blocks private, loopback, link-local and reserved destinations. Chromium uses proxy even for loopback, with non-proxied WebRTC/QUIC disabled.
- Session deadlines with a bounded five-second shutdown grace for profile persistence, lease/heartbeat handling, graceful stop, server-side settlement. Billing never exceeds the reserved session duration.

This first runtime uses Node.js + Playwright/Chromium. It is not a Rust/WPE engine, a public CDP/WebDriver endpoint, a sub-30ms startup system, or per-session VM isolation. Those need separate engine/runtime work. Preview is refreshed JPEG, not video/WebRTC. Popup windows and downloads are currently disabled. Chromium profiles do not persist sessionStorage, OS keychains, or every browser-managed credential.

## Run

Use the shared local `/Users/asklv/Projects/socai/docs/work/20260930/masaka.env` as the credential source. The remote worker receives only `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VAULT_ENCRYPTION_KEY`, and `WORKER_ID`; no Waffo keys are sent to it.

```sh
npm ci
npm test
docker build -t masaka-jet-browser:0.1.7 .
docker run -d --name masaka-jet-browser --restart unless-stopped --init \
  --shm-size=1g --memory=4g --cpus=2 --pids-limit=512 \
  --dns=1.1.1.1 --dns=1.0.0.1 \
  --security-opt no-new-privileges \
  --security-opt seccomp=./seccomp_profile.json \
  --env-file ../worker.env masaka-jet-browser:0.1.7
```

Remote directory: `/data0/deeptensor_engineers/lvbo/masaka/jet-browser`.
Container: `masaka-jet-browser`. No host ports published. The entrypoint corrects container-local inherited ACL permissions, then drops to `pwuser`. Browser subprocesses receive a minimal environment without service keys. `seccomp_profile.json` is the upstream Playwright v1.63.0 profile, default-deny with namespace support: https://github.com/microsoft/playwright/blob/v1.63.0/utils/docker/seccomp_profile.json .

## SDK

```js
import { JetBrowser } from './sdk/client.mjs';
const client = new JetBrowser({apiKey: process.env.MASAKA_API_KEY});
const session = await client.create({url:'https://example.com', maxSeconds:300});
try {
  await client.waitForReady(session.id);
  await client.click(session.id, 320, 200);
  const current = await client.get(session.id); // preview_url is short-lived
} finally {
  await client.stop(session.id);
}
```

No browser keys or shared runtime secrets should be bundled into a mobile/web client. Use the authenticated backend for those clients.
