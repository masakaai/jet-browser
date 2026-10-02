export const snapshotLimit = 20_000;

export function serializeSnapshot(value, limit = snapshotLimit) {
  const source = value && typeof value === "object" ? value : {};
  const base = {
    title: String(source.title || "").slice(0, 300),
    url: String(source.url || "").slice(0, 4096),
  };
  const text = String(source.text || "");
  let low = 0;
  let high = text.length;
  let result = JSON.stringify({ ...base, text: "" });
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = JSON.stringify({ ...base, text: text.slice(0, middle) });
    if (candidate.length <= limit) {
      result = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}
