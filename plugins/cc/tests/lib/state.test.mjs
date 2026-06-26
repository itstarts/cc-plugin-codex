import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOME = mkdtempSync(path.join(os.tmpdir(), "cc-home-"));
const { loadState, saveState, upsertJob, findJob, resolveStateDir, isReviewGateEnabled, setReviewGate } = await import("../../scripts/lib/state.mjs");

const cwd = mkdtempSync(path.join(os.tmpdir(), "cc-ws-"));

test("缺省 state", () => {
  const s = loadState(cwd);
  assert.equal(s.version, 1);
  assert.deepEqual(s.jobs, []);
});

test("upsert 与 find", () => {
  upsertJob(cwd, { id: "j1", status: "running", updatedAt: 1 });
  upsertJob(cwd, { id: "j1", status: "completed", updatedAt: 2 });
  const j = findJob(cwd, "j1");
  assert.equal(j.status, "completed");
});

test("state 目录在 HOME 下", () => {
  assert.ok(resolveStateDir(cwd).startsWith(process.env.HOME));
});

test("最多保留 50 条", () => {
  for (let i = 0; i < 60; i++) upsertJob(cwd, { id: `k${i}`, updatedAt: i });
  const s = loadState(cwd);
  assert.ok(s.jobs.length <= 50);
});

test("upsert 更新时返回合并后的完整对象", () => {
  upsertJob(cwd, { id: "m1", a: 1, updatedAt: 1000 });
  const merged = upsertJob(cwd, { id: "m1", b: 2, updatedAt: 1001 });
  assert.equal(merged.a, 1);
  assert.equal(merged.b, 2);
  assert.equal(merged.updatedAt, 1001);
});

test("评审门禁默认关闭", () => {
  const ws = mkdtempSync(path.join(os.tmpdir(), "cc-gate-"));
  assert.equal(isReviewGateEnabled(ws), false);
});

test("setReviewGate 开关读写并持久化", () => {
  const ws = mkdtempSync(path.join(os.tmpdir(), "cc-gate-"));
  assert.equal(setReviewGate(ws, true), true);
  assert.equal(isReviewGateEnabled(ws), true);
  setReviewGate(ws, false);
  assert.equal(isReviewGateEnabled(ws), false);
});

test("setReviewGate 不影响已有 jobs", () => {
  const ws = mkdtempSync(path.join(os.tmpdir(), "cc-gate-"));
  upsertJob(ws, { id: "g1", status: "running", updatedAt: 1 });
  setReviewGate(ws, true);
  assert.equal(findJob(ws, "g1").status, "running");
  assert.equal(isReviewGateEnabled(ws), true);
});
