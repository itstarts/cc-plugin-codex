import { test } from "node:test";
import assert from "node:assert/strict";
import { renderResult } from "../../scripts/lib/render.mjs";

test("json 模式返回结构化", () => {
  const out = renderResult({ ok: true, result: "hi" }, { json: true });
  assert.deepEqual(JSON.parse(out), { ok: true, result: "hi" });
});

test("文本模式成功展示 result", () => {
  const out = renderResult({ ok: true, result: "done", touchedFiles: ["a.js"] }, { json: false });
  assert.ok(out.includes("done"));
  assert.ok(out.includes("a.js"));
});

test("文本模式失败展示错误码", () => {
  const out = renderResult({ ok: false, error: { code: "auth_required", message: "login" } }, { json: false });
  assert.ok(out.includes("auth_required"));
  assert.ok(out.includes("login"));
});

test("文本模式按 severity 展示 findings 并含 summary", () => {
  const out = renderResult({
    ok: true,
    result: "raw",
    findings: [
      { severity: "P2", title: "minor", file: "b.js", line: 10, detail: "tweak" },
      { severity: "P0", title: "crash", file: "a.js", detail: "null deref" },
    ],
    summary: "两个问题",
  }, { json: false });
  // P0 应排在 P2 之前
  assert.ok(out.indexOf("crash") < out.indexOf("minor"));
  assert.ok(out.includes("a.js"));
  assert.ok(out.includes("b.js:10"));
  assert.ok(out.includes("两个问题"));
  // 有 findings 时不回退原始文本
  assert.ok(!out.includes("raw"));
});

test("文本模式空 findings 提示未发现问题", () => {
  const out = renderResult({ ok: true, findings: [] }, { json: false });
  assert.ok(out.includes("未发现问题"));
});

test("文本模式展示后台作业列表", () => {
  const out = renderResult({ ok: true, jobs: [
    { id: "task-1", status: "running", kind: "task" },
    { id: "review-2", status: "completed", kind: "review" },
  ] }, { json: false });
  assert.ok(out.includes("task-1"));
  assert.ok(out.includes("[running]"));
  assert.ok(out.includes("review-2"));
  // 无 lost 时不出现引导
  assert.ok(!out.includes("无法从 claude agents"));
});

test("文本模式 lost 作业给出人工排查引导", () => {
  const out = renderResult({ ok: true, jobs: [
    { id: "task-x", status: "lost", kind: "task" },
  ] }, { json: false });
  assert.ok(out.includes("lost"));
  assert.ok(out.includes("claude agents"));
});

test("文本模式空作业列表提示暂无", () => {
  const out = renderResult({ ok: true, jobs: [] }, { json: false });
  assert.ok(out.includes("暂无后台作业"));
});
