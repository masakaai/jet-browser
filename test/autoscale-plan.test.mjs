import assert from "node:assert/strict";
import test from "node:test";
import { drainedReadyToStop, planCapacity } from "../src/autoscale-plan.mjs";

test("keeps one complete warm spare even while idle", () => {
  assert.deepEqual(planCapacity(0), { demand: 0, requiredContainers: 1, spareContainers: 1, desiredContainers: 2 });
});

test("keeps at least one entire spare container under load", () => {
  assert.equal(planCapacity(1).desiredContainers, 2);
  assert.equal(planCapacity(2).desiredContainers, 2);
  assert.equal(planCapacity(3).desiredContainers, 3);
  assert.equal(planCapacity(40, { maximumContainers: 32 }).spareContainers, 1);
  assert.equal(planCapacity(41, { maximumContainers: 32 }).spareContainers, 2);
});

test("honors the configured host ceiling", () => {
  assert.equal(planCapacity(1000).desiredContainers, 5);
  assert.equal(planCapacity(1000, { maximumContainers: 8 }).desiredContainers, 8);
});

test("a drained worker stops only after its acknowledged fence grace and a fresh zero assignment",()=>{
  assert.equal(drainedReadyToStop({now:6000,assigned:0,graceMs:5000}),false);
  assert.equal(drainedReadyToStop({drainStartedAt:1000,now:5999,assigned:0,graceMs:5000}),false);
  assert.equal(drainedReadyToStop({drainStartedAt:1000,now:6000,assigned:1,graceMs:5000}),false);
  assert.equal(drainedReadyToStop({drainStartedAt:1000,now:6000,assigned:0,graceMs:5000}),true);
});
