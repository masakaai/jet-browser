import { execFileSync } from "node:child_process";
import { drainedReadyToStop, planCapacity } from "../src/autoscale-plan.mjs";

const prefix = process.env.MASAKA_AUTOSCALE_PREFIX || "masaka-jet-browser-wpe-auto-";
const workerPrefix = process.env.MASAKA_WORKER_PREFIX || "deeptensor-wpe-";
const image = process.env.MASAKA_WORKER_IMAGE || "masaka-jet-browser-wpe:0.5.82";
const envFile = process.env.MASAKA_WORKER_ENV || "/data0/deeptensor_engineers/lvbo/masaka/worker.env";
const seccomp = process.env.MASAKA_SECCOMP_PROFILE || "/data0/deeptensor_engineers/lvbo/masaka/jet-browser/seccomp_profile.json";
const pollMs = Math.max(1000, Number(process.env.MASAKA_AUTOSCALE_POLL_MS) || 2500);
const idleGraceMs = Math.max(30000, Number(process.env.MASAKA_AUTOSCALE_IDLE_MS) || 300000);
const drainGraceMs = Math.max(5000, pollMs * 2);
const maximumContainers = Math.max(1, Number(process.env.MASAKA_AUTOSCALE_MAX) || 5);
const capacityPerContainer = Math.max(1, Number(process.env.WORKER_CAPACITY) || 2);
const once = process.argv.includes("--once");
const dryRun = process.argv.includes("--dry-run");
const simulated = process.argv.find((value) => value.startsWith("--simulate-demand="));
const idleSince = new Map();
const drainSince = new Map();
const drainAcknowledgedSince = new Map();
const resumed = new Set();
let stopping = false;

function docker(args, options = {}) {
  return execFileSync("docker", args, {
    encoding: "utf8",
    stdio: options.quiet ? ["ignore", "pipe", "pipe"] : ["ignore", "pipe", "inherit"],
  }).trim();
}

function managedContainers() {
  const output = docker([
    "ps", "-a", "--filter", "label=com.masaka.autoscaled=true",
    "--format", "{{.Names}}\t{{.State}}",
  ], { quiet: true });
  return new Map(output ? output.split("\n").map((line) => line.split("\t")) : []);
}

