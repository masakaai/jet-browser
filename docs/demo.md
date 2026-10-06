# Demo guide

The repository demo is deliberately small and safe: it creates one browser, verifies a real page, and always stops the session.

## Run it

Create a server API key in the MASAKA dashboard, then:

```bash
npm ci
export MASAKA_API_KEY=msk_your_server_key
npm run demo
```

Optional arguments:

```bash
npm run demo -- \
  --url=https://arxiv.org/ \
  --region=overseas \
  --max-seconds=120
```

The output is a single JSON object with the session ID, assigned worker, region, startup time, URL, and title. It does not print the API key or a direct ticket.

## Use the signed-in client

Browser and mobile applications should use `MasakaBrowserClient` from `sdk/browser.mjs`, not the server key client. Provide a short-lived account access token and current project ID, create the session, attach the preview, then take control only when the user asks.

```js
import { MasakaBrowserClient } from '../sdk/browser.mjs';

const browser = new MasakaBrowserClient({
  accessToken: session.access_token,
  projectId
});

const created = await browser.create({
  previewMode: 'visual',
  region: 'overseas',
  maxSeconds: 120
});
const running = await browser.waitForReady(created.id);

const preview = await browser.preview(running.id, {
  onFrame: png => renderFrame(png),
  onState: state => renderLatency(state)
});

await browser.takeControl(running.id);
await browser.pointer(running.id, { phase: 'down', x: 320, y: 240 });
await browser.pointer(running.id, { phase: 'up', x: 320, y: 240 });
await browser.releaseControl(running.id);

await preview.close();
await browser.stop(running.id);
```

For a product demo, show the full lifecycle rather than a screenshot alone:

1. Launch a Visual session and display the MASAKA loading state.
2. Show the first real frame and measured preview age.
3. Let the agent open a page or search.
4. Take control, type or drag, then release control.
5. Let the agent continue in the same tab and state.
6. Create, switch, and close a second tab.
7. Stop the session and show final usage.

Do not demo against personal accounts or irreversible checkout flows. Use a dedicated test account and pages where actions are safe.
