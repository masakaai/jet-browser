import assert from "node:assert/strict";
import test from "node:test";
import { automaticLaunchBudget, parseMemAvailable } from "../src/autoscale-resources.mjs";

const GiB = 1024 ** 3;

test("reads Linux MemAvailable rather than cache-distorted free memory", () => {
  assert.deepEqual(parseMemAvailable("MemTotal: 1048576 kB\nMemFree: 1024 kB\nMemAvailable: 786432 kB\n"), {
    totalMemoryBytes: 1048576 * 1024,
    availableMemoryBytes: 786432 * 1024,
  });
});

test("a 128 CPU 1 TiB host can ramp toward more than one hundred workers without a numeric ceiling", () => {
  const budget=automaticLaunchBudget({neededContainers:103,totalMemoryBytes:1024*GiB,availableMemoryBytes:888*GiB,cpuCount:128,load1:2,containerMemoryBytes:4*GiB});
  assert.equal(budget.launchCount,16);
  assert.ok(budget.memorySlots>=100);
  assert.equal(budget.reason,"ready");
});

test("satisfied demand still publishes truthful remaining launch capacity", () => {
  const budget=automaticLaunchBudget({neededContainers:0,totalMemoryBytes:1024*GiB,availableMemoryBytes:888*GiB,cpuCount:128,load1:2,containerMemoryBytes:4*GiB});
  assert.equal(budget.launchCount,0);
  assert.ok(budget.memorySlots>=190);
  assert.equal(budget.reason,"satisfied");
});

test("automatic scaling pauses on host pressure and resumes with bounded launch batches", () => {
  assert.equal(automaticLaunchBudget({neededContainers:50,totalMemoryBytes:64*GiB,availableMemoryBytes:8*GiB,cpuCount:16,load1:1,containerMemoryBytes:4*GiB}).launchCount,0);
  assert.equal(automaticLaunchBudget({neededContainers:50,totalMemoryBytes:128*GiB,availableMemoryBytes:96*GiB,cpuCount:16,load1:16,containerMemoryBytes:4*GiB}).launchCount,0);
  assert.equal(automaticLaunchBudget({neededContainers:1,totalMemoryBytes:128*GiB,availableMemoryBytes:96*GiB,cpuCount:16,load1:1,containerMemoryBytes:4*GiB}).launchCount,1);
});