async function activeSessions() {
  if (simulated) return Array.from({ length: Math.max(0, Number(simulated.split("=")[1]) || 0) }, (_, index) => ({ id: `simulation-${index}`, status: "queued", worker_id: null }));
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw Error("Supabase autoscaler credentials are unavailable");
  const response = await fetch(`${base}/rest/v1/browser_sessions?select=id,status,worker_id&status=in.(queued,starting,running)`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw Error(`Autoscaler demand query failed (${response.status})`);
  return response.json();
}

async function workerStatuses() {
  if (simulated) return new Map();
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw Error("Supabase autoscaler credentials are unavailable");
  const response = await fetch(`${base}/rest/v1/workers?select=id,capacity,active_sessions`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw Error(`Autoscaler worker query failed (${response.status})`);
  return new Map((await response.json()).map((value) => [value.id, value]));
}

function containerName(index) {
  return `${prefix}${String(index).padStart(2, "0")}`;
}

function workerName(index) {
  return `${workerPrefix}${String(index).padStart(2, "0")}`;
}

function startContainer(index, existing) {
  const name = containerName(index);
  if (dryRun) return console.log(JSON.stringify({ action: "start", name, worker: workerName(index), image }));
  if (existing.has(name)) docker(["rm", name]);
  docker([
    "run", "-d", "--name", name, "--restart", "unless-stopped", "--init",
    "--label", "com.masaka.autoscaled=true", "--label", `com.masaka.worker=${workerName(index)}`,
    "--shm-size=1g", "--memory=4g", "--cpus=2", "--pids-limit=512",
    "--dns=1.1.1.1", "--dns=8.8.8.8",
    "--security-opt", "no-new-privileges", "--security-opt", `seccomp=${seccomp}`,
    "--security-opt", "systempaths=unconfined", "--env-file", envFile,
    "-e", `WORKER_ID=${workerName(index)}`, "-e", `WORKER_CAPACITY=${capacityPerContainer}`, image,
  ]);
  console.log(JSON.stringify({ action: "started", name, worker: workerName(index), image }));
}

function stopContainer(index) {
  const name = containerName(index);
  if (dryRun) return console.log(JSON.stringify({ action: "stop", name, worker: workerName(index) }));
  docker(["stop", "-t", "30", name]);
  docker(["rm", name]);
  drainSince.delete(name);
  drainAcknowledgedSince.delete(name);
  idleSince.delete(name);
  resumed.delete(name);
  console.log(JSON.stringify({ action: "stopped", name, worker: workerName(index) }));
}

function drainContainer(index) {
  const name=containerName(index);
  if (!dryRun) docker(["kill", "--signal=USR1", name]);
  drainSince.set(name,Date.now());
  drainAcknowledgedSince.delete(name);
  resumed.delete(name);
  console.log(JSON.stringify({action:"draining",name,worker:workerName(index)}));
}

function resumeContainer(index) {
  const name=containerName(index);
  if (!dryRun) docker(["kill", "--signal=USR2", name]);
  drainSince.delete(name);
  drainAcknowledgedSince.delete(name);
  resumed.add(name);
  console.log(JSON.stringify({action:"resumed",name,worker:workerName(index)}));
}

async function reconcile() {
  const [sessions,workers] = await Promise.all([activeSessions(),workerStatuses()]);
  const plan = planCapacity(sessions.length, { capacityPerContainer, maximumContainers });
  const existing = managedContainers();
  const assigned = new Map();
  for (const session of sessions) if (session.worker_id) assigned.set(session.worker_id, (assigned.get(session.worker_id) || 0) + 1);

  for (let index = 2; index <= plan.desiredContainers; index++) {
    const name = containerName(index);
    if (existing.get(name) !== "running") startContainer(index, existing);
    // The worker's drain flag lives inside the container, while the autoscaler
    // bookkeeping is intentionally in memory. Resume every required running
    // container once after an autoscaler restart so a previous USR1 cannot
    // leave counted capacity permanently unavailable.
    else if (drainSince.has(name) || !resumed.has(name)) resumeContainer(index);
    idleSince.delete(name);
  }

  for (const [name, state] of existing) {
    const match = name.match(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+)$`));
    if (!match) continue;
    const index = Number(match[1]);
    if (index <= plan.desiredContainers) continue;
    if (state !== "running") {
      if (!dryRun) docker(["rm", name]);
      idleSince.delete(name);
      drainSince.delete(name);
      drainAcknowledgedSince.delete(name);
      continue;
    }
    if ((assigned.get(workerName(index)) || 0) > 0) {
      drainAcknowledgedSince.delete(name);
      if(!drainSince.has(name))idleSince.delete(name);
      continue;
    }
    const since = idleSince.get(name) || Date.now();
    idleSince.set(name, since);
    if (Date.now() - since < idleGraceMs) continue;
    if(!drainSince.has(name)){drainContainer(index);continue;}
    const workerState=workers.get(workerName(index));
    if(!workerState||Number(workerState.capacity)!==0||Number(workerState.active_sessions)!==0){drainAcknowledgedSince.delete(name);continue;}
    const acknowledgedAt=drainAcknowledgedSince.get(name)||Date.now();drainAcknowledgedSince.set(name,acknowledgedAt);
    if(drainedReadyToStop({drainStartedAt:acknowledgedAt,assigned:assigned.get(workerName(index))||0,graceMs:drainGraceMs}))stopContainer(index);
  }
  console.log(JSON.stringify({ action: "reconciled", ...plan, managed: [...existing.keys()].length }));
}

process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

do {
  try {
    await reconcile();
  } catch (error) {
    console.error(JSON.stringify({ action: "error", error: String(error.message).slice(0, 240) }));
    if (once) process.exitCode = 1;
  }
  if (once || stopping) break;
  await new Promise((resolve) => setTimeout(resolve, pollMs));
} while (!stopping);
