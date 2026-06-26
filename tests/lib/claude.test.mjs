import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClaudeArgs, parseClaudeJson, classifyFailure } from "../../scripts/lib/claude.mjs";
import { ERROR_CODES } from "../../scripts/lib/errors.mjs";

test("review 模式走 plan 只读", () => {
  const a = buildClaudeArgs({ mode: "review", repoRoot: "/repo" });
  assert.ok(a.includes("--permission-mode") && a.includes("plan"));
  assert.ok(!a.includes("--add-dir"));
});

test("task 模式走 acceptEdits + add-dir", () => {
  const a = buildClaudeArgs({ mode: "task", repoRoot: "/repo" });
  const i = a.indexOf("--permission-mode");
  assert.equal(a[i + 1], "acceptEdits");
  const d = a.indexOf("--add-dir");
  assert.equal(a[d + 1], "/repo");
});

test("background 注入 session-id 且不带 json 单结果", () => {
  const a = buildClaudeArgs({ mode: "task", repoRoot: "/repo", background: true, sessionId: "u-1" });
  assert.ok(a.includes("--background"));
  assert.ok(a.includes("--session-id") && a.includes("u-1"));
  assert.ok(!(a.includes("--output-format") && a.includes("json")));
});

test("解析成功结果", () => {
  const r = parseClaudeJson(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "hi", session_id: "s1" }));
  assert.equal(r.ok, true);
  assert.equal(r.result, "hi");
  assert.equal(r.sessionId, "s1");
});

test("解析失败结果 → 错误", () => {
  const r = parseClaudeJson(JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: true, result: "" }));
  assert.equal(r.ok, false);
});

test("非 JSON → invalid_json", () => {
  const r = parseClaudeJson("not json");
  assert.equal(r.error.code, ERROR_CODES.INVALID_JSON);
});

test("classifyFailure 识别缺失与鉴权", () => {
  assert.equal(classifyFailure({ status: 127, stderr: "command not found: claude" }), ERROR_CODES.MISSING_CLI);
  assert.equal(classifyFailure({ status: 1, stderr: "Please log in to continue" }), ERROR_CODES.AUTH_REQUIRED);
  assert.equal(classifyFailure({ status: 1, stderr: "boom" }), ERROR_CODES.NONZERO_EXIT);
});
