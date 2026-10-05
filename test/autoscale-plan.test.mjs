import assert from "node:assert/strict";
import test from "node:test";
import { drainedReadyToStop, planCapacity } from "../src/autoscale-plan.mjs";

test("keeps twenty overseas workers ready even while idle", () => {
  assert.deepEqual(planCapacity(0, { minimumContainers: 20, warmSpareContainers: 20 }), { demand: 0, requiredContainers: 0, spareContainers: 20, desiredContainers: 20 });
});

test("keeps at least one entire spare container under load", () => {
  assert.equal(planCapacity(1, { minimumContainers: 20, warmSpareContainers: 20 }).desiredContainers, 21);
  assert.equal(planCapacity(2, { minimumContainers: 20, warmSpareContainers: 20 }).desiredContainers, 21);
  assert.equal(planCapacity(3, { minimumContainers: 20, warmSpareContainers: 20 }).desiredContainers, 22);
  assert.equal(planCapacity(40, { maximumContainers: 32 }).spareContainers, 1);
  assert.equal(planCapacity(41, { maximumContainers: 32 }).spareContainers, 2);
});

test("plans all demand plus proportional spare capacity without a configured instance ceiling", () => {
  assert.deepEqual(planCapacity(100, { capacityPerContainer: 1, minimumContainers: 20, warmSpareContainers: 20 }), { demand: 100, requiredContainers: 100, spareContainers: 20, desiredContainers: 120 });
  assert.deepEqual(planCapacity(128, { capacityPerContainer: 1, minimumContainers: 20, warmSpareContainers: 20 }), { demand: 128, requiredContainers: 128, spareContainers: 20, desiredContainers: 148 });
  assert.equal(planCapacity(1000).desiredContainers, 525);
});

test("the warm floor is configurable without imposing a peak ceiling", () => {
  assert.equal(planCapacity(0, { minimumContainers: 4, warmSpareContainers: 4 }).desiredContainers, 4);
  assert.equal(planCapacity(300, { capacityPerContainer: 1, minimumContainers: 20, warmSpareContainers: 20 }).desiredContainers, 320);
});

test("a drained worker stops only after its acknowledged fence grace and a fresh zero assignment",()=>{
  assert.equal(drainedReadyToStop({now:6000,assigned:0,graceMs:5000}),false);
  assert.equal(drainedReadyToStop({drainStartedAt:1000,now:5999,assigned:0,graceMs:5000}),false);
  assert.equal(drainedReadyToStop({drainStartedAt:1000,now:6000,assigned:1,graceMs:5000}),false);
  assert.equal(drainedReadyToStop({drainStartedAt:1000,now:6000,assigned:0,graceMs:5000}),true);
});
