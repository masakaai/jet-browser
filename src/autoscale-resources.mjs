import { readFileSync } from "node:fs";
import { availableParallelism, freemem, loadavg, totalmem } from "node:os";

const GiB = 1024 ** 3;

export function parseMemAvailable(source) {
  const values = new Map();
  for (const line of String(source).split("\n")) {
    const match = line.match(/^(MemTotal|MemAvailable):\s+(\d+)\s+kB$/);
    if (match) values.set(match[1], Number(match[2]) * 1024);
  }
  const totalMemoryBytes = values.get("MemTotal"), availableMemoryBytes = values.get("MemAvailable");
  if (!Number.isFinite(totalMemoryBytes) || !Number.isFinite(availableMemoryBytes)) throw Error("Linux memory availability is unavailable");
  return { totalMemoryBytes, availableMemoryBytes };
}

export function readHostResources() {
  let memory;
  try { memory = parseMemAvailable(readFileSync("/proc/meminfo", "utf8")); }
  catch { memory = { totalMemoryBytes: totalmem(), availableMemoryBytes: freemem() }; }
  return { ...memory, cpuCount: availableParallelism(), load1: loadavg()[0] };
}

export function automaticLaunchBudget({ neededContainers, totalMemoryBytes, availableMemoryBytes, cpuCount, load1, containerMemoryBytes = 4 * GiB }) {
  const needed = Math.max(0, Math.ceil(Number(neededContainers) || 0));
  const total = Number(totalMemoryBytes), available = Number(availableMemoryBytes), cpus = Math.max(1, Math.floor(Number(cpuCount) || 0)), load = Number(load1), containerMemory = Number(containerMemoryBytes);
  if (![total, available, containerMemory, load].every(Number.isFinite) || total <= 0 || available < 0 || containerMemory <= 0) return { launchCount: 0, memorySlots: 0, reason: "metrics_unavailable" };
  // This is resource headroom, not an instance-count ceiling. It adapts when
  // the host size or other workloads change and always leaves OS/cache room.
  const reserveMemoryBytes = Math.max(4 * GiB, Math.ceil(total * 0.1));
  const memorySlots = Math.max(0, Math.floor((available - reserveMemoryBytes) / containerMemory));
  if (!needed) return { launchCount: 0, memorySlots, reserveMemoryBytes, reason: "satisfied" };
  if (!memorySlots) return { launchCount: 0, memorySlots, reserveMemoryBytes, reason: "memory_pressure" };
  if (load >= cpus) return { launchCount: 0, memorySlots, reserveMemoryBytes, reason: "cpu_pressure" };
  // Ramp in proportion to the host rather than starting an unbounded burst
  // before load and memory telemetry can reflect the new browser processes.
  const rampSlots = Math.max(1, Math.ceil(cpus / 8));
  return { launchCount: Math.min(needed, memorySlots, rampSlots), memorySlots, reserveMemoryBytes, reason: "ready" };
}
