import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOME = mkdtempSync(path.join(os.tmpdir(), "cc-home-"));
const { loadState, saveState, upsertJob, findJob, resolveStateDir } = await import("../../scripts/lib/state.mjs");

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
