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
