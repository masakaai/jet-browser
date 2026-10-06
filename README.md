# jet-browser

MASAKA browser runtime, deployed on the owner's `deeptensor` SSH host. This repository is separate from the `backend` control plane and `masaka-browser` frontend.

## Runtime

- WPE WebKit 2.54 with a Rust WebDriver bridge and two independent Weston/WPE driver slots.
- Session-scoped direct WSS data plane: preview and input travel between the client and assigned worker without Vercel, Supabase Realtime or Postgres in the hot path.
- Preview mode is fixed before launch: Live DOM sends DOM/CSSOM snapshots and mutations, while Visual sends changed PNG frames. Frames are never uploaded to object storage or written to Postgres.
- Pointer, keyboard, touch, wheel, navigation, snapshot and exact-hostname credential actions share the same ordered command path.
- Owner-bound encrypted browser-profile bundles persist cookies, local/session storage, IndexedDB records and CacheStorage in private Storage; a small interoperable cookie/local-storage summary remains encrypted in Postgres.
- DNS/IP-validated HTTP CONNECT proxying blocks loopback, link-local, private and reserved destinations.
- Lease heartbeats, bounded sessions, graceful shutdown and server-side settlement keep runtime and per-second billing state consistent.

## Run

Use the shared local `/Users/asklv/Projects/socai/docs/work/20260930/masaka.env` as the credential source. The remote worker receives only `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VAULT_ENCRYPTION_KEY`, and `WORKER_ID`; no Waffo keys are sent to it.

```sh
npm ci
npm test
docker build -f Dockerfile.wpe-worker -t masaka-jet-browser-wpe:0.6.2 .
docker run -d --name masaka-jet-browser-wpe --restart unless-stopped --init \
  --shm-size=1g --memory=4g --cpus=2 --pids-limit=512 \
  --dns=1.1.1.1 --dns=1.0.0.1 \
  --security-opt no-new-privileges \
  --security-opt seccomp=./seccomp_profile.json \
  --security-opt systempaths=unconfined \
  --env-file ../worker.env -e WORKER_ID=deeptensor-wpe-01 -e WORKER_CAPACITY=1 \
  -e MASAKA_BROWSER_REGION=overseas masaka-jet-browser-wpe:0.6.2
```

Remote directory: `/data0/deeptensor_engineers/lvbo/masaka/jet-browser`.
Container: `masaka-jet-browser-wpe`. No host ports are published. The entrypoint starts each browser slot with a separate runtime directory and Wayland socket, then runs the control-plane worker as a different unprivileged user. Browser processes receive a minimal environment without service keys.

## SDK

```js
import { MasakaBrowser } from './sdk/client.mjs';
const client = new MasakaBrowser({apiKey: process.env.MASAKA_API_KEY});
const session = await client.create({url:'https://example.com', region:'overseas', maxSeconds:300});
try {
  await client.waitForReady(session.id);
  await client.click(session.id, 320, 200);
  const current = await client.get(session.id); // preview_mode is fixed for this runtime
} finally {
  await client.stop(session.id);
}
```

No browser keys or shared runtime secrets should be bundled into a mobile/web client. Use the authenticated backend for those clients.

For a signed-in web or mobile UI, `sdk/browser.mjs` accepts the user's short-lived
Supabase access token and project ID. It supports launch/stop, direct Live DOM or
Visual preview, human-control handoff, pointer/touch/keyboard/wheel input, downloads
and clean release back to the agent. The backend exchanges the access token for a
short-lived, session-bound worker ticket; the service-role key never reaches the client.

`region` is `overseas` by default and can be set to `china`. The control plane
stores the selection on the session. A worker registers one immutable region and
claims only matching queued sessions. The regional autoscaler manages every worker,
including the first warm worker, from real queue demand and host CPU/memory headroom;
there is no operator-managed instance-count ceiling.

```js
import {MasakaBrowserClient} from './sdk/browser.mjs';
const browser = new MasakaBrowserClient({
  accessToken: session.access_token,
  projectId
});
const running = await browser.waitForReady((await browser.create({previewMode:'visual'})).id);
const preview = await browser.preview(running.id, {onFrame: png => draw(png)});
await browser.takeControl(running.id);
await browser.touch(running.id, {phase:'down', x:320, y:240});
await browser.touch(running.id, {phase:'up', x:320, y:240});
await browser.releaseControl(running.id);
await preview.close();
```

## Synchronization checks

`experiments/wpe-sync/` contains the repeatable Chrome ↔ WPE state-transfer benchmarks and the WPE supervisor used by the production image. The checks cover bidirectional cookie/local-storage changes, deletion, conflicting token rotation, reconnect behavior and encrypted profile bundles.
