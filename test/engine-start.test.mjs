import assert from "node:assert/strict";
import test from "node:test";
import {
  beginNavigationWithWait,
  createNavigatedEngine,
} from "../src/engine-start.mjs";

test("navigation readiness preserves fatal driver failures for quarantine", async () => {
  let now = 0;
  let reads = 0;
  const failure = Object.assign(new Error("WPE url command timed out"), {
    driverRestartRequired: true,
  });
  await assert.rejects(
    beginNavigationWithWait(
      {
        async url() {
          if (++reads === 1) return "about:blank";
          throw failure;
        },
        async beginNavigation() {},
      },
      "https://example.com/",
      {
        timeoutMs: 3_000,
        pollMs: 500,
        now: () => now,
        pause: async (ms) => { now += ms; },
      },
    ),
    (error) => error === failure,
  );
  assert.equal(reads, 2);
});

test("navigation readiness preserves fatal document probe failures", async () => {
  let now = 0;
  let probes = 0;
  const failure = Object.assign(new Error("WPE document_state command timed out"), {
    driverRestartRequired: true,
  });
  await assert.rejects(
    beginNavigationWithWait(
      {
        async url() { return "https://app.example/home"; },
        async beginNavigation() {},
        async navigate() {},
        async documentState() {
          if (++probes === 1) return { timeOrigin: 1 };
          throw failure;
        },
      },
      "https://app.example/login",
      {
        timeoutMs: 4_000,
        pollMs: 500,
        now: () => now,
        pause: async (ms) => { now += ms; },
      },
    ),
    (error) => error === failure,
  );
  assert.equal(probes, 2);
});

test("WPE navigation can disable script probes while a document is loading",async()=>{
 let now=0,probes=0,reads=0;
 const result=await beginNavigationWithWait({
  documentStateDuringNavigation:false,
  async beginNavigation(){},
  async url(){reads++;return reads===1?'about:blank':'https://duckduckgo.com/';},
  async documentState(){probes++;throw Error('script execution must stay off the loading path');}
 },'https://duckduckgo.com/',{timeoutMs:5_000,pollMs:500,pause:async ms=>{now+=ms;},now:()=>now});
 assert.equal(result.url,'https://duckduckgo.com/');
 assert.equal(probes,0);
});

test("nonblocking navigation waits for a committed target document", async () => {
  let now = 1_000;
  const statuses = [
    "about:blank",
    "https://redirect.invalid/",
    "https://example.com/new",
    "https://example.com/new",
    "https://example.com/new",
  ];
  const calls = [];
  const result = await beginNavigationWithWait(
    {
      async beginNavigation(url, timeout) {
        calls.push({ url, timeout });
      },
      async url() {
        return statuses.shift();
      },
    },
    "https://example.com/new",
    {
      timeoutMs: 10_000,
      pollMs: 500,
      pause: async (ms) => { now += ms; },
      now: () => now,
    },
  );
  assert.deepEqual(calls, [
    { url: "https://example.com/new", timeout: 5_000 },
  ]);
  assert.deepEqual(result, {
    loaded_async: true,
    url: "https://example.com/new",
  });
  assert.equal(statuses.length, 0);
});

test("navigation does not accept the requested WebDriver URL before the page document commits", async () => {
  let now = 0;
  let probes = 0;
  const target = "https://arxiv.org/search/?query=browser";
  const result = await beginNavigationWithWait(
    {
      async beginNavigation() {},
      async navigate() {},
      async url() { return probes === 0 ? "about:blank" : target; },
      async documentState() {
        probes++;
        if (probes < 4) return {url:"about:blank",timeOrigin:1};
        return {url:target,timeOrigin:2};
      },
    },
    target,
    {timeoutMs:6_000,pollMs:500,pause:async ms=>{now+=ms;},now:()=>now},
  );
  assert.equal(result.url,target);
  assert.ok(probes>=4);
});
test("document commit probe keeps the remaining navigation budget for slow origins",async()=>{
 let now=0,probe=0;const timeouts=[],target='https://slow.example/results';
 const result=await beginNavigationWithWait({
  async beginNavigation(){},async navigate(){},async url(){return probe?target:'about:blank';},
  async documentState(timeout){timeouts.push(timeout);probe++;return probe===1?{url:'about:blank',timeOrigin:1}:{url:target,timeOrigin:2};}
 },target,{timeoutMs:45_000,pollMs:500,pause:async ms=>{now+=ms;},now:()=>now});
 assert.equal(result.url,target);assert.equal(timeouts[0],5000);assert.ok(timeouts[1]>5000);assert.ok(timeouts[1]<=40000);
});

