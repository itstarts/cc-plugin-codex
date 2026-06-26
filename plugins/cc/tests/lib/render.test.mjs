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
