import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
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

const STOP_INPUT = (over = {}) => JSON.stringify({
  cwd: process.cwd(), hook_event_name: "Stop", last_assistant_message: "done",
  model: "claude", permission_mode: "default", session_id: "s1",
  stop_hook_active: false, transcript_path: null, turn_id: "t1", ...over,
});

test("gate 门禁默认关闭 → 放行且退出码 0", () => {
  const gateHome = mkdtempSync(path.join(os.tmpdir(), "cc-gate-home-"));
  const ws = mkdtempSync(path.join(os.tmpdir(), "cc-gate-ws-"));
  const r = spawnSync("node", [entry, "gate"], {
    encoding: "utf8", cwd: ws, input: STOP_INPUT({ cwd: ws }),
    env: { ...process.env, HOME: gateHome },
  });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.continue, true);
  assert.equal(out.decision, undefined);
});

test("gate 非法输入 → 放行", () => {
  const gateHome = mkdtempSync(path.join(os.tmpdir(), "cc-gate-home-"));
  const r = spawnSync("node", [entry, "gate"], {
    encoding: "utf8", input: "not json", env: { ...process.env, HOME: gateHome },
  });
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).continue, true);
});

test("gate 已在 stop 循环内 → 即便开启也放行（防递归）", () => {
  const gateHome = mkdtempSync(path.join(os.tmpdir(), "cc-gate-home-"));
  const ws = mkdtempSync(path.join(os.tmpdir(), "cc-gate-ws-"));
  // 显式开启门禁
  spawnSync("node", [entry, "setup", "--enable-review-gate", "--json"], {
    encoding: "utf8", cwd: ws, env: { ...process.env, HOME: gateHome },
  });
  const r = spawnSync("node", [entry, "gate"], {
    encoding: "utf8", cwd: ws, input: STOP_INPUT({ cwd: ws, stop_hook_active: true }),
    env: { ...process.env, HOME: gateHome },
  });
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).continue, true);
});

test("gate 已开启但 claude 不可用 → fail-open 放行且退出码 0", () => {
  const gateHome = mkdtempSync(path.join(os.tmpdir(), "cc-gate-home-"));
  const ws = mkdtempSync(path.join(os.tmpdir(), "cc-gate-ws-"));
  // 在工作区造一处改动，确保 diff 非空、评审路径真正被触发
  writeFileSync(path.join(ws, "a.txt"), "change\n");
  spawnSync("node", [entry, "setup", "--enable-review-gate", "--json"], {
    encoding: "utf8", cwd: ws, env: { ...process.env, HOME: gateHome },
  });
  // 用只含 node 目录的 PATH 运行，使 claude 不可解析 → 评审失败 → 门禁应放行
  const nodeDir = path.dirname(process.execPath);
  const r = spawnSync("node", [entry, "gate"], {
    encoding: "utf8", cwd: ws, input: STOP_INPUT({ cwd: ws }),
    env: { ...process.env, HOME: gateHome, PATH: nodeDir },
  });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.continue, true);
  assert.equal(out.decision, undefined);
});
