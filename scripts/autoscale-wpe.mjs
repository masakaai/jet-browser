import { execFileSync } from "node:child_process";
import { drainedReadyToStop, planCapacity } from "../src/autoscale-plan.mjs";
import { automaticLaunchBudget, readHostResources } from "../src/autoscale-resources.mjs";
import { browserRegion } from "../src/region.mjs";

const region = browserRegion(process.env.MASAKA_BROWSER_REGION);
const regionPrefix = region === "overseas" ? "" : `${region}-`;
const prefix = process.env.MASAKA_AUTOSCALE_PREFIX || `masaka-jet-browser-wpe-${regionPrefix}auto-`;
const workerPrefix = process.env.MASAKA_WORKER_PREFIX || `deeptensor-wpe-${regionPrefix}`;
const image = process.env.MASAKA_WORKER_IMAGE || "masaka-jet-browser-wpe:0.7.0";
const envFile = process.env.MASAKA_WORKER_ENV || "/data0/deeptensor_engineers/lvbo/masaka/worker.env";
const seccomp = process.env.MASAKA_SECCOMP_PROFILE || "/data0/deeptensor_engineers/lvbo/masaka/jet-browser/seccomp_profile.json";
const dockerNetwork = process.env.MASAKA_DOCKER_NETWORK || "masaka-browser";
const pollMs = Math.max(1000, Number(process.env.MASAKA_AUTOSCALE_POLL_MS) || 2500);
const idleGraceMs = Math.max(30000, Number(process.env.MASAKA_AUTOSCALE_IDLE_MS) || 300000);
const drainGraceMs = Math.max(5000, pollMs * 2);
const capacityPerContainer = Math.max(1, Number(process.env.WORKER_CAPACITY) || 2);
const minimumContainers = Math.max(0, Number(process.env.MASAKA_AUTOSCALE_MIN_WORKERS) || (region === "overseas" ? 20 : 2));
const warmSpareContainers = Math.max(0, Number(process.env.MASAKA_AUTOSCALE_WARM_WORKERS) || (region === "overseas" ? 20 : 2));
const containerMemoryBytes = 4 * 1024 ** 3;
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

function ensureDockerNetwork() {
  if (dryRun) return;
  try { docker(["network", "inspect", dockerNetwork], { quiet: true }); }
  catch { docker(["network", "create", dockerNetwork], { quiet: true }); }
}

const managedPattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+)$`);
function containerIndex(name) { const match = name.match(managedPattern); return match ? Number(match[1]) : null; }

function managedContainers() {
  const output = docker([
    "ps", "-a", "--filter", "label=com.masaka.autoscaled=true",
    "--format", "{{.Names}}\t{{.State}}",
  ], { quiet: true });
  return new Map(output ? output.split("\n").map((line) => line.split("\t")).filter(([name]) => containerIndex(name) !== null) : []);
}

async function activeSessions() {
  if (simulated) return Array.from({ length: Math.max(0, Number(simulated.split("=")[1]) || 0) }, (_, index) => ({ id: `simulation-${index}`, status: "queued", worker_id: null }));
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw Error("Supabase autoscaler credentials are unavailable");
  const response = await fetch(`${base}/rest/v1/browser_sessions?select=id,status,worker_id,region&status=in.(queued,starting,running)&region=eq.${encodeURIComponent(region)}`, {
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
  const response = await fetch(`${base}/rest/v1/workers?select=id,capacity,active_sessions,region&region=eq.${encodeURIComponent(region)}`, {
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
    "run", "-d", "--name", name, "--restart", "unless-stopped", "--init", "--network", dockerNetwork,
    "--label", "com.masaka.autoscaled=true", "--label", `com.masaka.worker=${workerName(index)}`, "--label", `com.masaka.region=${region}`,
    "--shm-size=1g", "--memory=4g", "--cpus=2", "--pids-limit=512",
    "--dns=1.1.1.1", "--dns=8.8.8.8",
    "--security-opt", "no-new-privileges", "--security-opt", `seccomp=${seccomp}`,
    "--security-opt", "systempaths=unconfined", "--env-file", envFile,
    "-e", `WORKER_ID=${workerName(index)}`, "-e", `WORKER_CAPACITY=${capacityPerContainer}`, "-e", `MASAKA_BROWSER_REGION=${region}`, "-e", "MASAKA_SHARED_DIRECT_ROUTER=1", image,
  ]);
  console.log(JSON.stringify({ action: "started", name, worker: workerName(index), image }));
}

async function publishRegionalCapacity({sessions,plan,resources,launchBudget,runningWorkers}) {
  if (simulated) return;
  const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const row = {
    region,
    heartbeat_at: new Date().toISOString(),
    queued_sessions: sessions.filter((session) => session.status === "queued").length,
    active_sessions: sessions.filter((session) => session.status !== "queued").length,
    desired_workers: plan.desiredContainers,
    running_workers: runningWorkers,
    capacity_per_worker: capacityPerContainer,
    cpu_count: resources.cpuCount,
    load_1: Number(resources.load1.toFixed(2)),
    memory_total_bytes: resources.totalMemoryBytes,
    memory_available_bytes: resources.availableMemoryBytes,
    launchable_workers: launchBudget.memorySlots,
    scale_state: launchBudget.reason,
    updated_at: new Date().toISOString(),
  };
  const response = await fetch(`${base}/rest/v1/browser_region_capacity?on_conflict=region`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(row),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) console.error(JSON.stringify({ action: "capacity-status-error", region, status: response.status }));
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
  ensureDockerNetwork();
  const [sessions,workers] = await Promise.all([activeSessions(),workerStatuses()]);
  const plan = planCapacity(sessions.length, { capacityPerContainer, minimumContainers, warmSpareContainers });
  const existing = managedContainers();
  const assigned = new Map();
  for (const session of sessions) if (session.worker_id) assigned.set(session.worker_id, (assigned.get(session.worker_id) || 0) + 1);

  let runningRequired = 0;
  for (const [name,state] of existing) {
    const index=containerIndex(name);
    if(index<=plan.desiredContainers&&state==="running"){
      runningRequired++;
      // The drain flag lives inside the container while bookkeeping is local.
      if(drainSince.has(name)||!resumed.has(name))resumeContainer(index);
      idleSince.delete(name);
    }
  }
  const resources=readHostResources(),neededContainers=Math.max(0,plan.desiredContainers-runningRequired);
  const launchBudget=automaticLaunchBudget({...resources,neededContainers,containerMemoryBytes});
  let launchesRemaining=launchBudget.launchCount;
  for (let index = 1; index <= plan.desiredContainers && launchesRemaining>0; index++) {
    const name=containerName(index);
    if(existing.get(name)==="running")continue;
    startContainer(index,existing);launchesRemaining--;idleSince.delete(name);
  }

  for (const [name, state] of existing) {
    const index = containerIndex(name);
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
  const current=managedContainers(),runningWorkers=[...current.values()].filter(state=>state==="running").length;
  await publishRegionalCapacity({sessions,plan,resources,launchBudget,runningWorkers});
  console.log(JSON.stringify({action:"reconciled",region,...plan,managed:current.size,resource:{cpuCount:resources.cpuCount,load1:Number(resources.load1.toFixed(2)),availableMemoryGiB:Math.floor(resources.availableMemoryBytes/1024**3),memorySlots:launchBudget.memorySlots,launchCount:launchBudget.launchCount,reason:launchBudget.reason}}));
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
