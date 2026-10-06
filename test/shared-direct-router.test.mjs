import assert from "node:assert/strict";
import test from "node:test";
import { directRoute, startPriorityTunnel, workerDirectURL } from "../src/shared-direct-router.mjs";

test("shared router maps overseas and China worker paths", () => {
  assert.deepEqual(directRoute("/workers/deeptensor-wpe-07/v1/session?ticket=opaque"), {
    workerId: "deeptensor-wpe-07",
    hostname: "masaka-jet-browser-wpe-auto-07",
    path: "/v1/session?ticket=opaque",
  });
  assert.deepEqual(directRoute("/workers/deeptensor-wpe-china-104/v1/revoke"), {
    workerId: "deeptensor-wpe-china-104",
    hostname: "masaka-jet-browser-wpe-china-auto-104",
    path: "/v1/revoke",
  });
});

test("shared router rejects unscoped and malformed routes", () => {
  assert.equal(directRoute("/v1/session"), null);
  assert.equal(directRoute("/workers/not-a-worker/v1/session"), null);
  assert.throws(() => workerDirectURL("https://edge.example", "not-a-worker"), /Invalid worker id/);
});

test("shared router builds a worker-scoped public URL", () => {
  assert.equal(workerDirectURL("https://edge.example/", "deeptensor-wpe-20"), "https://edge.example/workers/deeptensor-wpe-20");
});

test("shared router prefers Cloudflare and keeps localhost.run as a hot fallback", () => {
  const starts = [], announcements = [], stops = [];
  const start = name => callback => {
    starts.push({ name, callback });
    return () => stops.push(name);
  };
  const stop = startPriorityTunnel(value => announcements.push(value), {
    startPrimary: start("cloudflare"),
    startFallback: start("localhost-run"),
  });

  assert.deepEqual(starts.map(value => value.name), ["cloudflare", "localhost-run"]);
  starts[1].callback("https://fallback.lhr.life");
  starts[0].callback("https://primary.trycloudflare.com");
  starts[1].callback(null);
  assert.deepEqual(announcements, [
    "https://fallback.lhr.life",
    "https://primary.trycloudflare.com",
  ]);

  starts[0].callback(null);
  assert.deepEqual(announcements, [
    "https://fallback.lhr.life",
    "https://primary.trycloudflare.com",
    null,
  ]);
  starts[1].callback("https://fallback-2.lhr.life");
  assert.equal(announcements.at(-1), "https://fallback-2.lhr.life");

  stop();
  assert.deepEqual(stops.sort(), ["cloudflare", "localhost-run"]);
});