test("navigation retries with the typed URL command when the timer never leaves blank", async () => {
  let now = 1_000;
  const statuses = [
    "about:blank",
    "about:blank",
    "about:blank",
    "https://x.com/explore",
    "https://x.com/explore",
  ];
  const calls = [];
  const result = await beginNavigationWithWait(
      {
        async beginNavigation(url) {
          calls.push(["begin", url]);
        },
        async navigate(url, timeout) {
          calls.push(["navigate", url, timeout]);
        },
        async url() {
          return statuses.shift();
        },
      },
      "https://x.com/explore",
      {
        timeoutMs: 10_000,
        pollMs: 800,
        pause: async (ms) => {
          now += ms;
        },
        now: () => now,
      },
    );
  assert.equal(result.url, "https://x.com/explore");
  assert.deepEqual(calls.map((call) => call[0]), ["begin", "navigate"]);
});

test("navigation never accepts a stable old document for a different target", async () => {
  let now = 0;
  const calls = [];
  await assert.rejects(
    beginNavigationWithWait(
      {
        async beginNavigation() {},
        async navigate(url) { calls.push(url); },
        async url() { return "https://old.example/"; },
      },
      "https://new.example/",
      {timeoutMs:3_000,pollMs:500,pause:async ms=>{now+=ms;},now:()=>now},
    ),
    /readiness timed out/,
  );
  assert.deepEqual(calls,["https://new.example/"]);
});

test("same URL reload requires the explicit navigation fallback", async () => {
  let now = 0;
  const calls = [];
  const result = await beginNavigationWithWait(
    {
      async beginNavigation() { calls.push("begin"); },
      async navigate() { calls.push("navigate"); },
      async url() { return "https://same.example/"; },
    },
    "https://same.example/",
    {timeoutMs:5_000,pollMs:500,pause:async ms=>{now+=ms;},now:()=>now},
  );
  assert.equal(result.url,"https://same.example/");
  assert.deepEqual(calls,["begin","navigate"]);
});

test("same-document fragment navigation does not require a new time origin", async () => {
  let now = 0;
  let fallback = 0;
  const href = "https://same.example/page#section";
  const result = await beginNavigationWithWait(
    {
      async beginNavigation() {},
      async navigate() { fallback++; },
      async url() { return href; },
      async documentState() { return {url:href,timeOrigin:100}; },
    },
    href,
    {timeoutMs:5_000,pollMs:500,pause:async ms=>{now+=ms;},now:()=>now},
  );
  assert.equal(result.url,href);
  assert.equal(fallback,1);
});

test("navigation accepts a replacement document that redirects to the old URL", async () => {
  let now = 0;
  let generation = 1;
  const result = await beginNavigationWithWait(
    {
      async beginNavigation() {},
      async navigate() { generation = 2; },
      async url() { return "https://app.example/home"; },
      async documentState() { return {url:"https://app.example/home",timeOrigin:generation}; },
    },
    "https://app.example/login",
    {timeoutMs:5_000,pollMs:500,pause:async ms=>{now+=ms;},now:()=>now},
  );
  assert.equal(result.url,"https://app.example/home");
});

test("switches away from a timed-out WebDriver slot immediately", async () => {
  let creates = 0;
  const timeout = Object.assign(new Error("WPE url command timed out"), {
    driverRestartRequired: true,
  });

  await assert.rejects(
    createNavigatedEngine({
      create: async () => {
        creates++;
        return { sessionId: "unsafe", close: async () => {} };
      },
      navigate: async () => {
        throw timeout;
      },
      target: "https://example.com",
      attempts: 6,
      pause: async () => {},
    }),
    (error) => error === timeout && error.driverReusable === false,
  );
  assert.equal(creates, 1);
});

