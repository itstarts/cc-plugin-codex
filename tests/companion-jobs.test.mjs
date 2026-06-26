import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, "..", "scripts", "claude-companion.mjs");
const home = mkdtempSync(path.join(os.tmpdir(), "cc-home-"));

test("result 未知 job → job_not_found", () => {
  const r = spawnSync("node", [entry, "result", "nope", "--json"], { encoding: "utf8", env: { ...process.env, HOME: home } });
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.error.code, "job_not_found");
});

test("status --json 返回作业数组结构或 missing_cli 错误", () => {
  const r = spawnSync("node", [entry, "status", "--json"], { encoding: "utf8", env: { ...process.env, HOME: home } });
  const out = JSON.parse(r.stdout);
  // 若 claude CLI 不存在则返回 missing_cli，否则返回作业数组
  if (out.ok) {
    assert.ok(Array.isArray(out.jobs));
  } else {
    assert.equal(out.error.code, "missing_cli");
  }
});
