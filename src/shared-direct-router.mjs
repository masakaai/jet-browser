import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { startQuickTunnel } from "./direct-server.mjs";

const WORKER_ROUTE = /^\/workers\/(deeptensor-wpe-(?:(china)-)?(\d{2,3}))\/(v1\/(?:session|revoke))$/;

export function directRoute(value) {
  const url = new URL(value, "http://router.invalid");
  const match = url.pathname.match(WORKER_ROUTE);
  if (!match) return null;
  const [, workerId, china, index, endpoint] = match;
  return {
    workerId,
    hostname: `masaka-jet-browser-wpe-${china ? "china-" : ""}auto-${index}`,
    path: `/${endpoint}${url.search}`,
  };
}

export function workerDirectURL(base, workerId) {
  if (!/^deeptensor-wpe-(?:china-)?\d{2,3}$/.test(workerId)) throw Error("Invalid worker id");
  return `${String(base).replace(/\/$/, "")}/workers/${workerId}`;
}

export function startLocalhostRunTunnel(onURL, { spawnImpl = spawn, retryMs = 2000 } = {}) {
  let child = null, retry = null, stopped = false, currentURL = null;
  const launch = () => {
    if (stopped) return;
    child = spawnImpl("/usr/bin/ssh", [
      "-T", "-o", "ExitOnForwardFailure=yes", "-o", "ConnectTimeout=15",
      "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3",
      "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
      "-R", "80:127.0.0.1:8787", "nokey@localhost.run",
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const inspect = (chunk) => {
      output = (output + chunk).slice(-8192);
      const match = output.match(/https:\/\/[a-z0-9-]+\.lhr\.life/i);
      if (match && match[0] !== currentURL) { currentURL = match[0]; onURL(currentURL); }
    };
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", inspect); child.stderr.on("data", inspect);
    child.once("exit", () => {
      child = null;
      if (currentURL) { currentURL = null; onURL(null); }
      if (!stopped) retry = setTimeout(launch, retryMs);
    });
    child.once("error", () => {});
  };
  launch();
  return () => { stopped = true; clearTimeout(retry); child?.kill("SIGTERM"); };
}

export function startPriorityTunnel(onURL, {
  startPrimary = startQuickTunnel,
  startFallback = startLocalhostRunTunnel,
} = {}) {
  let primaryURL = null, fallbackURL = null, announcedURL;
  const announce = () => {
    const next = primaryURL || fallbackURL || null;
    if (next === announcedURL) return;
    announcedURL = next;
    onURL(next);
  };
  const stopPrimary = startPrimary(url => { primaryURL = url; announce(); });
  const stopFallback = startFallback(url => { fallbackURL = url; announce(); });
  return () => { stopPrimary(); stopFallback(); };
}

export function createSharedDirectRouter({ timeoutMs = 10000 } = {}) {
  const server = http.createServer((request, response) => {
    const route = directRoute(request.url || "/");
    if (!route || route.path.startsWith("/v1/session")) {
      response.writeHead(404, { "content-type": "application/json" });
      return response.end(JSON.stringify({ error: "Not found" }));
    }
    const headers = { ...request.headers, host: `${route.hostname}:8787` };
    const upstream = http.request({ hostname: route.hostname, port: 8787, method: request.method, path: route.path, headers, timeout: timeoutMs }, (incoming) => {
      response.writeHead(incoming.statusCode || 502, incoming.headers);
      incoming.pipe(response);
    });
    upstream.on("timeout", () => upstream.destroy(Error("Worker timed out")));
    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(502, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "Worker unavailable" }));
    });
    request.pipe(upstream);
  });

  server.on("upgrade", (request, socket, head) => {
    const route = directRoute(request.url || "/");
    if (!route || !route.path.startsWith("/v1/session")) return socket.destroy();
    const upstream = net.connect(8787, route.hostname);
    const timer = setTimeout(() => upstream.destroy(Error("Worker timed out")), timeoutMs);
    upstream.once("connect", () => {
      clearTimeout(timer);
      const headers = [];
      for (let index = 0; index < request.rawHeaders.length; index += 2) {
        const name = request.rawHeaders[index];
        if (name.toLowerCase() === "host") continue;
        headers.push(`${name}: ${request.rawHeaders[index + 1]}`);
      }
      headers.push(`Host: ${route.hostname}:8787`);
      upstream.write(`${request.method} ${route.path} HTTP/${request.httpVersion}\r\n${headers.join("\r\n")}\r\n\r\n`);
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });
  return server;
}

async function main() {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw Error("Shared router database credentials are unavailable");
  const db = createClient(base, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const server = createSharedDirectRouter();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(8787, "0.0.0.0", resolve);
  });
  let publicURL = null;
  const publish = async () => {
    const cutoff = new Date(Date.now() - 45000).toISOString();
    const { data, error } = await db.from("workers").select("id").gt("heartbeat_at", cutoff).in("region", ["overseas", "china"]);
    if (error) throw Error(error.message);
    for (const { id } of data.filter((row) => /^deeptensor-wpe-(?:china-)?\d{2,3}$/.test(row.id))) {
      const direct_url = publicURL ? workerDirectURL(publicURL, id) : null;
      const updated = await db.from("workers").update({ direct_url, direct_updated_at: publicURL ? new Date().toISOString() : null }).eq("id", id);
      if (updated.error) throw Error(updated.error.message);
    }
  };
  const announce = (url) => { publicURL = url; void publish().catch(() => console.error("Shared direct route publication failed")); };
  const provider = process.env.MASAKA_TUNNEL_PROVIDER || "cloudflare-with-fallback";
  const stopTunnel = provider === "localhost-run"
    ? startLocalhostRunTunnel(announce)
    : provider === "cloudflare"
      ? startQuickTunnel(announce)
      : startPriorityTunnel(announce);
  const timer = setInterval(() => { void publish().catch(() => console.error("Shared direct route publication failed")); }, 3000);
  timer.unref();
  const stop = async () => { clearInterval(timer); stopTunnel(); await new Promise((resolve) => server.close(resolve)); };
  process.once("SIGTERM", () => { void stop().finally(() => process.exit(0)); });
  process.once("SIGINT", () => { void stop().finally(() => process.exit(0)); });
  console.log("MASAKA shared direct router listening");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