test("initial navigation closes and recreates one failed browser session", async () => {
  const engines = [];
  const pauses = [];
  const engine = await createNavigatedEngine({
    create: async () => {
      const value = {
        id: engines.length + 1,
        sessionId: `session-${engines.length + 1}`,
        closed: false,
        async close() {
          this.closed = true;
          this.sessionId = null;
        },
      };
      engines.push(value);
      return value;
    },
    navigate: async (value, target) => {
      assert.equal(target, "https://example.com/");
      if (value.id === 1) throw Error("page load timeout");
    },
    target: "https://example.com/",
    pause: async (ms) => pauses.push(ms),
  });
  assert.equal(engine.id, 2);
  assert.equal(engines[0].closed, true);
  assert.equal(engines[1].closed, false);
  assert.deepEqual(pauses, [500]);
});

test("failed cleanup quarantines the driver instead of retrying", async () => {
  const cleanup = Error("cleanup failed");
  await assert.rejects(
    createNavigatedEngine({
      create: async () => ({
        sessionId: "unresolved",
        async close() {
          throw cleanup;
        },
      }),
      navigate: async () => {
        throw Error("page load timeout");
      },
      target: "https://example.com/",
    }),
    (error) => error === cleanup && error.driverReusable === false,
  );
});

test("unsafe creation failure is never retried on the same driver", async () => {
  let creations = 0;
  const unsafe = Object.assign(Error("unsafe create"), {
    driverReusable: false,
  });
  await assert.rejects(
    createNavigatedEngine({
      create: async () => {
        creations++;
        throw unsafe;
      },
      navigate: async () => {},
      target: "https://example.com/",
    }),
    (error) => error === unsafe,
  );
  assert.equal(creations, 1);
});

test("confirmed orphan deletion permits one clean retry", async () => {
  let creations = 0;
  const engine = await createNavigatedEngine({
    create: async () => {
      creations++;
      return {
        id: creations,
        sessionId: `session-${creations}`,
        async close() {
          this.sessionId = null;
          throw Error("close response was lost after orphan deletion");
        },
      };
    },
    navigate: async (value) => {
      if (value.id === 1) throw Error("page load timeout");
    },
    target: "https://example.com/",
  });
  assert.equal(engine.id, 2);
  assert.equal(creations, 2);
});

test("exhausted clean retries leave the driver reusable", async () => {
  await assert.rejects(
    createNavigatedEngine({
      create: async () => ({
        sessionId: "session",
        close: async function () {
          this.sessionId = null;
        },
      }),
      navigate: async () => {
        throw Error("page load timeout");
      },
      target: "https://example.com/",
    }),
    (error) => /timeout/.test(error.message) && error.driverReusable === true,
  );
});

test("retry loop exposes a shrinking total startup budget", async () => {
  const remaining = [];
  let now = 1000;
  const originalNow = Date.now;
  Date.now = () => now;
  try {
    await assert.rejects(
      createNavigatedEngine({
        create: async () => ({
          sessionId: "session",
          async close() {
            this.sessionId = null;
          },
        }),
        navigate: async (_engine, _target, context) => {
          remaining.push(context.remainingMs);
          now += 1200;
          throw Error("page load timeout");
        },
        target: "https://example.com/",
        attempts: 6,
        timeoutMs: 2500,
        pause: async (ms) => {
          now += ms;
        },
      }),
      /timeout/,
    );
  } finally {
    Date.now = originalNow;
  }
  assert.deepEqual(remaining, [2500, 800]);
});

test("startup preparation completes before target navigation", async () => {
  const order = [];
  const engine = await createNavigatedEngine({
    create: async () => ({ id: "prepared", close: async () => {} }),
    prepare: async (value, target) => {
      order.push(`prepare:${value.id}:${target}`);
    },
    navigate: async (value, target) => {
      order.push(`navigate:${value.id}:${target}`);
    },
    target: "https://example.com/account",
  });
  assert.equal(engine.id, "prepared");
  assert.deepEqual(order, [
    "prepare:prepared:https://example.com/account",
    "navigate:prepared:https://example.com/account",
  ]);
});
