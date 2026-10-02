import assert from "node:assert/strict";
import test from "node:test";
import { serializeSnapshot, snapshotLimit } from "../src/snapshot.mjs";

test("serializeSnapshot returns valid bounded JSON for large page text", () => {
  const serialized = serializeSnapshot({
    title: "Search | arXiv",
    url: "https://arxiv.org/search/",
    text: `${'browser agent "result"\n'.repeat(1800)}结尾`,
  });
  const parsed = JSON.parse(serialized);
  assert.ok(serialized.length <= snapshotLimit);
  assert.equal(parsed.title, "Search | arXiv");
  assert.equal(parsed.url, "https://arxiv.org/search/");
  assert.match(parsed.text, /^browser agent/);
  assert.ok(parsed.text.length > 10_000);
});

test("serializeSnapshot normalizes missing and non-string fields", () => {
  assert.deepEqual(JSON.parse(serializeSnapshot(null)), {
    title: "",
    url: "",
    text: "",
  });
  assert.deepEqual(
    JSON.parse(serializeSnapshot({ title: 7, url: false, text: 42 })),
    { title: "7", url: "", text: "42" },
  );
});
