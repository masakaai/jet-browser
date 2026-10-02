export function planCapacity(demand, {
  capacityPerContainer = 2,
  minimumContainers = 1,
  maximumContainers = 5,
  spareRatio = 0.05,
  warmSpareContainers = 1,
} = {}) {
  const sessions = Math.max(0, Math.ceil(Number(demand) || 0));
  const capacity = Math.max(1, Math.floor(Number(capacityPerContainer) || 1));
  const minimum = Math.max(1, Math.floor(Number(minimumContainers) || 1));
  const maximum = Math.max(minimum, Math.floor(Number(maximumContainers) || minimum));
  const required = Math.max(minimum, Math.ceil(sessions / capacity));
  const warmSpare = Math.max(0, Math.floor(Number(warmSpareContainers) || 0));
  const spare = Math.max(warmSpare, sessions > 0 ? Math.max(1, Math.ceil(required * spareRatio)) : 0);
  return {
    demand: sessions,
    requiredContainers: required,
    spareContainers: spare,
    desiredContainers: Math.min(maximum, required + spare),
  };
}

export function drainedReadyToStop({drainStartedAt,now=Date.now(),assigned=0,graceMs=5000}={}) {
  return Number.isFinite(drainStartedAt) && Number.isFinite(now) && Number.isFinite(graceMs)
    && graceMs>=0 && now-drainStartedAt>=graceMs && Number(assigned)===0;
}
