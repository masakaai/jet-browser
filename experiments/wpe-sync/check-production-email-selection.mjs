import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const api = process.env.API_ORIGIN || "https://masaka-backend.vercel.app";
const fixture = "https://masaka-ai.vercel.app/browser-check.html";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const config = await (await fetch(`${api}/api/config`)).json();
const auth = createClient(config.supabaseUrl, config.supabaseAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const login = await auth.auth.signInWithPassword({
  email: process.env.TEST_ACCOUNT_EMAIL,
  password: process.env.TEST_ACCOUNT_PASSWORD,
});
if (login.error) throw login.error;
const token = login.data.session.access_token;

async function request(path, method = "GET", body, control) {
  const response = await fetch(`${api}/api/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(control ? { "X-Masaka-Control": control } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || `Request failed (${response.status})`);
  return data;
}

async function waitSession(id, predicate) {
  for (let index = 0; index < 150; index++) {
    const session = await request(`sessions/${id}`);
    if (predicate(session)) return session;
    if (session.status === "failed") throw Error(session.error || "Session failed");
    await sleep(400);
  }
  throw Error("Session wait timed out");
}

async function command(sessionId, control, action) {
  const queued = await request(`sessions/${sessionId}/commands`, "POST", action, control);
  for (let index = 0; index < 150; index++) {
    const result = await request(`commands/${queued.id}`);
    if (result.status === "completed") return result.result;
    if (result.status === "failed") throw Error(result.error || "Command failed");
    await sleep(120);
  }
  throw Error("Command timed out");
}

async function evaluate(sessionId, control, expression) {
  const value = await command(sessionId, control, { kind: "evaluate", expression });
  if (value.evaluation?.exceptionDetails) throw Error(value.evaluation.exceptionDetails.text);
  return value.evaluation?.result?.value;
}

let session;
try {
  session = await request("sessions", "POST", {
    name: "Email selection input E2E",
    url: fixture,
    preview_mode: "visual",
    max_seconds: 90,
  });
  session = await waitSession(session.id, (value) => value.status === "running");
  const claim = await request(`sessions/${session.id}/control`, "POST", { mode: "human" });
  await evaluate(session.id, claim.token, `(()=>{
    const input=document.createElement('input');
    input.id='masaka-email-selection';input.type='email';input.value='old@example.com';
    document.body.prepend(input);input.focus();input.select();
    return {type:input.type,value:input.value,selectionStart:input.selectionStart};
  })()`);
  const replacement = `new-${Date.now()}@example.com`;
  await command(session.id, claim.token, {
    kind: "key",
    key: "ControlOrMeta+A",
  });
  await command(session.id, claim.token, {
    kind: "input",
    events: [{ type: "text", text: replacement }],
  });
  const actual = await evaluate(
    session.id,
    claim.token,
    "document.querySelector('#masaka-email-selection').value",
  );
  assert.equal(actual, replacement);
  console.log(JSON.stringify({
    status: "PASS",
    worker: session.worker_id,
    engine: "WPE WebKit",
    inputType: "email",
    legacyChordExpanded: true,
    selectedValueReplaced: true,
  }));
} finally {
  if (session) {
    await request(`sessions/${session.id}/stop`, "POST", {}).catch(() => {});
    await waitSession(session.id, (value) => ["completed", "failed"].includes(value.status)).catch(() => {});
  }
  await auth.auth.signOut({ scope: "local" });
  auth.realtime.disconnect();
}
