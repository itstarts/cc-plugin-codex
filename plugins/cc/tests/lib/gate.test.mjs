import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStopInput, allowDecision, blockDecision, decideFromFindings } from "../../scripts/lib/gate.mjs";

const STOP = (over = {}) => JSON.stringify({
  cwd: "/repo",
  hook_event_name: "Stop",
  last_assistant_message: "done",
  model: "claude",
  permission_mode: "default",
  session_id: "s1",
  stop_hook_active: false,
  transcript_path: null,
  turn_id: "t1",
  ...over,
});

test("parseStopInput 解析合法 Stop 契约", () => {
  const r = parseStopInput(STOP());
  assert.equal(r.ok, true);
  assert.equal(r.cwd, "/repo");
  assert.equal(r.stopHookActive, false);
  assert.equal(r.sessionId, "s1");
});

test("parseStopInput 识别 stop_hook_active", () => {
  const r = parseStopInput(STOP({ stop_hook_active: true }));
  assert.equal(r.ok, true);
  assert.equal(r.stopHookActive, true);
});

test("parseStopInput 空输入/非法 JSON/非 Stop 事件 → 错误", () => {
  assert.equal(parseStopInput("").ok, false);
  assert.equal(parseStopInput("not json").ok, false);
  assert.equal(parseStopInput(JSON.stringify({ hook_event_name: "PreToolUse" })).ok, false);
});

test("allowDecision 默认 continue:true，可带 systemMessage", () => {
  assert.deepEqual(allowDecision(), { continue: true });
  const m = allowDecision("note");
  assert.equal(m.continue, true);
  assert.equal(m.systemMessage, "note");
});

test("blockDecision 输出 decision:block + reason", () => {
  const d = blockDecision("bad");
  assert.equal(d.decision, "block");
  assert.equal(d.reason, "bad");
});

test("decideFromFindings 空/无 findings → 放行", () => {
  assert.equal(decideFromFindings([]).continue, true);
  assert.equal(decideFromFindings(null).continue, true);
  assert.equal(decideFromFindings(undefined).continue, true);
});

test("decideFromFindings 仅非阻断问题 → 放行并提示", () => {
  const d = decideFromFindings([{ severity: "P2", title: "minor", detail: "x" }], "ok");
  assert.equal(d.continue, true);
  assert.ok(d.systemMessage.includes("非阻断"));
});

test("decideFromFindings 含 P0/P1 → 拦截并在 reason 列出", () => {
  const d = decideFromFindings([
    { severity: "P0", title: "crash", file: "a.js", line: 3, detail: "boom" },
    { severity: "P2", title: "minor", detail: "x" },
  ], "总结");
  assert.equal(d.decision, "block");
  assert.ok(d.reason.includes("crash"));
  assert.ok(d.reason.includes("a.js:3"));
  assert.ok(d.reason.includes("总结"));
  // 非阻断项不进入拦截理由
  assert.ok(!d.reason.includes("minor"));
});
