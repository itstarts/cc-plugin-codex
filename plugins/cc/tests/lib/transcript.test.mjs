import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
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

test("is_error:true 的 result 行 → ok:false nonzero_exit", () => {
  const r = parseTranscript(fx("transcript-error.jsonl"));
  assert.equal(r.ok, false);
  assert.equal(r.error.code, ERROR_CODES.NONZERO_EXIT);
  assert.equal(r.error.subtype, "error_during_execution");
});

test("content 为字符串（非数组）时解析不崩溃，仍返回 result 行", () => {
  const r = parseTranscript(fx("transcript-stringcontent.jsonl"));
  assert.equal(r.ok, true);
  assert.equal(r.result, "ok-result");
});

test("仅字符串 content、无 result 行时也能取到终结文本", () => {
  const r = parseTranscript(fx("transcript-stringcontent-only.jsonl"));
  assert.equal(r.ok, true);
  assert.equal(r.result, "only string content, no result line");
});

test("MultiEdit/NotebookEdit 写工具的改动文件被收集", () => {
  const r = parseTranscript(fx("transcript-multiedit.jsonl"));
  assert.equal(r.ok, true);
  assert.ok(r.touchedFiles.includes("/repo/a.js"));
  assert.ok(r.touchedFiles.includes("/repo/nb.ipynb"));
});

test("解析缓存：文件变更后重新解析反映新内容", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cc-tr-"));
  const file = path.join(dir, "t.jsonl");
  writeFileSync(file, JSON.stringify({ type: "result", is_error: false, result: "v1", session_id: "s" }) + "\n");
  assert.equal(parseTranscript(file).result, "v1");
  // 改写文件（大小变化 → 指纹变化 → 缓存失效）
  writeFileSync(file, JSON.stringify({ type: "result", is_error: false, result: "v2-longer", session_id: "s" }) + "\n");
  assert.equal(parseTranscript(file).result, "v2-longer");
});

test("解析缓存：超过容量上限仍能正确解析（LRU 淘汰不影响正确性）", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cc-tr-lru-"));
  // 写入远超上限（256）数量的不同 transcript，确认每个解析结果都正确、进程不崩
  const N = 300;
  for (let i = 0; i < N; i++) {
    const file = path.join(dir, `t${i}.jsonl`);
    writeFileSync(file, JSON.stringify({ type: "result", is_error: false, result: `r${i}`, session_id: "s" }) + "\n");
    assert.equal(parseTranscript(file).result, `r${i}`);
  }
  // 重新解析最早的文件（很可能已被淘汰）：仍应正确，只是走未命中重解析
  assert.equal(parseTranscript(path.join(dir, "t0.jsonl")).result, "r0");
});
