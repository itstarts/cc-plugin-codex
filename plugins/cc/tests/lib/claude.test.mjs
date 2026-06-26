import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClaudeArgs, parseClaudeJson, classifyFailure, scrubSecrets, loadReviewSchema, parseReviewFindings } from "../../scripts/lib/claude.mjs";
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

test("scrubSecrets 脱敏 sk- token 和 Authorization Bearer", () => {
  const input = "error: sk-ABCDEFGH12345678 is invalid\nAuthorization: Bearer abc.def.ghi\nnormal text";
  const out = scrubSecrets(input);
  assert.ok(!out.includes("sk-ABCDEFGH12345678"), "sk- token should be redacted");
  assert.ok(!out.includes("abc.def.ghi"), "Bearer token should be redacted");
  assert.ok(out.includes("normal text"), "ordinary words should be untouched");
  assert.ok(out.includes("[redacted]"), "should contain [redacted]");
});

test("scrubSecrets 脱敏 JWT token", () => {
  // JWT not prefixed by a keyword: redacted directly as [redacted-jwt]
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyMTIzIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
  const out = scrubSecrets(`value is ${jwt} end`);
  assert.ok(!out.includes(jwt), "JWT should be redacted");
  assert.ok(out.includes("[redacted-jwt]"), "should contain [redacted-jwt]");
});

test("schema 透传：传 schema 时注入 --json-schema", () => {
  const a = buildClaudeArgs({ mode: "review", repoRoot: "/repo", schema: '{"type":"object"}' });
  const i = a.indexOf("--json-schema");
  assert.ok(i >= 0, "应包含 --json-schema");
  assert.equal(a[i + 1], '{"type":"object"}');
});

test("schema 透传：不传 schema 时不注入", () => {
  const a = buildClaudeArgs({ mode: "review", repoRoot: "/repo" });
  assert.ok(!a.includes("--json-schema"));
});

test("loadReviewSchema 返回合法 JSON 且含 findings", () => {
  const s = loadReviewSchema();
  assert.equal(typeof s, "string");
  const obj = JSON.parse(s);
  assert.ok(obj.properties?.findings);
});

test("parseReviewFindings 解析结构化结果", () => {
  const text = JSON.stringify({
    findings: [{ severity: "P1", title: "bug", file: "a.js", line: 3, detail: "x" }],
    summary: "ok",
  });
  const r = parseReviewFindings(text);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].severity, "P1");
  assert.equal(r.summary, "ok");
});

test("parseReviewFindings 接受 file/line 为 null", () => {
  const text = JSON.stringify({
    findings: [{ severity: "P3", title: "note", file: null, line: null, detail: "d" }],
    summary: "s",
  });
  assert.equal(parseReviewFindings(text).findings.length, 1);
});

test("parseReviewFindings 对非结构化文本返回 null", () => {
  assert.equal(parseReviewFindings("free text review"), null);
  assert.equal(parseReviewFindings(""), null);
  assert.equal(parseReviewFindings(JSON.stringify({ notFindings: 1 })), null);
});

test("parseReviewFindings 对残缺/非法 finding 返回 null", () => {
  // 缺 detail
  assert.equal(parseReviewFindings(JSON.stringify({ findings: [{ severity: "P1", title: "t" }] })), null);
  // severity 非法枚举
  assert.equal(parseReviewFindings(JSON.stringify({ findings: [{ severity: "X", title: "t", file: null, line: null, detail: "d" }] })), null);
  // line 非整数
  assert.equal(parseReviewFindings(JSON.stringify({ findings: [{ severity: "P1", title: "t", file: "a", line: "3", detail: "d" }] })), null);
});
