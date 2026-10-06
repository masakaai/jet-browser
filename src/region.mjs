export const browserRegions = Object.freeze(['china', 'overseas']);

export function browserRegion(value = 'overseas') {
  const normalized = String(value || 'overseas').trim().toLowerCase();
  if (!browserRegions.includes(normalized)) throw Error(`Unsupported browser region: ${normalized || '(empty)'}`);
  return normalized;
}
