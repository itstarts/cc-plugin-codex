import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseTranscript, transcriptPathFor } from "../../scripts/lib/transcript.mjs";
import { ERROR_CODES } from "../../scripts/lib/errors.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (n) => path.join(here, "..", "fixtures", n);

test("正常 transcript 取最终结果", () => {
  const r = parseTranscript(fx("transcript-normal.jsonl"));
  assert.equal(r.ok, true);
  assert.equal(r.result, "final answer");
});

test("损坏行被跳过仍能恢复结果", () => {
  const r = parseTranscript(fx("transcript-corrupt.jsonl"));
  assert.equal(r.ok, true);
  assert.equal(r.result, "recovered");
});

test("文件不存在 → transcript_unavailable", () => {
  const r = parseTranscript(fx("does-not-exist.jsonl"));
  assert.equal(r.error.code, ERROR_CODES.TRANSCRIPT_UNAVAILABLE);
});

test("路径包含 sessionId 与 projects", () => {
  const p = transcriptPathFor("/tmp/x", "abc");
  assert.ok(p.includes("/.claude/projects/"));
  assert.ok(p.endsWith("abc.jsonl"));
});
